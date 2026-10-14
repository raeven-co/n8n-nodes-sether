import { SetherInputError } from './errors';
import { formatPath, type JsonObject, type JsonValue, type Path } from './paths';
import { isPlainObject } from './vault';

/**
 * Parse tool-call arguments given either as a JSON string (as most model APIs
 * return them) or as an already-parsed object. The result is a validated deep
 * copy, so later restoration never mutates n8n's item data.
 */
export function parseToolArguments(input: unknown): JsonValue {
	const value: unknown = typeof input === 'string' ? parseJson(input) : input;
	if (!isPlainObject(value) && !Array.isArray(value)) {
		throw new SetherInputError('Tool call arguments must be a JSON object or array');
	}
	return toJsonValue(value, []);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new SetherInputError('Tool call arguments are not valid JSON');
	}
}

function toJsonValue(value: unknown, path: Path): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		return value.map((child: unknown, index) => toJsonValue(child, [...path, String(index)]));
	}
	if (isPlainObject(value)) return toJsonObject(value, path);
	throw new SetherInputError(`Value at "${formatPath(path)}" is not JSON-compatible`);
}

function toJsonObject(value: Record<string, unknown>, path: Path): JsonObject {
	const copy: JsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		copy[key] = toJsonValue(child, [...path, key]);
	}
	return copy;
}
