import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
if (!output.startsWith(resolve(root) + sep) || output === resolve(root)) throw new Error('Unsafe build output');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'src', 'assets']) await cp(resolve(root, path), resolve(output, path), { recursive: true });
console.log('Built static website → dist/');
