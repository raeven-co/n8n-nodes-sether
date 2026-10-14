import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { buildDetectors, isDetectorPack, type DetectorPack } from './core/detectors';
import { SetherInputError } from './core/errors';
import { validateToolCall, type GuardrailPolicy, type Violation } from './core/guardrail';
import { parseToolArguments } from './core/json';
import { deleteAtPath, formatPath, parseList, parsePathList } from './core/paths';
import { readText, redactFields, restoreText, type RedactedField } from './core/redaction';
import { MapVault, vaultFromMapping } from './core/vault';
import {
	booleanParam,
	fieldNameParam,
	optionParam,
	rawParam,
	stringParam,
} from './parameters';

export const OPERATIONS = ['redact', 'restore', 'validateToolCall'] as const;
export type Operation = (typeof OPERATIONS)[number];

export const VIOLATION_MODES = ['error', 'route'] as const;
export type ViolationMode = (typeof VIOLATION_MODES)[number];

export interface ItemResult {
	readonly route: 'main' | 'rejected';
	readonly json: IDataObject;
}

/** Raised when Validate Tool Call finds violations in "Stop Workflow" mode. */
export class GuardrailViolationError extends SetherInputError {
	readonly violations: readonly Violation[];

	constructor(violations: readonly Violation[]) {
		super(`Tool call rejected: ${String(violations.length)} guardrail violation(s)`);
		this.name = 'GuardrailViolationError';
		this.violations = violations;
	}
}

export function redactItem(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
): ItemResult {
	const paths = parsePathList(stringParam(ctx, 'textFields', itemIndex));
	const detectors = buildDetectors(
		readPacks(ctx, itemIndex),
		parseList(rawParam(ctx, 'options.phoneRegions', itemIndex, '')),
	);
	const vault = new MapVault();
	const fields = redactFields(item.json, paths, detectors, vault);

	const json = structuredClone(item.json);
	if (!booleanParam(ctx, 'options.keepSourceFields', itemIndex)) {
		for (const path of paths) deleteAtPath(json, path);
	}
	json[fieldNameParam(ctx, 'outputField', itemIndex)] = redactedOutput(fields);
	json[fieldNameParam(ctx, 'mappingField', itemIndex)] = vault.toMapping();
	return { route: 'main', json };
}

function readPacks(ctx: IExecuteFunctions, itemIndex: number): DetectorPack[] {
	const value = rawParam(ctx, 'detectorPacks', itemIndex, []);
	if (!Array.isArray(value) || !value.every(isDetectorPack)) {
		throw new SetherInputError('Detector Packs must be a list of: basic, secrets, identity');
	}
	return value;
}

function redactedOutput(fields: readonly RedactedField[]): string | IDataObject {
	const [only] = fields;
	if (fields.length === 1 && only !== undefined) return only.redacted;
	return Object.fromEntries(fields.map((field) => [formatPath(field.path), field.redacted]));
}

export function restoreItem(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
): ItemResult {
	const path = stringParam(ctx, 'textField', itemIndex).trim().split('.');
	const vault = vaultFromMapping(rawParam(ctx, 'mapping', itemIndex));
	const { text, unresolved } = restoreText(readText(item.json, path), vault);
	const policy = optionParam(ctx, 'unresolvedTokens', itemIndex, ['fail', 'keep'] as const);
	if (policy === 'fail' && unresolved.length > 0) {
		throw new SetherInputError(
			`${String(unresolved.length)} token(s) are not in the mapping and were not restored: ${unresolved.join(', ')}`,
		);
	}
	const json: IDataObject = { ...item.json, [fieldNameParam(ctx, 'outputField', itemIndex)]: text };
	return { route: 'main', json };
}

export function validateItem(
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
): ItemResult {
	const args = parseToolArguments(rawParam(ctx, 'toolCallArgs', itemIndex));
	const vault = vaultFromMapping(rawParam(ctx, 'mapping', itemIndex));
	const result = validateToolCall(args, vault, readPolicy(ctx, itemIndex));

	if (!result.approved) {
		if (violationMode(ctx, itemIndex) === 'error') {
			throw new GuardrailViolationError(result.violations);
		}
		const validation = { approved: false, violations: result.violations };
		return { route: 'rejected', json: { ...item.json, _setherValidation: validation } };
	}

	const format = optionParam(ctx, 'outputFormat', itemIndex, ['object', 'jsonString'] as const);
	const validation = {
		approved: true,
		restoredPaths: result.restoredPaths,
		tokensSeen: result.tokensSeen,
	};
	const json: IDataObject = {
		...item.json,
		[fieldNameParam(ctx, 'outputField', itemIndex)]:
			format === 'jsonString' ? JSON.stringify(result.args) : result.args,
		_setherValidation: validation,
	};
	return { route: 'main', json };
}

export function violationMode(ctx: IExecuteFunctions, itemIndex: number): ViolationMode {
	return optionParam(ctx, 'onViolation', itemIndex, VIOLATION_MODES);
}

function readPolicy(ctx: IExecuteFunctions, itemIndex: number): GuardrailPolicy {
	const scope = optionParam(ctx, 'restoreScope', itemIndex, ['listed', 'all'] as const);
	return {
		requiredTokens: parseList(rawParam(ctx, 'requiredTokens', itemIndex, '')),
		tokenOnlyFields: parsePathList(rawParam(ctx, 'tokenOnlyFields', itemIndex, '')),
		restore:
			scope === 'all'
				? { mode: 'all' }
				: {
						mode: 'listed',
						fields: parsePathList(rawParam(ctx, 'restoreFields', itemIndex, '')),
					},
	};
}
