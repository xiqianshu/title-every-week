import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/runtime.mjs';
const mac = await import('../src/mac.mjs').catch(() => ({}));

test('launchd runs the local service independently of a terminal and escapes filesystem paths', async () => {
  assert.equal(typeof mac.makeLaunchAgent, 'function');
  const plist = mac.makeLaunchAgent({ node: '/usr/local/bin/node', appRoot: '/Users/Test A&B/creator-workflow/automation', dataRoot: '/Users/Test A&B/creator-workflow/automation/data' });
  const parsed = await runProcess('python3', ['-c', 'import plistlib,sys,json; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'], { input: plist, timeoutMs: 3000 });
  const job = JSON.parse(parsed.stdout);
  assert.equal(job.RunAtLoad, true);
  assert.equal(job.KeepAlive, true);
  assert.equal(job.ProgramArguments[0], '/usr/local/bin/node');
  assert.ok(job.ProgramArguments.includes('/Users/Test A&B/creator-workflow/automation/src/cli.mjs'));
});
