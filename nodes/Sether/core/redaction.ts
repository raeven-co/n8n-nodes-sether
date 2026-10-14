import { redactSync, restoreSync, type Detector } from '@raeven-co/sether';
import { SetherInputError } from './errors';
import { formatPath, getAtPath, type Path } from './paths';
import type { MapVault } from './vault';
import { findWellFormedTokens } from './tokens';

export interface RedactedField {
	readonly path: Path;
	readonly redacted: string;
}

/**
 * Redact each listed string field of `source` into `vault`. All fields share
 * one vault, so a value repeated across fields gets one token per occurrence
 * but every token restores from the same mapping.
 */
export function redactFields(
	source: unknown,
	paths: readonly Path[],
	detectors: readonly Detector[],
	vault: MapVault,
): RedactedField[] {
	if (paths.length === 0) {
		throw new SetherInputError('List at least one text field to redact');
	}
	return paths.map((path) => ({
		path,
		redacted: redactSync(readText(source, path), { detectors, vault }),
	}));
}

export interface RestoredText {
	readonly text: string;
	/** Well-formed tokens left in the text because the mapping lacks them. */
	readonly unresolved: readonly string[];
}

/**
 * Sether's `restoreSync` replaces issued tokens and silently leaves any token
 * it cannot resolve. This reports those leftovers so the caller can decide.
 */
export function restoreText(text: string, vault: MapVault): RestoredText {
	const unresolved = findWellFormedTokens(text).filter((token) => !vault.has(token));
	return { text: restoreSync(text, { vault }), unresolved: [...new Set(unresolved)] };
}

export function readText(source: unknown, path: Path): string {
	const value = getAtPath(source, path);
	if (typeof value !== 'string') {
		throw new SetherInputError(`Field "${formatPath(path)}" is missing or not a string`);
	}
	return value;
}
