/**
 * Token grammar of @raeven-co/sether 0.7.0: `<TYPE_uuid>`.
 *
 * Sether keeps this pattern in src/token.ts (`TOKEN_RE`) but the published
 * package does not export it, so it is mirrored here. It must stay identical
 * to Sether's: a string this module calls well-formed is exactly a string
 * Sether's `restoreSync` would try to replace.
 */
const TOKEN_PATTERN = '<[A-Z_][A-Z0-9_]*_[0-9a-fA-F-]{8,}>';

// `<` + type + `_` + 8 hex digits that never completed into a well-formed
// token (missing `>`, lowercased type, truncated body). Bounded quantifiers.
const OPEN_FRAGMENT_RE = /<[A-Za-z_][A-Za-z0-9_]{0,63}_[0-9a-fA-F]{8}/g;

// An uppercase type plus a full UUID body with the angle brackets stripped.
const BARE_TOKEN_RE =
	/[A-Z][A-Z0-9_]{0,63}_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

const FINGERPRINT_LENGTH = 8;

export interface MalformedFragment {
	readonly fragment: string;
	/** The issued token this fragment appears to be derived from, if any. */
	readonly resembles?: string;
}

export interface TokenScan {
	/** Well-formed tokens that were issued in this run. */
	readonly known: readonly string[];
	/** Well-formed tokens that were not issued in this run. */
	readonly unknown: readonly string[];
	/** Token-shaped text that is not a well-formed token. */
	readonly malformed: readonly MalformedFragment[];
}

export function isWellFormedToken(value: string): boolean {
	return new RegExp(`^${TOKEN_PATTERN}$`).test(value);
}

export function findWellFormedTokens(text: string): string[] {
	return text.match(new RegExp(TOKEN_PATTERN, 'g')) ?? [];
}

/**
 * Classify every token-shaped substring of `text` against the set of tokens
 * issued in this run. Restoration only replaces well-formed issued tokens, so
 * anything in `unknown` or `malformed` would otherwise pass through silently.
 */
export function scanTokens(text: string, issued: ReadonlySet<string>): TokenScan {
	const wellFormed = findWellFormedTokens(text);
	const residual = text.replace(new RegExp(TOKEN_PATTERN, 'g'), ' ');
	return {
		known: wellFormed.filter((token) => issued.has(token)),
		unknown: wellFormed.filter((token) => !issued.has(token)),
		malformed: findMalformed(residual, issued),
	};
}

function findMalformed(residual: string, issued: ReadonlySet<string>): MalformedFragment[] {
	const shaped = [
		...(residual.match(OPEN_FRAGMENT_RE) ?? []),
		...(residual.match(BARE_TOKEN_RE) ?? []),
	];
	const fragments: MalformedFragment[] = [...new Set(shaped)].map((fragment) => ({ fragment }));
	const shapedLower = shaped.map((fragment) => fragment.toLowerCase());
	for (const altered of findIssuedFingerprints(residual, issued)) {
		const alreadyReported = shapedLower.some((fragment) => fragment.includes(altered.fragment));
		if (!alreadyReported) fragments.push(altered);
	}
	return fragments;
}

/**
 * Catch altered copies of issued tokens (type changed, brackets stripped,
 * case changed, body truncated) by looking for the first eight hex digits of
 * each issued token's body outside well-formed tokens.
 */
function findIssuedFingerprints(
	residual: string,
	issued: ReadonlySet<string>,
): MalformedFragment[] {
	const haystack = residual.toLowerCase();
	const hits: MalformedFragment[] = [];
	for (const token of issued) {
		const fingerprint = tokenFingerprint(token);
		if (fingerprint.length === FINGERPRINT_LENGTH && haystack.includes(fingerprint)) {
			hits.push({ fragment: fingerprint, resembles: token });
		}
	}
	return hits;
}

function tokenFingerprint(token: string): string {
	const body = token.slice(token.lastIndexOf('_') + 1, -1);
	return body.replace(/-/g, '').slice(0, FINGERPRINT_LENGTH).toLowerCase();
}
