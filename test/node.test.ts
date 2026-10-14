import { NodeOperationError, type IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { Sether } from '../nodes/Sether/Sether.node';
import { FIXTURE, SUPPORT_EMAIL, asString, itemsOf, nodeOutputs, runNode, tokenIn } from './helpers';

async function redactSupportEmail(): Promise<{ redacted: string; mapping: IDataObject }> {
	const [main] = await runNode('redact', {}, itemsOf({ text: SUPPORT_EMAIL, ticket: 1042 }));
	const json = main?.[0]?.json;
	if (json === undefined) throw new Error('expected one output item');
	return { redacted: asString(json.redacted), mapping: json._setherVault as IDataObject };
}

describe('node description', () => {
	it('is not usable as an AI tool, so an agent cannot call Restore', () => {
		expect(new Sether().description.usableAsTool).toBeUndefined();
	});

	it.each([
		[{ operation: 'redact' }, ['main']],
		[{ operation: 'restore' }, ['main']],
		[{ operation: 'validateToolCall' }, ['main']],
		[
			{ operation: 'validateToolCall', onViolation: 'route' },
			[
				{ type: 'main', displayName: 'Approved' },
				{ type: 'main', displayName: 'Rejected' },
			],
		],
	])('n8n-workflow evaluates outputs for %j as %j', (parameters, expected) => {
		expect(nodeOutputs(parameters)).toEqual(expected);
	});
});

describe('Redact operation', () => {
	it('writes redacted text and the mapping, and drops the source field by default', async () => {
		const [main] = await runNode('redact', {}, itemsOf({ text: SUPPORT_EMAIL, ticket: 1042 }));

		const json = main?.[0]?.json ?? {};
		expect(json).not.toHaveProperty('text');
		expect(json.ticket).toBe(1042);
		expect(Object.values(json._setherVault as IDataObject).sort()).toEqual(
			[FIXTURE.email, FIXTURE.iban, FIXTURE.phone].sort(),
		);
		for (const value of Object.values(FIXTURE)) expect(json.redacted).not.toContain(value);
		expect(main?.[0]?.pairedItem).toEqual({ item: 0 });
	});

	it('keeps the source field when asked', async () => {
		const [main] = await runNode(
			'redact',
			{ options: { keepSourceFields: true } },
			itemsOf({ text: SUPPORT_EMAIL }),
		);

		expect(main?.[0]?.json.text).toBe(SUPPORT_EMAIL);
	});

	it('redacts several fields into one mapping, keyed by path', async () => {
		const [main] = await runNode(
			'redact',
			{ textFields: 'subject, email.body', detectorPacks: ['basic', 'identity'] },
			itemsOf({ subject: `From ${FIXTURE.email}`, email: { body: SUPPORT_EMAIL } }),
		);

		const json = main?.[0]?.json ?? {};
		const redacted = json.redacted as IDataObject;
		expect(Object.keys(redacted)).toEqual(['subject', 'email.body']);
		expect(redacted['email.body']).toMatch(/Customer: <NAME_/);
		expect(Object.keys(json._setherVault as IDataObject)).toHaveLength(5);
		expect(json.email).toEqual({});
	});

	it('gives every item its own mapping', async () => {
		const [main] = await runNode(
			'redact',
			{},
			itemsOf({ text: FIXTURE.email }, { text: FIXTURE.email }),
		);

		const [first, second] = (main ?? []).map((item) => Object.keys(item.json._setherVault as IDataObject));
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(first).not.toEqual(second);
	});
});

describe('Restore operation', () => {
	it('restores text from the mapping', async () => {
		const { redacted, mapping } = await redactSupportEmail();

		const [main] = await runNode('restore', { mapping }, itemsOf({ output: `Re: ${redacted}` }));

		expect(main?.[0]?.json.restored).toBe(`Re: ${SUPPORT_EMAIL}`);
	});

	it('fails on tokens missing from the mapping by default', async () => {
		const { redacted, mapping } = await redactSupportEmail();
		const output = `${redacted} <EMAIL_00000000-0000-0000-0000-000000000000>`;

		await expect(runNode('restore', { mapping }, itemsOf({ output }))).rejects.toThrow(
			'1 token(s) are not in the mapping',
		);
	});

	it("leaves unknown tokens in place when set to Sether's default behaviour", async () => {
		const invented = '<EMAIL_00000000-0000-0000-0000-000000000000>';
		const { mapping } = await redactSupportEmail();

		const [main] = await runNode(
			'restore',
			{ mapping, unresolvedTokens: 'keep' },
			itemsOf({ output: `cc ${invented}` }),
		);

		expect(main?.[0]?.json.restored).toBe(`cc ${invented}`);
	});
});

describe('Validate Tool Call operation', () => {
	async function setup() {
		const { redacted, mapping } = await redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');
		const base = {
			mapping,
			requiredTokens: [email],
			tokenOnlyFields: 'to',
			restoreFields: 'to, body',
		};
		return { email, iban: tokenIn(redacted, 'IBAN'), base };
	}

	it('restores allowed fields of approved arguments given as a JSON string', async () => {
		const { email, iban, base } = await setup();
		const toolCallArgs = JSON.stringify({ to: email, body: `Refund sent to ${iban}`, note: iban });

		const outputs = await runNode('validateToolCall', { ...base, toolCallArgs }, itemsOf({}));

		expect(outputs).toHaveLength(1);
		expect(outputs[0]?.[0]?.json).toMatchObject({
			toolArgs: { to: FIXTURE.email, body: `Refund sent to ${FIXTURE.iban}`, note: iban },
			_setherValidation: { approved: true, restoredPaths: ['to', 'body'] },
		});
	});

	it('stops the workflow on a violation and lists it without PII', async () => {
		const { base } = await setup();
		const toolCallArgs = { to: 'attacker@evil.example', body: 'Your IBAN is attached' };

		const run = runNode('validateToolCall', { ...base, toolCallArgs }, itemsOf({}));

		await expect(run).rejects.toBeInstanceOf(NodeOperationError);
		await expect(run).rejects.toMatchObject({
			message: 'Tool call rejected: 2 guardrail violation(s)',
			description: expect.stringContaining('Field "to" must be exactly one token') as unknown,
		});
	});

	it('routes violations to the second output and restores nothing', async () => {
		const { email, base } = await setup();
		const toolCallArgs = { to: email.slice(1, -1), body: 'hi' };

		const outputs = await runNode(
			'validateToolCall',
			{ ...base, toolCallArgs, onViolation: 'route' },
			itemsOf({ toolCall: { arguments: toolCallArgs } }),
		);

		expect(outputs).toHaveLength(2);
		expect(outputs[0]).toEqual([]);
		const rejected = outputs[1]?.[0]?.json ?? {};
		expect(rejected._setherValidation).toMatchObject({ approved: false });
		expect(JSON.stringify(rejected)).not.toContain(FIXTURE.email);
	});

	it('splits a batch between approved and rejected outputs', async () => {
		const { email, base } = await setup();
		const good = { to: email, body: 'ok' };
		const bad = { to: email, body: 'cc <EMAIL_00000000-0000-0000-0000-000000000000>' };

		const outputs = await runNode(
			'validateToolCall',
			{ ...base, toolCallArgs: good, onViolation: 'route' },
			itemsOf({}),
		);
		const rejectedOutputs = await runNode(
			'validateToolCall',
			{ ...base, toolCallArgs: bad, onViolation: 'route' },
			itemsOf({}),
		);

		expect(outputs.map((output) => output.length)).toEqual([1, 0]);
		expect(rejectedOutputs.map((output) => output.length)).toEqual([0, 1]);
	});

	it('sends a failed item to the rejected output, never the approved one, when continuing on fail', async () => {
		const { base } = await setup();

		const outputs = await runNode(
			'validateToolCall',
			{ ...base, toolCallArgs: '{not json', onViolation: 'route' },
			itemsOf({}),
			{ continueOnFail: true },
		);

		expect(outputs[0]).toEqual([]);
		expect(outputs[1]?.[0]?.json).toEqual({ error: 'Tool call arguments are not valid JSON' });
	});

	it('can output the restored arguments as a valid JSON string', async () => {
		const { email, base } = await setup();
		const toolCallArgs = { to: email, body: `Hi "${email}"` };

		const [main] = await runNode(
			'validateToolCall',
			{ ...base, toolCallArgs, outputFormat: 'jsonString' },
			itemsOf({}),
		);

		const parsed: unknown = JSON.parse(asString(main?.[0]?.json.toolArgs));
		expect(parsed).toEqual({ to: FIXTURE.email, body: `Hi "${FIXTURE.email}"` });
	});

	it('fails clearly when the mapping expression is not wired', async () => {
		const { email } = await setup();

		await expect(
			runNode('validateToolCall', { toolCallArgs: { to: email } }, itemsOf({})),
		).rejects.toThrow("Mapping is empty: reference the Redact node's mapping field");
	});
});
