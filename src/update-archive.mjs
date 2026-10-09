import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const maxBytes = 8 * 1024 * 1024;
const schemaFiles = ['schemas/collection.json', 'schemas/weekly.json', 'schemas/review.json'];
const required = ['package.json', 'package-lock.json', 'src/cli.mjs', 'src/update-worker.mjs', 'public/index.html', 'public/app.js', 'public/styles.css', ...schemaFiles];
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => { let n = index; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

export async function extractPackage(bytes, destination) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 2 * 1024 * 1024) throw new Error('安装包容量或格式无效');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('安装包格式不支持');
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), directoryStart = bytes.readUInt32LE(end + 16);
  if (count < 1 || count > 120 || bytes.readUInt16LE(end + 8) !== count || directoryStart + directorySize !== end) throw new Error('安装包目录无效');
  const files = [], names = new Set(); let cursor = directoryStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('安装包目录损坏');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), length = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const type = (bytes.readUInt32LE(cursor + 38) >>> 16) & 0o170000, offset = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + length + extra + comment > end || flags & 1 || ![0, 8].includes(method) || (type && type !== 0o100000) || size > maxBytes || (total += size) > maxBytes) throw new Error('安装包包含不支持的条目或超过容量限制');
    const filename = bytes.subarray(cursor + 46, cursor + 46 + length).toString('utf8'), name = filename.slice('内容工作台/'.length);
    if (!filename.startsWith('内容工作台/') || !name || /[\\\0]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || !/^(?:(?:src|public|schemas|licenses)\/[^\0]+|package(?:-lock)?\.json|README\.md|THIRD_PARTY\.md|安装\.command|打开工作台\.command|停用后台\.command)$/.test(name) || names.has(name)) throw new Error('安装包路径无效或重复');
    if (offset + 30 > directoryStart || bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 8) !== method) throw new Error('安装包文件头无效');
    const localLength = bytes.readUInt16LE(offset + 26), localExtra = bytes.readUInt16LE(offset + 28), start = offset + 30 + localLength + localExtra;
    if (bytes.subarray(offset + 30, offset + 30 + localLength).toString('utf8') !== filename || start + compressed > directoryStart) throw new Error('安装包文件边界无效');
    const input = bytes.subarray(start, start + compressed), content = method === 8 ? inflateRawSync(input, { maxOutputLength: maxBytes }) : input;
    if (content.length !== size || crc32(content) !== crc) throw new Error('安装包文件校验失败');
    names.add(name); files.push({ name, content }); cursor += 46 + length + extra + comment;
  }
  if (cursor !== end || required.some(name => !names.has(name))) throw new Error('安装包缺少所需程序文件');
  for (const name of schemaFiles) {
    try { if (JSON.parse(files.find(f => f.name === name).content.toString('utf8')).type !== 'object') throw new Error(); }
    catch { throw new Error('安装包 schema 格式无效：' + name); }
  }
  // Validate the entire archive before creating any file.
  for (const file of files) {
    const target = path.join(destination, ...file.name.split('/'));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, file.content, { flag: 'wx', mode: file.name.endsWith('.command') ? 0o755 : 0o644 });
  }
}
