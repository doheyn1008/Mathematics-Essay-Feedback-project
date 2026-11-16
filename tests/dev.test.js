import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

test('preview serves only normalized public paths, including encoded traversal and symlinks', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'puleegyeol-preview-'));
  let child;
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'src'));
    await cp(new URL('../scripts/dev.mjs', import.meta.url), join(root, 'scripts/dev.mjs'));
    await writeFile(join(root, 'index.html'), 'public index');
    await writeFile(join(root, 'src/app.js'), 'public javascript');
    await writeFile(join(root, '.env'), 'PRIVATE');
    await writeFile(join(root, 'package.json'), '{"private":true}');
    await symlink(join(root, '.env'), join(root, 'src/link.js'));
    child = spawn(process.execPath, [join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview startup timed out')), 3000);
      child.stdout.on('data', bytes => { const match = String(bytes).match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
      child.once('error', reject);
    });
    const get = path => new Promise((resolve, reject) => {
      request({ hostname: '127.0.0.1', port, path }, response => { let body = ''; response.on('data', bytes => body += bytes); response.on('end', () => resolve({ status: response.statusCode, body })); }).on('error', reject).end();
    });
    assert.deepEqual(await get('/'), { status: 200, body: 'public index' });
    assert.deepEqual(await get('/src/app.js'), { status: 200, body: 'public javascript' });
    for (const path of ['/src/..%2f.env', '/src/..%2fpackage.json', '/src/%2e%2e%2f.env', '/src/link.js', '/package.json']) {
      assert.equal((await get(path)).status, 404, path);
    }
  } finally {
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});
