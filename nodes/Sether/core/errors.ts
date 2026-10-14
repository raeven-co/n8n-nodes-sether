/**
 * Raised for bad node configuration or malformed input data. Messages must
 * never contain original (restored) values, because n8n stores error
 * messages in execution data and shows them in the editor.
 */
export class SetherInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SetherInputError';
	}
}
