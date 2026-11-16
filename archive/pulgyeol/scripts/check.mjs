import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
  return nested.flat();
}
for (const directory of ['scripts', 'src', 'tests']) {
  for (const path of (await files(join(root, directory))).filter((path) => /\.(m?js)$/.test(path))) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
  }
}
const html = await readFile(join(root, 'index.html'), 'utf8');
if (!html.includes('lang="ko"') || !html.includes('type="module"')) throw new Error('Invalid entrypoint');
console.log('All JavaScript syntax and HTML entrypoint checks passed.');
