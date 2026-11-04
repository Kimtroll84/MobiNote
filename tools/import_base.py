"""One-time copy of the verified MobiNote base. Does not copy private state or modify Electron."""
from pathlib import Path
import hashlib,json,shutil
root=Path(__file__).resolve().parents[1]
source=root.parent/'MobiNote'
report=[]
for folder,suffixes in [('lib',{'.cjs'}),('data',{'.json'}),('ui',{'.js','.css','.html','.png','.ico','.wav','.ogg'}),('test',{'.cjs'})]:
    for file in (source/folder).rglob('*'):
        if not file.is_file() or file.suffix not in suffixes or 'sources' in file.parts or file.name=='game-survey.json':continue
        if folder=='test' and not (file.name.endswith('.test.cjs') or file.name=='fake-cli.cjs'):continue
        target=root/file.relative_to(source)
        if target.exists():raise SystemExit('Refusing to overwrite: '+str(target))
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target)
        report.append({'file':file.relative_to(source).as_posix(),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
for filename in ['app-info.json','package.json','LICENSE','CHANGELOG.md']:
    shutil.copy2(source/filename,root/filename)
(root/'BASE_SNAPSHOT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('Copied verified source/assets/tests:',len(report))
