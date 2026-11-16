import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { connectorBridgeOrigin } from '../scripts/vite/connector-preview-plugin.mjs';

const appDir = fileURLToPath(new URL('..', import.meta.url));

test('local sign-in never redirects normalized double-slash paths to external hosts', async () => {
  const input = await readFile(path.join(appDir, 'scripts/vite/sites-vite-plugin.ts'), 'utf8');
  const compiled = ts.transpileModule(input + '\nexport { safeReturn };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { safeReturn } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  for (const candidate of ['/a/..//evil.example', '//evil.example', '/\\evil.example', 'https://evil.example', '/callback']) {
    assert.equal(safeReturn(candidate), '/');
  }
  assert.equal(safeReturn('/classes/one?tab=results#row'), '/classes/one?tab=results#row');
});

test('connector bridge targets the configured IPv4, IPv6 or hostname listener', () => {
  assert.equal(connectorBridgeOrigin('::1', 4173), 'http://[::1]:4173');
  assert.equal(connectorBridgeOrigin('::', 4173), 'http://[::1]:4173');
  assert.equal(connectorBridgeOrigin('127.0.0.1', 4173), 'http://127.0.0.1:4173');
  assert.equal(connectorBridgeOrigin('localhost', 4173), 'http://localhost:4173');
  assert.equal(connectorBridgeOrigin(true, 4173), 'http://127.0.0.1:4173');
});

test('relative runtime overrides retain the caller directory after the wrapper changes cwd', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mathgrade-runtime-'));
  try {
    const result = spawnSync('bash', [path.join(appDir, 'scripts/sites-env.sh'), '--', process.execPath, '-e', 'const fs=require("node:fs"),path=require("node:path"); if (!path.isAbsolute(process.env.SITES_RUNTIME_ROOT) || !fs.existsSync(process.env.TMPDIR)) process.exit(1); console.log(process.env.SITES_RUNTIME_ROOT)'], { cwd: directory, env: { ...process.env, SITES_RUNTIME_ROOT: '.runtime' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), path.join(directory, '.runtime'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('build wrapper runs after checkout strips executable file modes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mathgrade-wrapper-'));
  try {
    await mkdir(path.join(directory, 'scripts'));
    await mkdir(path.join(directory, 'node_modules/.bin'), { recursive: true });
    for (const name of ['build-verified.sh', 'sites-env.sh']) {
      const destination = path.join(directory, 'scripts', name);
      await copyFile(path.join(appDir, 'scripts', name), destination);
      await chmod(destination, 0o644);
    }
    const fakeBuild = path.join(directory, 'node_modules/.bin/vinext');
    await writeFile(fakeBuild, '#!/usr/bin/env bash\n[[ "$1" == "build" ]] || exit 1\necho "build invoked"\n');
    await chmod(fakeBuild, 0o755);
    const result = spawnSync('bash', [path.join(directory, 'scripts/build-verified.sh')], { env: { ...process.env, SITES_ENV_READY: '0', SITES_RUNTIME_ROOT: path.join(directory, '.runtime') }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /build invoked/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy restoration rejects malformed records and preserves valid rubric snapshots', async () => {
  const source = (await readFile(path.join(appDir, 'public/legacy/app.js'), 'utf8')).split('let state = restore();')[0];
  function restore(saved) {
    return vm.runInNewContext(source + '\nrestore()', { localStorage: { getItem: () => JSON.stringify(saved) } });
  }
  const rubric = { title: '원본', prompt: '문제', notes: '원본 기준', criteria: [{ title: '과정', max: 10 }] };
  for (const item of [null, [], {}, { id: 'broken', rubric, scores: null, evidence: [] }]) {
    assert.equal(restore({ rubric, items: [item] }).items[0].id, 'sample-a');
  }
  const item = { id: 'valid', student: '학생', rubric, scores: [8], evidence: ['근거'], status: 'pending' };
  assert.equal(restore({ rubric, items: [item] }).items[0].rubric.notes, '원본 기준');
});

for (const target of ['pid', 'group']) {
  test(`installer cancellation reaches npm exactly once for ${target}-targeted SIGTERM`, { skip: process.platform === 'win32', timeout: 10000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mathgrade-cancel-'));
    const log = path.join(directory, 'signals.txt');
    const fixture = path.join(directory, 'npm-fixture.mjs');
    let helper;
    try {
      await writeFile(fixture, `import { appendFileSync } from 'node:fs';\nprocess.on('SIGTERM',()=>{appendFileSync(${JSON.stringify(log)},'TERM\\n');setTimeout(()=>process.exit(0),100)});\nsetInterval(()=>{},1000);console.log('fixture-ready');\n`);
      helper = spawn(process.execPath, [path.join(appDir, 'scripts/npm-install.mjs'), 'not_applicable', process.execPath, fixture], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = new Promise(resolve => helper.once('exit', (code, signal) => resolve({ code, signal })));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture startup timed out')), 3000);
        helper.stdout.on('data', chunk => { if (String(chunk).includes('fixture-ready')) { clearTimeout(timer); resolve(); } });
        helper.once('error', reject);
      });
      process.kill(target === 'group' ? -helper.pid : helper.pid, 'SIGTERM');
      const result = await exited;
      assert.equal(result.signal, 'SIGTERM');
      assert.equal(await readFile(log, 'utf8'), 'TERM\n');
    } finally {
      if (helper && helper.exitCode === null && helper.signalCode === null) { try { process.kill(-helper.pid, 'SIGKILL'); } catch {} }
      await rm(directory, { recursive: true, force: true });
    }
  });
}
