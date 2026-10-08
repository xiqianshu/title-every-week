"""Create a source installer without credentials or personal records."""
from pathlib import Path
import hashlib
import json
import stat
import zipfile

root = Path(__file__).resolve().parent.parent
destination = root / 'dist'
destination.mkdir(exist_ok=True)
files = []
for name in ['src', 'public', 'schemas', 'licenses']:
    files.extend(p for p in (root / name).rglob('*') if p.is_file())
for name in ['package.json', 'package-lock.json', 'README.md', 'THIRD_PARTY.md', '安装.command', '打开工作台.command', '停用后台.command']:
    files.append(root / name)
archive = destination / 'creator-workflow-mac.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
    for file in sorted(files):
        relative = file.relative_to(root).as_posix()
        info = zipfile.ZipInfo('内容工作台/' + relative)
        info.create_system = 3
        info.compress_type = zipfile.ZIP_DEFLATED
        mode = 0o755 if file.suffix == '.command' else 0o644
        info.external_attr = (stat.S_IFREG | mode) << 16
        output.writestr(info, file.read_bytes())
with zipfile.ZipFile(archive) as output:
    assert output.testzip() is None
    assert not any('/data/' in name or 'node_modules/' in name or '.git/' in name for name in output.namelist())
    for name in ['安装.command', '打开工作台.command', '停用后台.command']:
        assert (output.getinfo('内容工作台/' + name).external_attr >> 16) & 0o111
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'creator-workflow-mac.sha256').write_text(checksum + '  ' + archive.name + '\n', encoding='utf-8')
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(files), 'sha256': checksum}, ensure_ascii=False))
