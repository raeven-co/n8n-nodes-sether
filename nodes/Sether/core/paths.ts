import { SetherInputError } from './errors';
import { isPlainObject } from './vault';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
	[key: string]: JsonValue;
}

/** Path segments from the root, e.g. ['recipients', '0', 'email']. */
export type Path = readonly string[];

const WILDCARD = '*';

/**
 * Parse a comma- or newline-separated list of dot paths ("to, cc.*, body").
 * Also accepts an array of strings, which is what an expression usually
 * returns. Keys that themselves contain dots cannot be addressed.
 */
export function parsePathList(input: unknown): Path[] {
	return parseList(input).map((entry) => entry.split('.'));
}

/** Parse a comma- or newline-separated list, or an array of strings. */
export function parseList(input: unknown): string[] {
	const parts = Array.isArray(input) ? input : splitListString(input);
	return parts.map(requireString).map((part) => part.trim()).filter((part) => part !== '');
}

function splitListString(input: unknown): unknown[] {
	if (input === undefined || input === null) return [];
	if (typeof input !== 'string') {
		throw new SetherInputError('Expected a comma-separated string or an array of strings');
	}
	return input.split(/[,\n]/);
}

function requireString(value: unknown): string {
	if (typeof value !== 'string') {
		throw new SetherInputError('List entries must be strings');
	}
	return value;
}

/** True when `path` matches `pattern` segment by segment; `*` matches any one segment. */
export function pathMatches(pattern: Path, path: Path): boolean {
	return (
		pattern.length === path.length &&
		pattern.every((segment, index) => segment === WILDCARD || segment === path[index])
	);
}

export function formatPath(path: Path): string {
	return path.length === 0 ? '(root)' : path.join('.');
}

/** Visit every node (containers and leaves), depth first, with its path. */
export function walkJson(
	value: JsonValue,
	visit: (path: Path, node: JsonValue) => void,
	path: Path = [],
): void {
	visit(path, value);
	for (const [key, child] of childEntries(value)) {
		walkJson(child, visit, [...path, key]);
	}
}

/** Deep copy of `value` with every string leaf passed through `transform`. */
export function mapStrings(
	value: JsonValue,
	transform: (path: Path, text: string) => string,
	path: Path = [],
): JsonValue {
	if (typeof value === 'string') return transform(path, value);
	if (Array.isArray(value)) {
		return value.map((child, index) => mapStrings(child, transform, [...path, String(index)]));
	}
	if (isPlainObject(value)) {
		const copy: JsonObject = {};
		for (const [key, child] of Object.entries(value)) {
			copy[key] = mapStrings(child, transform, [...path, key]);
		}
		return copy;
	}
	return value;
}

function childEntries(value: JsonValue): Array<[string, JsonValue]> {
	if (Array.isArray(value)) return value.map((child, index) => [String(index), child]);
	if (isPlainObject(value)) return Object.entries(value);
	return [];
}

/** Read the value at a dot path inside an object; undefined when absent. */
export function getAtPath(root: unknown, path: Path): unknown {
	let current: unknown = root;
	for (const segment of path) {
		current = childAt(current, segment);
	}
	return current;
}

function childAt(container: unknown, segment: string): unknown {
	if (Array.isArray(container)) {
		return /^\d+$/.test(segment) ? (container[Number(segment)] as unknown) : undefined;
	}
	if (isPlainObject(container) && Object.hasOwn(container, segment)) {
		return container[segment];
	}
	return undefined;
}

/** Remove the value at a dot path inside an object, if present. */
export function deleteAtPath(root: unknown, path: Path): void {
	const parent = getAtPath(root, path.slice(0, -1));
	const key = path[path.length - 1];
	if (key !== undefined && isPlainObject(parent)) {
		Reflect.deleteProperty(parent, key);
	}
}
