from pathlib import Path
import json,shutil,subprocess
from build_bundle import bundle
root=Path(__file__).resolve().parents[1];out=root/'build';out.mkdir(exist_ok=True)
version=json.loads((root/'app-info.json').read_text(encoding='utf-8-sig'))['version']
sdk=root/'third_party/WebView2';managed=sdk/'lib/net462';content=out/'content';content.mkdir(exist_ok=True)
shutil.copytree(root/'ui',content/'ui',dirs_exist_ok=True)
for name in ['host-api.js','engine-host.js']:shutil.copy2(root/'web'/name,content/'ui'/name)
(content/'ui/engine-bundle.js').write_text(bundle(root),encoding='utf-8')
p=content/'ui/index.html';s=p.read_text(encoding='utf-8-sig').replace('<script src="work-time.js"','<script src="host-api.js" defer></script><script src="engine-bundle.js" defer></script><script src="engine-host.js" defer></script><script src="work-time.js"').replace('<title>모비노트 0.8.0</title>',f'<title>모비노트 {version}</title>');p.write_text(s,encoding='utf-8')
p=content/'ui/progress.html';s=p.read_text(encoding='utf-8-sig').replace('<script src="agent-bridge.js"','<script src="host-api.js" defer></script><script src="agent-bridge.js"');p.write_text(s,encoding='utf-8')
info=json.loads((root/'app-info.json').read_text(encoding='utf-8-sig'));(content/'app-info.json').write_text(json.dumps(info,ensure_ascii=False),encoding='utf-8')
for name in ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll']:shutil.copy2(managed/name,out/name)
shutil.copy2(sdk/'runtimes/win-x64/native/WebView2Loader.dll',out/'WebView2Loader.dll')
for name in ['LICENSE','CHANGELOG.md','RELEASE_NOTES.md','README.md','THIRD_PARTY_NOTICES.md','사용매뉴얼.html','사용매뉴얼.md']:shutil.copy2(root/name,out/name)
shutil.copy2(sdk/'LICENSE.txt',out/'LICENSE.WebView2.txt')
csc=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
args=[str(csc),'/nologo','/target:winexe','/platform:x64','/optimize+','/out:'+str(out/'MobiNote.exe'),'/win32icon:'+str(root/'ui/assets/MobiNote_A.ico'),'/win32manifest:'+str(root/'src/app.manifest'),'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+str(managed/'Microsoft.Web.WebView2.Core.dll'),'/reference:'+str(managed/'Microsoft.Web.WebView2.WinForms.dll')]+[str(p) for p in (root/'src').glob('*.cs')]
subprocess.run(args,check=True,cwd=root)
(out/'MobiNote.exe.config').write_text('<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup><System.Windows.Forms.ApplicationConfigurationSection><add key="DpiAwareness" value="PerMonitorV2"/></System.Windows.Forms.ApplicationConfigurationSection></configuration>',encoding='utf-8')
print('WebView2 build complete. No Electron or Node.js runtime included.')
