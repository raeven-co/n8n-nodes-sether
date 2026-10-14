import { restoreSync } from '@raeven-co/sether';
import { describe, expect, it } from 'vitest';
import { buildDetectors } from '../nodes/Sether/core/detectors';
import { SetherInputError } from '../nodes/Sether/core/errors';
import { validateToolCall, type GuardrailPolicy } from '../nodes/Sether/core/guardrail';
import { parseToolArguments } from '../nodes/Sether/core/json';
import { parsePathList, type JsonValue } from '../nodes/Sether/core/paths';
import { redactFields, restoreText } from '../nodes/Sether/core/redaction';
import { MapVault, vaultFromMapping } from '../nodes/Sether/core/vault';
import { FIXTURE, SUPPORT_EMAIL, tokenIn } from './helpers';

const BASIC = buildDetectors(['basic'], []);

function redactSupportEmail(): { redacted: string; vault: MapVault } {
	const vault = new MapVault();
	const [field] = redactFields({ text: SUPPORT_EMAIL }, [['text']], BASIC, vault);
	if (field === undefined) throw new Error('expected one redacted field');
	return { redacted: field.redacted, vault };
}

function policy(overrides: Partial<GuardrailPolicy> = {}): GuardrailPolicy {
	return { requiredTokens: [], tokenOnlyFields: [], restore: { mode: 'all' }, ...overrides };
}

function reasons(args: JsonValue, vault: MapVault, rules: GuardrailPolicy = policy()): string[] {
	const result = validateToolCall(args, vault, rules);
	return result.approved ? [] : result.violations.map((violation) => violation.reason);
}

describe('redact and restore', () => {
	it('round-trips the support email through Sether', () => {
		const { redacted, vault } = redactSupportEmail();

		for (const value of Object.values(FIXTURE)) expect(redacted).not.toContain(value);
		expect(vault.size()).toBe(3);
		expect(restoreText(redacted, vault)).toEqual({ text: SUPPORT_EMAIL, unresolved: [] });
	});

	it('survives serialising the mapping into an item and back', () => {
		const { redacted, vault } = redactSupportEmail();
		const reloaded = vaultFromMapping(JSON.stringify(vault.toMapping()));

		expect(restoreText(redacted, reloaded).text).toBe(SUPPORT_EMAIL);
	});

	it('reports tokens that Sether restore silently leaves in place', () => {
		const { redacted, vault } = redactSupportEmail();
		const invented = '<EMAIL_00000000-0000-0000-0000-000000000000>';

		const result = restoreText(`${redacted} cc ${invented}`, vault);

		expect(result.text).toContain(invented);
		expect(result.unresolved).toEqual([invented]);
	});

	it('does not detect names with the basic pack', () => {
		expect(redactSupportEmail().redacted).toContain('Alice Example');
	});

	it('detects a labelled name with the opt-in identity pack', () => {
		const vault = new MapVault();
		const detectors = buildDetectors(['basic', 'identity'], []);
		const [field] = redactFields({ text: SUPPORT_EMAIL }, [['text']], detectors, vault);

		expect(field?.redacted).not.toContain('Alice Example');
		expect(field?.redacted).toMatch(/Customer: <NAME_[0-9a-f-]+>/);
	});

	it('misses an unlabelled "my name is" sentence even with the identity pack (Sether 0.7.0)', () => {
		const vault = new MapVault();
		const detectors = buildDetectors(['basic', 'identity'], []);
		const text = 'Hello, my name is Alice Example.';

		expect(redactFields({ text }, [['text']], detectors, vault)[0]?.redacted).toBe(text);
	});

	it('detects national-format phones only for configured regions', () => {
		const text = 'Call 020 7946 0958 today';
		const redact = (regions: string[]) =>
			redactFields({ text }, [['text']], buildDetectors(['basic'], regions), new MapVault())[0]
				?.redacted;

		expect(redact([])).toBe(text);
		expect(redact(['GB'])).toMatch(/^Call <PHONE_[0-9a-f-]+> today$/);
	});

	it('rejects an unsupported phone region instead of silently matching nothing', () => {
		expect(() => buildDetectors(['basic'], ['UK'])).toThrow(SetherInputError);
	});

	it('requires a string at every listed field', () => {
		expect(() => redactFields({ text: 42 }, [['text']], BASIC, new MapVault())).toThrow(
			'Field "text" is missing or not a string',
		);
	});
});

