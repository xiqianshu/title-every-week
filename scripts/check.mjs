import { readdir, readFile, access } from 'node:fs/promises';
import { runProcess } from '../src/runtime.mjs';

for (const directory of ['src', 'test', 'scripts', 'public']) {
  for (const file of await readdir(directory)) {
    if (/\.(?:js|mjs)$/.test(file)) await runProcess(process.execPath, ['--check', directory + '/' + file], { timeoutMs: 10000 });
  }
}
for (const file of await readdir('schemas')) JSON.parse(await readFile('schemas/' + file, 'utf8'));
for (const file of ['安装.command', '打开工作台.command', '停用后台.command']) await runProcess('/bin/bash', ['-n', file], { timeoutMs: 10000 });
for (const file of ['node_modules/@openai/codex/bin/codex.js', 'node_modules/@playwright/mcp/cli.js', 'node_modules/@jackwener/opencli/dist/src/main.js']) await access(file);
const codex = await runProcess(process.execPath, ['node_modules/@openai/codex/bin/codex.js', 'exec', '--help'], { timeoutMs: 10000 });
for (const flag of ['--ignore-user-config', '--output-schema', '--output-last-message']) if (!codex.stdout.includes(flag)) throw new Error('固定 Codex 版本不支持所需选项：' + flag);
console.log('JavaScript、JSON、Mac 脚本语法与固定 Codex 命令入口检查通过。实际平台验收需在 Mac 完成。');
