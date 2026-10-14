import { restoreSync } from '@raeven-co/sether';
import {
	formatPath,
	mapStrings,
	pathMatches,
	walkJson,
	type JsonValue,
	type Path,
} from './paths';
import { scanTokens, type MalformedFragment } from './tokens';
import { isPlainObject, type MapVault } from './vault';

export type RestoreScope =
	| { readonly mode: 'listed'; readonly fields: readonly Path[] }
	| { readonly mode: 'all' };

export interface GuardrailPolicy {
	/** Tokens that must appear in the arguments, e.g. the customer's email token. */
	readonly requiredTokens: readonly string[];
	/** Fields whose whole value must be exactly one token issued in this run. */
	readonly tokenOnlyFields: readonly Path[];
	/** Which string fields get their tokens restored once validation passes. */
	readonly restore: RestoreScope;
}

export type ViolationReason =
	| 'unknown_token'
	| 'malformed_token'
	| 'required_token_not_issued'
	| 'required_token_missing'
	| 'token_only_field_missing'
	| 'token_only_field_invalid';

/** Describes a failed check. Never contains original (restored) values. */
export interface Violation {
	readonly reason: ViolationReason;
	readonly message: string;
	readonly path?: string;
	readonly token?: string;
	readonly fragment?: string;
}

export type GuardrailResult =
	| {
			readonly approved: true;
			readonly args: JsonValue;
			readonly restoredPaths: readonly string[];
			readonly tokensSeen: readonly string[];
	  }
	| { readonly approved: false; readonly violations: readonly Violation[] };

/**
 * Successful restoration alone is not permission to act. Sether's restore
 * replaces the tokens it knows and silently keeps the rest, so a model that
 * invents, alters, or drops a token still produces "restored" arguments.
 * This checks the arguments first and restores only when every check passes.
 */
export function validateToolCall(
	args: JsonValue,
	vault: MapVault,
	policy: GuardrailPolicy,
): GuardrailResult {
	const issued = vault.tokens();
	const scan = scanArguments(args, issued);
	const violations = [
		...scan.violations,
		...checkRequiredTokens(policy.requiredTokens, issued, scan.knownTokens),
		...checkTokenOnlyFields(args, policy.tokenOnlyFields, issued),
	];
	if (violations.length > 0) {
		return { approved: false, violations };
	}
	const restored = restoreArguments(args, vault, policy.restore);
	return { approved: true, ...restored, tokensSeen: [...scan.knownTokens] };
}

interface ArgumentScan {
	readonly violations: Violation[];
	readonly knownTokens: Set<string>;
}

// Scans string values and object keys. Keys are never restored, but a token
// hidden in a key is still a token the model produced.
function scanArguments(args: JsonValue, issued: ReadonlySet<string>): ArgumentScan {
	const result: ArgumentScan = { violations: [], knownTokens: new Set() };
	walkJson(args, (path, node) => {
		if (typeof node === 'string') {
			recordScan(result, formatPath(path), node, issued);
		} else if (isPlainObject(node)) {
			for (const key of Object.keys(node)) {
				recordScan(result, `${formatPath([...path, key])} (key)`, key, issued);
			}
		}
	});
	return result;
}

function recordScan(
	result: ArgumentScan,
	path: string,
	text: string,
	issued: ReadonlySet<string>,
): void {
	const scan = scanTokens(text, issued);
	scan.known.forEach((token) => result.knownTokens.add(token));
	result.violations.push(
		...scan.unknown.map((token) => unknownTokenViolation(path, token)),
		...scan.malformed.map((fragment) => malformedViolation(path, fragment)),
	);
}

function unknownTokenViolation(path: string, token: string): Violation {
	return {
		reason: 'unknown_token',
		path,
		token,
		message: `Token ${token} at "${path}" was not issued in this run (invented, altered, or from another run)`,
	};
}

function malformedViolation(path: string, { fragment, resembles }: MalformedFragment): Violation {
	const origin = resembles === undefined ? '' : ` (looks like an altered copy of ${resembles})`;
	return {
		reason: 'malformed_token',
		path,
		fragment,
		...(resembles === undefined ? {} : { token: resembles }),
		message: `Token-shaped text "${fragment}" at "${path}" is not a valid token${origin}`,
	};
}

function checkRequiredTokens(
	required: readonly string[],
	issued: ReadonlySet<string>,
	seen: ReadonlySet<string>,
): Violation[] {
	return required.flatMap((token): Violation[] => {
		if (!issued.has(token)) {
			return [
				{
					reason: 'required_token_not_issued',
					token,
					message: `Required token ${token} is not in this run's mapping`,
				},
			];
		}
		if (!seen.has(token)) {
			return [
				{
					reason: 'required_token_missing',
					token,
					message: `Required token ${token} is missing from the arguments (dropped by the model)`,
				},
			];
		}
		return [];
	});
}

function checkTokenOnlyFields(
	args: JsonValue,
	patterns: readonly Path[],
	issued: ReadonlySet<string>,
): Violation[] {
	return patterns.flatMap((pattern): Violation[] => {
		const matches = nodesMatching(args, pattern);
		if (matches.length === 0) {
			const path = formatPath(pattern);
			return [
				{
					reason: 'token_only_field_missing',
					path,
					message: `Token-only field "${path}" is missing from the arguments`,
				},
			];
		}
		return matches
			.filter(({ node }) => !(typeof node === 'string' && issued.has(node)))
			.map(({ path }) => tokenOnlyInvalid(formatPath(path)));
	});
}

function tokenOnlyInvalid(path: string): Violation {
	return {
		reason: 'token_only_field_invalid',
		path,
		message: `Field "${path}" must be exactly one token issued in this run, with nothing else`,
	};
}

function nodesMatching(args: JsonValue, pattern: Path): Array<{ path: Path; node: JsonValue }> {
	const matches: Array<{ path: Path; node: JsonValue }> = [];
	walkJson(args, (path, node) => {
		if (pathMatches(pattern, path)) matches.push({ path, node });
	});
	return matches;
}

function restoreArguments(
	args: JsonValue,
	vault: MapVault,
	scope: RestoreScope,
): { args: JsonValue; restoredPaths: string[] } {
	const restoredPaths: string[] = [];
	const restored = mapStrings(args, (path, text) => {
		if (!isRestorable(scope, path)) return text;
		const result = restoreSync(text, { vault });
		if (result !== text) restoredPaths.push(formatPath(path));
		return result;
	});
	return { args: restored, restoredPaths };
}

function isRestorable(scope: RestoreScope, path: Path): boolean {
	return scope.mode === 'all' || scope.fields.some((pattern) => pathMatches(pattern, path));
}