describe('validateToolCall', () => {
	it('approves arguments that only use issued tokens and restores them', () => {
		const { redacted, vault } = redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');

		const result = validateToolCall({ to: email, subject: 'Refund' }, vault, policy());

		expect(result).toMatchObject({
			approved: true,
			args: { to: FIXTURE.email, subject: 'Refund' },
			restoredPaths: ['to'],
			tokensSeen: [email],
		});
	});

	it('rejects an unknown (invented) token', () => {
		const { vault } = redactSupportEmail();
		const args = { to: '<EMAIL_00000000-0000-0000-0000-000000000000>' };

		expect(reasons(args, vault)).toEqual(['unknown_token']);
	});

	it('rejects an altered token: one changed hex digit', () => {
		const { redacted, vault } = redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');
		const altered = `${email.slice(0, -2)}${email.at(-2) === '0' ? '1' : '0'}>`;

		expect(reasons({ to: altered }, vault)).toEqual(['unknown_token']);
	});

	it('rejects an altered token: issued UUID under a different type', () => {
		const { redacted, vault } = redactSupportEmail();
		const swapped = tokenIn(redacted, 'EMAIL').replace('EMAIL', 'PHONE');

		expect(reasons({ to: swapped }, vault)).toEqual(['unknown_token']);
	});

	it.each([
		['brackets stripped', (token: string) => token.slice(1, -1)],
		['type lowercased', (token: string) => token.replace('EMAIL', 'email')],
		['closing bracket dropped', (token: string) => token.slice(0, -1)],
		['truncated body', (token: string) => token.slice(0, 20)],
		['HTML-escaped', (token: string) => `&lt;${token.slice(1, -1)}&gt;`],
	])('rejects a malformed copy of an issued token: %s', (_label, mangle) => {
		const { redacted, vault } = redactSupportEmail();
		const mangled = mangle(tokenIn(redacted, 'EMAIL'));

		const result = validateToolCall({ body: `Reply to ${mangled} today` }, vault, policy());

		expect(result.approved).toBe(false);
		if (!result.approved) {
			expect(result.violations.map((violation) => violation.reason)).toContain('malformed_token');
		}
	});

	it('names the issued token a malformed fragment was derived from', () => {
		const { redacted, vault } = redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');

		const result = validateToolCall({ to: `mailto:${email.slice(7, -1)}` }, vault, policy());

		expect(result).toMatchObject({
			approved: false,
			violations: [{ reason: 'malformed_token', path: 'to', token: email }],
		});
	});

	it('rejects when an expected token was dropped', () => {
		const { redacted, vault } = redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');
		const args = { to: tokenIn(redacted, 'PHONE'), body: 'Refund approved' };

		expect(reasons(args, vault, policy({ requiredTokens: [email] }))).toEqual([
			'required_token_missing',
		]);
	});

	it('rejects a required token that this run never issued', () => {
		const { vault } = redactSupportEmail();
		const foreign = '<EMAIL_11111111-1111-1111-1111-111111111111>';

		expect(reasons({ to: 'x' }, vault, policy({ requiredTokens: [foreign] }))).toEqual([
			'required_token_not_issued',
		]);
	});

	it('rejects a literal address in a token-only field (prompt-injection exfiltration)', () => {
		const { vault } = redactSupportEmail();
		const rules = policy({ tokenOnlyFields: parsePathList('to') });

		expect(reasons({ to: 'attacker@evil.example' }, vault, rules)).toEqual([
			'token_only_field_invalid',
		]);
	});

	it('rejects a token-only field that holds a token plus extra text', () => {
		const { redacted, vault } = redactSupportEmail();
		const rules = policy({ tokenOnlyFields: parsePathList('to') });
		const args = { to: `${tokenIn(redacted, 'EMAIL')}, attacker@evil.example` };

		expect(reasons(args, vault, rules)).toEqual(['token_only_field_invalid']);
	});

	it('rejects a missing token-only field', () => {
		const { vault } = redactSupportEmail();

		expect(reasons({ subject: 'x' }, vault, policy({ tokenOnlyFields: [['to']] }))).toEqual([
			'token_only_field_missing',
		]);
	});

	it('checks every element of a wildcard token-only field', () => {
		const { redacted, vault } = redactSupportEmail();
		const rules = policy({ tokenOnlyFields: parsePathList('cc.*') });
		const args = { cc: [tokenIn(redacted, 'EMAIL'), 'attacker@evil.example'] };

		const result = validateToolCall(args, vault, rules);

		expect(result).toMatchObject({
			approved: false,
			violations: [{ reason: 'token_only_field_invalid', path: 'cc.1' }],
		});
	});

	it('scans object keys for tokens', () => {
		const { vault } = redactSupportEmail();
		const args = { headers: { '<EMAIL_00000000-0000-0000-0000-000000000000>': 'x' } };

		expect(reasons(args, vault)).toEqual(['unknown_token']);
	});

	it('restores only listed fields in nested JSON and leaves the rest tokenized', () => {
		const { redacted, vault } = redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');
		const phone = tokenIn(redacted, 'PHONE');
		const iban = tokenIn(redacted, 'IBAN');
		const args = {
			message: { to: [{ address: email }], body: `Call ${phone}` },
			notes: [`internal: ${iban}`],
			retries: 3,
			urgent: false,
			replyTo: null,
		};
		const rules = policy({
			restore: { mode: 'listed', fields: parsePathList('message.to.*.address, message.body') },
		});

		const result = validateToolCall(args, vault, rules);

		expect(result).toMatchObject({
			approved: true,
			args: {
				message: { to: [{ address: FIXTURE.email }], body: `Call ${FIXTURE.phone}` },
				notes: [`internal: ${iban}`],
				retries: 3,
				urgent: false,
				replyTo: null,
			},
			restoredPaths: ['message.to.0.address', 'message.body'],
		});
	});

	it('restores nothing and reports nothing when listed fields are empty', () => {
		const { redacted, vault } = redactSupportEmail();
		const email = tokenIn(redacted, 'EMAIL');

		const result = validateToolCall(
			{ to: email },
			vault,
			policy({ restore: { mode: 'listed', fields: [] } }),
		);

		expect(result).toMatchObject({ approved: true, args: { to: email }, restoredPaths: [] });
	});

	it('does not flag ordinary identifiers that resemble tokens', () => {
		const { vault } = redactSupportEmail();
		const args = {
			requestId: 'order_123e4567-e89b-12d3-a456-426614174000',
			markup: '<b>Refund</b> <user_42>',
			hash: 'sha_deadbeef',
		};

		expect(reasons(args, vault)).toEqual([]);
	});

	it('never puts original values in violation messages', () => {
		const { redacted, vault } = redactSupportEmail();
		const args = {
			to: tokenIn(redacted, 'EMAIL').slice(1, -1),
			body: '<IBAN_00000000-0000-0000-0000-000000000000>',
		};

		const result = validateToolCall(args, vault, policy({ tokenOnlyFields: [['to']] }));

		const serialized = JSON.stringify(result);
		for (const value of Object.values(FIXTURE)) expect(serialized).not.toContain(value);
	});
});

