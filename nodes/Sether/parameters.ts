import type { IExecuteFunctions } from 'n8n-workflow';
import { SetherInputError } from './core/errors';

/** Raw parameter value; callers validate it at this boundary. */
export function rawParam(
	ctx: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback?: unknown,
): unknown {
	return ctx.getNodeParameter(name, itemIndex, fallback);
}

export function stringParam(ctx: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = rawParam(ctx, name, itemIndex, '');
	if (typeof value !== 'string') {
		throw new SetherInputError(`Parameter "${name}" must be a string`);
	}
	return value;
}

/** A non-empty field name used to write output into the item. */
export function fieldNameParam(ctx: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = stringParam(ctx, name, itemIndex).trim();
	if (value === '') {
		throw new SetherInputError(`Parameter "${name}" must not be empty`);
	}
	return value;
}

export function booleanParam(ctx: IExecuteFunctions, name: string, itemIndex: number): boolean {
	const value = rawParam(ctx, name, itemIndex, false);
	if (typeof value !== 'boolean') {
		throw new SetherInputError(`Parameter "${name}" must be true or false`);
	}
	return value;
}

export function optionParam<T extends string>(
	ctx: IExecuteFunctions,
	name: string,
	itemIndex: number,
	allowed: readonly T[],
): T {
	const value = rawParam(ctx, name, itemIndex);
	const match = allowed.find((option) => option === value);
	if (match === undefined) {
		throw new SetherInputError(`Parameter "${name}" must be one of: ${allowed.join(', ')}`);
	}
	return match;
}
