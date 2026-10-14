import {
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { OUTPUTS_EXPRESSION, properties } from './description';
import {
	GuardrailViolationError,
	OPERATIONS,
	redactItem,
	restoreItem,
	validateItem,
	violationMode,
	type ItemResult,
	type Operation,
} from './operations';
import { optionParam } from './parameters';

type ItemHandler = (
	ctx: IExecuteFunctions,
	item: INodeExecutionData,
	itemIndex: number,
) => ItemResult;

const HANDLERS: Record<Operation, ItemHandler> = {
	redact: redactItem,
	restore: restoreItem,
	validateToolCall: validateItem,
};

// Deliberately not `usableAsTool` (n8n's type has no `false`): exposing Restore
// to an AI agent would let the model read the original PII back.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class Sether implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sether',
		name: 'sether',
		icon: { light: 'file:sether.svg', dark: 'file:sether.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description:
			'Redact PII before AI steps, restore it after, and validate tool-call arguments before acting',
		defaults: {
			name: 'Sether',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: OUTPUTS_EXPRESSION,
		properties,
	};

	// n8n's INodeType contract requires a Promise; this node does no I/O.
	// eslint-disable-next-line @typescript-eslint/require-await
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = optionParam(this, 'operation', 0, OPERATIONS);
		const routing = hasRejectedOutput(this, operation);
		const main: INodeExecutionData[] = [];
		const rejected: INodeExecutionData[] = [];

		for (const [itemIndex, item] of items.entries()) {
			try {
				const result = HANDLERS[operation](this, item, itemIndex);
				const output = result.route === 'rejected' ? rejected : main;
				output.push({ json: result.json, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (!this.continueOnFail()) throw toNodeError(this, error, itemIndex);
				// When routing, an item that failed must never land on the approved path.
				const output = routing ? rejected : main;
				output.push({ json: { error: errorMessage(error) }, pairedItem: { item: itemIndex } });
			}
		}

		return routing ? [main, rejected] : [main];
	}
}

function hasRejectedOutput(ctx: IExecuteFunctions, operation: Operation): boolean {
	return operation === 'validateToolCall' && violationMode(ctx, 0) === 'route';
}

function toNodeError(
	ctx: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): NodeOperationError {
	if (error instanceof GuardrailViolationError) {
		return new NodeOperationError(ctx.getNode(), error.message, {
			itemIndex,
			description: error.violations.map((violation) => violation.message).join('\n'),
		});
	}
	return new NodeOperationError(ctx.getNode(), errorMessage(error), { itemIndex });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
