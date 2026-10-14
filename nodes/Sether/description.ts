import type { INodeProperties } from 'n8n-workflow';

const showFor = (operation: string) => ({ show: { operation: [operation] } });

const MAPPING_DESCRIPTION =
	'The token mapping written by the Redact operation. It contains the original PII: reference it with an expression, never pass it to an AI node.';

const operationProperty: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Redact',
			value: 'redact',
			description: 'Replace PII in text fields with tokens and output the token mapping separately',
			action: 'Redact PII from text',
		},
		{
			name: 'Restore',
			value: 'restore',
			description: 'Replace tokens in a text field with the original values',
			action: 'Restore tokens in text',
		},
		{
			name: 'Validate Tool Call',
			value: 'validateToolCall',
			description:
				'Reject tool-call arguments with unknown, altered, or missing tokens, then restore allowed fields',
			action: 'Validate and restore tool call arguments',
		},
	],
	default: 'redact',
};

const redactProperties: INodeProperties[] = [
	{
		displayName: 'Text Fields',
		name: 'textFields',
		type: 'string',
		default: 'text',
		required: true,
		placeholder: 'e.g. text, email.body',
		description: 'Comma-separated paths of the string fields to redact. Other fields are not scanned.',
		displayOptions: showFor('redact'),
	},
	{
		displayName: 'Detector Packs',
		name: 'detectorPacks',
		type: 'multiOptions',
		options: [
			{
				name: 'Basic',
				value: 'basic',
				description: 'Email, phone (international format), credit card, SSN, IBAN, IPv4, IPv6',
			},
			{
				name: 'Identity (Opt-In)',
				value: 'identity',
				description: 'Label-anchored names, dates of birth, passport numbers, addresses',
			},
			{
				name: 'Secrets (Opt-In)',
				value: 'secrets',
				description: 'API keys, access tokens, JWTs, labelled passwords, high-entropy strings',
			},
		],
		default: ['basic'],
		description: 'Which Sether detector packs to run',
		displayOptions: showFor('redact'),
	},
	{
		displayName: 'Output Field',
		name: 'outputField',
		type: 'string',
		default: 'redacted',
		description:
			'Field for the redacted text. With several text fields it holds an object keyed by field path.',
		displayOptions: showFor('redact'),
	},
	{
		displayName: 'Mapping Field',
		name: 'mappingField',
		type: 'string',
		default: '_setherVault',
		description:
			'Field for the token mapping. It contains the original PII and must never reach an AI node.',
		displayOptions: showFor('redact'),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: showFor('redact'),
		options: [
			{
				displayName: 'Keep Source Fields',
				name: 'keepSourceFields',
				type: 'boolean',
				default: false,
				description:
					'Whether to keep the original text fields in the output. Off by default so the only copy of the PII is the mapping.',
			},
			{
				displayName: 'Phone Regions',
				name: 'phoneRegions',
				type: 'string',
				default: '',
				placeholder: 'e.g. US, GB, NG',
				description:
					'Two-letter country codes whose national phone formats should also be detected. Without this, only numbers with a country code are found. Applies to the Basic pack.',
			},
		],
	},
];

const restoreProperties: INodeProperties[] = [
	{
		displayName: 'Text Field',
		name: 'textField',
		type: 'string',
		default: 'output',
		required: true,
		placeholder: 'e.g. output',
		description: 'Path of the string field whose tokens should be restored',
		displayOptions: showFor('restore'),
	},
	{
		displayName: 'Mapping',
		name: 'mapping',
		type: 'json',
		default: '={{ $json._setherVault }}',
		required: true,
		description: MAPPING_DESCRIPTION,
		displayOptions: showFor('restore'),
	},
	{
		displayName: 'Output Field',
		name: 'outputField',
		type: 'string',
		default: 'restored',
		description: 'Field for the restored text',
		displayOptions: showFor('restore'),
	},
	{
		displayName: 'Unresolved Tokens',
		name: 'unresolvedTokens',
		type: 'options',
		options: [
			{
				name: 'Fail',
				value: 'fail',
				description: 'Stop with an error if the text contains tokens missing from the mapping',
			},
			{
				name: 'Leave in Text',
				value: 'keep',
				description: "Keep unknown tokens as-is (Sether's default restore behaviour)",
			},
		],
		default: 'fail',
		description: 'What to do with tokens that are not in the mapping',
		displayOptions: showFor('restore'),
	},
];

