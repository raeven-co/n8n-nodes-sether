import {
	NodeHelpers,
	Workflow,
	type IDataObject,
	type IExecuteFunctions,
	type INode,
	type INodeExecutionData,
	type INodeParameters,
	type INodeTypes,
} from 'n8n-workflow';
import { Sether } from '../nodes/Sether/Sether.node';

// Fictional values. The email uses the RFC 2606 reserved domain, the phone is
// in Ofcom's drama range (020 7946 0xxx), and the IBAN is the standard
// documentation example; all three appear in Sether's own test fixtures.
export const FIXTURE = {
	email: 'alice@example.com',
	phone: '+44 20 7946 0958',
	iban: 'GB82 WEST 1234 5698 7654 32',
} as const;

// "Alice Example" is fictional. The "Customer:" label is what lets Sether's
// opt-in identity pack find it; the basic pack never detects names.
export const SUPPORT_EMAIL =
	`Hello, please refund order 1042 to my account ${FIXTURE.iban}. ` +
	`You can reach me at ${FIXTURE.email} or ${FIXTURE.phone}.\nCustomer: Alice Example`;

export function tokenIn(text: string, type: string): string {
	const match = new RegExp(`<${type}_[0-9a-f-]+>`).exec(text);
	if (match === null) throw new Error(`No ${type} token in: ${text}`);
	return match[0];
}

interface FakeOptions {
	readonly continueOnFail?: boolean;
}

/**
 * Minimal stand-in for n8n's execution context. Parameters are resolved with
 * n8n-workflow's own NodeHelpers.getNodeParameters (defaults + displayOptions),
 * so tests exercise the shipped defaults the way n8n fills them in.
 */
export function fakeContext(
	operation: string,
	overrides: IDataObject,
	items: INodeExecutionData[],
	options: FakeOptions = {},
): IExecuteFunctions {
	const params: IDataObject = { ...resolveParameters({ operation, ...overrides }), ...overrides };
	const node: INode = {
		id: 'test-node',
		name: 'Sether',
		type: 'n8n-nodes-sether.sether',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
	const context = {
		getInputData: () => items,
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown): unknown =>
			lookup(params, name) ?? fallback,
		getNode: () => node,
		continueOnFail: () => options.continueOnFail ?? false,
	};
	return context as unknown as IExecuteFunctions;
}

export async function runNode(
	operation: string,
	overrides: IDataObject,
	items: INodeExecutionData[],
	options: FakeOptions = {},
): Promise<INodeExecutionData[][]> {
	const node = new Sether();
	return node.execute.call(fakeContext(operation, overrides, items, options));
}

export function asString(value: unknown): string {
	if (typeof value !== 'string') throw new Error(`Expected a string, got ${typeof value}`);
	return value;
}

export function itemsOf(...json: IDataObject[]): INodeExecutionData[] {
	return json.map((entry) => ({ json: entry }));
}

/** n8n's own parameter resolution: fills defaults, drops hidden parameters. */
export function resolveParameters(parameters: INodeParameters): INodeParameters {
	const { description } = new Sether();
	const resolved = NodeHelpers.getNodeParameters(
		description.properties,
		parameters,
		true,
		false,
		null,
		description,
	);
	if (resolved === null) throw new Error('n8n could not resolve the node parameters');
	return resolved;
}

function lookup(params: IDataObject, name: string): unknown {
	let current: unknown = params;
	for (const segment of name.split('.')) {
		if (typeof current !== 'object' || current === null) return undefined;
		current = (current as IDataObject)[segment];
	}
	return current;
}

/** The outputs n8n-workflow computes for a Sether node with these parameters. */
export function nodeOutputs(parameters: INodeParameters): unknown {
	const sether = new Sether();
	const nodeTypes: INodeTypes = {
		getByName: () => sether,
		getByNameAndVersion: () => sether,
		getKnownTypes: () => ({}),
	};
	const node: INode = {
		id: 'outputs-node',
		name: 'Sether',
		type: 'n8n-nodes-sether.sether',
		typeVersion: 1,
		position: [0, 0],
		parameters: resolveParameters(parameters),
	};
	const workflow = new Workflow({ nodes: [node], connections: {}, active: false, nodeTypes });
	return NodeHelpers.getNodeOutputs(workflow, node, sether.description);
}
