// tsc emits only JavaScript. Copy the node icon and codex file next to the
// compiled node so n8n can resolve `file:sether.svg` from dist.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STATIC_FILE = /\.(svg|json)$/;
const sourceRoot = 'nodes';
const targetRoot = join('dist', 'nodes');

for (const nodeDir of readdirSync(sourceRoot, { withFileTypes: true })) {
	if (!nodeDir.isDirectory()) continue;
	const from = join(sourceRoot, nodeDir.name);
	const to = join(targetRoot, nodeDir.name);
	mkdirSync(to, { recursive: true });
	for (const file of readdirSync(from)) {
		if (STATIC_FILE.test(file)) copyFileSync(join(from, file), join(to, file));
	}
}