const validateProperties: INodeProperties[] = [
	{
		displayName: 'Tool Call Arguments',
		name: 'toolCallArgs',
		type: 'json',
		default: '={{ $json.toolCall.arguments }}',
		required: true,
		description: 'The arguments the model proposed, as a JSON string or an object',
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Mapping',
		name: 'mapping',
		type: 'json',
		default: '',
		required: true,
		placeholder: "={{ $('Redact PII').item.json._setherVault }}",
		description: MAPPING_DESCRIPTION,
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Required Tokens',
		name: 'requiredTokens',
		// Sether tokens are placeholders, not credentials; masking them would hide the policy.
		// eslint-disable-next-line n8n-nodes-base/node-param-type-options-password-missing
		type: 'string',
		default: '',
		placeholder: 'e.g. <EMAIL_...>',
		description:
			'Comma-separated tokens that must appear in the arguments. An expression may return an array. Fails if the model dropped one.',
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Token-Only Fields',
		name: 'tokenOnlyFields',
		// Sether tokens are placeholders, not credentials; masking them would hide the policy.
		// eslint-disable-next-line n8n-nodes-base/node-param-type-options-password-missing
		type: 'string',
		default: '',
		placeholder: 'e.g. to, cc.*',
		description:
			'Comma-separated paths whose whole value must be exactly one token issued in this run. Use for recipients and other targets the model must not choose freely.',
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Restore Scope',
		name: 'restoreScope',
		type: 'options',
		options: [
			{
				name: 'Listed Fields Only',
				value: 'listed',
				description: 'Restore tokens only in the fields listed below',
			},
			{
				name: 'All String Fields',
				value: 'all',
				description: 'Restore tokens in every string value',
			},
		],
		default: 'listed',
		description: 'Which fields get original values back after validation passes',
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Restore Fields',
		name: 'restoreFields',
		type: 'string',
		default: '',
		placeholder: 'e.g. to, body',
		description:
			'Comma-separated paths to restore. Use * for any key or array index (recipients.*). Fields not listed keep their tokens.',
		displayOptions: { show: { operation: ['validateToolCall'], restoreScope: ['listed'] } },
	},
	{
		displayName: 'On Violation',
		name: 'onViolation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Stop Workflow',
				value: 'error',
				description: 'Fail the execution with an error that lists the violations',
			},
			{
				name: 'Route to Rejected Output',
				value: 'route',
				description: 'Send the item to a second output, for example a human review step',
			},
		],
		default: 'error',
		description: 'What happens when any check fails. Nothing is restored for a rejected item.',
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Output Field',
		name: 'outputField',
		type: 'string',
		default: 'toolArgs',
		description: 'Field for the validated, restored arguments',
		displayOptions: showFor('validateToolCall'),
	},
	{
		displayName: 'Output Format',
		name: 'outputFormat',
		type: 'options',
		options: [
			{ name: 'Object', value: 'object' },
			{ name: 'JSON String', value: 'jsonString' },
		],
		default: 'object',
		description: 'Whether to output the restored arguments as an object or as a JSON string',
		displayOptions: showFor('validateToolCall'),
	},
];

export const properties: INodeProperties[] = [
	operationProperty,
	...redactProperties,
	...restoreProperties,
	...validateProperties,
];

/**
 * Two outputs only when Validate Tool Call routes violations; one otherwise.
 * Evaluated by the n8n editor against the node's current parameters.
 */
export const OUTPUTS_EXPRESSION =
	'={{ $parameter.operation === "validateToolCall" && $parameter.onViolation === "route" ? [{ "type": "main", "displayName": "Approved" }, { "type": "main", "displayName": "Rejected" }] : ["main"] }}' as const;
