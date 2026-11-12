"""Package only verified application files, excluding all local state and SDK/test artifacts."""
from pathlib import Path
import argparse,hashlib,json,shutil,zipfile
root=Path(__file__).resolve().parents[1];build=root/'build';version=json.loads((root/'app-info.json').read_text(encoding='utf-8-sig'))['version'];name=f'MobiNote-{version}-WebView2-win-x64'
if json.loads((build/'content/app-info.json').read_text(encoding='utf-8-sig'))['version']!=version:raise SystemExit('Build version does not match source; rebuild before packaging')
parser=argparse.ArgumentParser();parser.add_argument('--output-root',type=Path,default=root/'outputs');args=parser.parse_args()
out=args.output_root/name;archive=out.with_name(name+'.zip')
if out.exists() or archive.exists():raise SystemExit('Release exists; preserve it before rebuilding')
out.mkdir(parents=True)
for filename in ['MobiNote.exe','MobiNote.exe.config','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','LICENSE','LICENSE.WebView2.txt','README.md','THIRD_PARTY_NOTICES.md','CHANGELOG.md','RELEASE_NOTES.md','사용매뉴얼.html','사용매뉴얼.md']:
    shutil.copy2(build/filename,out/filename)
shutil.copytree(build/'content',out/'content')
manifest=[]
for file in sorted(out.rglob('*')):
    if not file.is_file():continue
    relative=file.relative_to(out)
    if set(relative.parts)&{'runtime','user','test','third_party','outputs','__pycache__'} or file.name.startswith('agent-trace-') or file.name in {'settings.json','errors.log','diagnostics.log','MabinogiMobile_CLI.exe'}:raise SystemExit('Private/test file: '+str(relative))
    manifest.append({'file':relative.as_posix(),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(out/'FILES.sha256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for file in sorted(out.rglob('*')):
        if file.is_file():z.write(file,name+'/'+file.relative_to(out).as_posix())
digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_name(archive.name+'.sha256').write_text(digest+'  '+archive.name+'\n',encoding='ascii')
print(json.dumps({'zip':archive.name,'bytes':archive.stat().st_size,'MiB':round(archive.stat().st_size/1048576,2),'sha256':digest,'files':len(manifest)+1},ensure_ascii=False))