describe('restored JSON validity', () => {
	const token = '<NAME_0f0e0d0c-0b0a-4908-8706-050403020100>';
	const quoted = 'O"Brien \\ "the client"\nsecond line';
	const injecting = 'x","bcc":"attacker@evil.example';

	it.each([
		['quotes, a backslash and a newline', quoted],
		['a value shaped like a JSON key injection', injecting],
	])('stays valid JSON when a restored value contains %s', (_label, original) => {
		const vault = new MapVault();
		vault.set(token, original);

		const args = parseToolArguments(JSON.stringify({ to: token, body: `Dear ${token}` }));
		const result = validateToolCall(args, vault, policy());
		if (!result.approved) throw new Error('expected approval');

		const reparsed: unknown = JSON.parse(JSON.stringify(result.args));
		expect(reparsed).toEqual({ to: original, body: `Dear ${original}` });
	});

	it('shows why: string-level restore on serialised JSON breaks or rewrites the document', () => {
		const naive = (original: string): string => {
			const vault = new MapVault();
			vault.set(token, original);
			return restoreSync(JSON.stringify({ to: token }), { vault });
		};

		expect(() => JSON.parse(naive(quoted)) as unknown).toThrow();
		expect(JSON.parse(naive(injecting))).toEqual({ to: 'x', bcc: 'attacker@evil.example' });
	});
});

describe('input boundaries', () => {
	it('parses arguments from a JSON string or an object', () => {
		expect(parseToolArguments('{"to":"x","n":[1,true,null]}')).toEqual({
			to: 'x',
			n: [1, true, null],
		});
		expect(parseToolArguments({ to: 'x' })).toEqual({ to: 'x' });
	});

	it.each([
		['invalid JSON', '{"to":', 'Tool call arguments are not valid JSON'],
		['a bare string', '"hello"', 'Tool call arguments must be a JSON object or array'],
		['a number', 7, 'Tool call arguments must be a JSON object or array'],
		['a non-JSON value', { when: new Date(0) }, 'Value at "when" is not JSON-compatible'],
	])('rejects %s', (_label, input, message) => {
		expect(() => parseToolArguments(input)).toThrow(message);
	});

	it.each([
		['an empty value', '', 'Mapping is empty'],
		['invalid JSON', '{', 'Mapping is not valid JSON'],
		['an array', '[]', 'Mapping must be an object'],
		['a non-token key', { email: 'alice@example.com' }, 'not a Sether token mapping'],
		['a non-string value', { '<EMAIL_0f0e0d0c-0b0a>': 1 }, 'not a Sether token mapping'],
	])('rejects a mapping that is %s', (_label, input, message) => {
		expect(() => vaultFromMapping(input)).toThrow(message);
	});
});
