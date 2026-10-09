// Run after committing the validated archive; then commit the pointer separately.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runProcess } from '../src/runtime.mjs';
import { validateRelease } from '../src/update-release.mjs';

const commit = (await runProcess('git', ['rev-parse', 'HEAD'], { timeoutMs: 10000 })).stdout.trim();
const archive = await readFile('releases/creator-workflow-mac.zip');
const checksum = createHash('sha256').update(archive).digest('hex');
const tracked = (await runProcess('git', ['show', commit + ':releases/creator-workflow-mac.sha256'], { timeoutMs: 10000 })).stdout.trim().split(/\s+/)[0];
const version = JSON.parse((await runProcess('git', ['show', commit + ':package.json'], { timeoutMs: 10000 })).stdout).version;
if (checksum !== tracked) throw new Error('Commit the tested archive and checksum before generating the update pointer');
const release = validateRelease({ commit, version, sha256: checksum });
await writeFile('releases/latest.json', JSON.stringify(release, null, 2) + '\n');
console.log('Update pointer prepared for version ' + version + ' at commit ' + commit);
