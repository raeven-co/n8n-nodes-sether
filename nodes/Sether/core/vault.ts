import type { Vault } from '@raeven-co/sether';
import { SetherInputError } from './errors';
import { isWellFormedToken } from './tokens';

/** Token -> original value, as stored in an n8n item. Contains raw PII. */
export type TokenMapping = Record<string, string>;

/**
 * Map-backed implementation of Sether's `Vault` interface.
 *
 * Sether's `MemoryVault` evicts entries (LRU at 10,000 and a one-hour TTL).
 * Here a vault lives for exactly one n8n item and is then serialised into the
 * item, so eviction would only ever silently drop mappings. This vault never
 * evicts.
 */
export class MapVault implements Vault {
	readonly #entries = new Map<string, string>();

	set(token: string, value: string): void {
		this.#entries.set(token, value);
	}

	get(token: string): string | undefined {
		return this.#entries.get(token);
	}

	has(token: string): boolean {
		return this.#entries.has(token);
	}

	delete(token: string): boolean {
		return this.#entries.delete(token);
	}

	size(): number {
		return this.#entries.size;
	}

	clear(): void {
		this.#entries.clear();
	}

	tokens(): ReadonlySet<string> {
		return new Set(this.#entries.keys());
	}

	toMapping(): TokenMapping {
		return Object.fromEntries(this.#entries);
	}
}

/**
 * Build a vault from a mapping produced by the Redact operation. Accepts the
 * object itself or its JSON string form. Rejects anything that is not a flat
 * map of well-formed tokens to strings, so a wrong expression fails loudly
 * instead of turning every token into an "unknown token".
 */
export function vaultFromMapping(input: unknown): MapVault {
	const mapping = parseJsonObject(input);
	const vault = new MapVault();
	for (const [token, value] of Object.entries(mapping)) {
		if (!isWellFormedToken(token) || typeof value !== 'string') {
			throw new SetherInputError(
				'Mapping is not a Sether token mapping: every key must be a <TYPE_uuid> token and every value a string',
			);
		}
		vault.set(token, value);
	}
	return vault;
}

function parseJsonObject(input: unknown): Record<string, unknown> {
	if (input === undefined || input === null || input === '') {
		throw new SetherInputError(
			"Mapping is empty: reference the Redact node's mapping field with an expression",
		);
	}
	const value: unknown = typeof input === 'string' ? parseJson(input) : input;
	if (!isPlainObject(value)) {
		throw new SetherInputError('Mapping must be an object (or a JSON string of an object)');
	}
	return value;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new SetherInputError('Mapping is not valid JSON');
	}
}

/**
 * True for `{}`-style objects, false for arrays and class instances such as
 * Date. Checks the prototype chain depth rather than identity with
 * Object.prototype so objects from another realm still qualify.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}
