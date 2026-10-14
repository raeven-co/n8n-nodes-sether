// Mirrors @n8n/node-cli's `configWithoutCloudSupport` (n8n's own lint setup
// for community nodes), using the same plugins without the full CLI, and adds
// typescript-eslint's strict type-checked rules.
import js from '@eslint/js';
import { n8nCommunityNodesPlugin } from '@n8n/eslint-plugin-community-nodes';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';
import tseslint from 'typescript-eslint';

const communityNodes = n8nCommunityNodesPlugin.configs.recommendedWithoutN8nCloudSupport;

export default tseslint.config(
	{ ignores: ['dist', 'node_modules', 'eslint.config.mjs', 'scripts'] },
	{ plugins: { 'n8n-nodes-base': n8nNodesBase } },
	{
		files: ['**/*.ts'],
		extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked, communityNodes],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		rules: {
			'no-console': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			// This package exists to wrap @raeven-co/sether, a runtime dependency.
			// That makes it ineligible for n8n verification / n8n Cloud; it is
			// meant for self-hosted n8n. Stated in the README.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
		},
	},
	{
		// The core is n8n-independent so it can be unit-tested without n8n. Its
		// SetherInputError is converted to NodeOperationError in Sether.node.ts.
		files: ['nodes/Sether/core/**/*.ts'],
		rules: { '@n8n/community-nodes/require-node-api-error': 'off' },
	},
	{
		files: ['package.json', '**/*.node.json'],
		extends: [communityNodes],
		rules: {
			...n8nNodesBase.configs.community.rules,
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
			// Not published and no public repository yet; add `homepage` before publishing.
			'@n8n/community-nodes/require-homepage': 'off',
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { extraFileExtensions: ['.json'] },
		},
	},
	{
		files: ['nodes/**/*.ts'],
		rules: {
			...n8nNodesBase.configs.nodes.rules,
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
		},
	},
);
