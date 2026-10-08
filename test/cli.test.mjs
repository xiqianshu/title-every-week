import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { runProcess } from '../src/runtime.mjs';

test('real CLI starts a functional workbench and shuts down', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-cli-'));
  const child = spawn(process.execPath, ['src/cli.mjs', 'serve', '--data', root, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('startup did not report a bound port')), 2500);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/工作台端口：(\d+)/); if (match) { clearTimeout(deadline); resolve(Number(match[1])); } });
    child.on('error', error => { clearTimeout(deadline); reject(error); });
  });
  try {
    const port = await ready;
    const origin = 'http://127.0.0.1:' + port;
    const status = await (await fetch(origin + '/api/status')).json();
    assert.equal(status.application, 'creator-workflow');
    assert.equal(status.config.enabled, false);
    assert.match(await (await fetch(origin + '/')).text(), /内容工作台/);
    const stopped = once(child, 'exit'); child.kill('SIGTERM');
    const [code] = await stopped; assert.equal(code, 0);
  } finally { if (child.exitCode == null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; } await rm(root, { recursive: true, force: true }); }
});

test('port collision exits with the actual startup error', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'creator-port-'));
  const occupied = http.createServer(); await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(runProcess(process.execPath, ['src/cli.mjs', 'serve', '--data', root, '--port', String(occupied.address().port)], { timeoutMs: 2500 }), /EADDRINUSE/);
  } finally { await new Promise(resolve => occupied.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
