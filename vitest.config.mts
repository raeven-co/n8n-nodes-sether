import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
	// Load n8n-workflow's CommonJS build, as n8n does at runtime for this
	// CommonJS node package.
	resolve: { alias: { 'n8n-workflow': require.resolve('n8n-workflow') } },
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
