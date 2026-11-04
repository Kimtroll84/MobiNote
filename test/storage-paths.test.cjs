'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {storagePaths}=require('../lib/storage-paths.cjs');
const base={packaged:true,smoke:false,sourceDirectory:path.resolve('source'),executablePath:path.resolve('portable/MobiNote.exe'),appData:path.resolve('profile')};
test('portable settings and logs use the executable directory',()=>{
 const p=storagePaths(base);assert.equal(p.runtime,path.dirname(base.executablePath));assert.equal(path.dirname(p.settingsFile),p.runtime);
});
test('single-executable portable honors its real launch directory',()=>{
 const folder=path.resolve('real-portable');assert.equal(storagePaths({...base,portableDirectory:folder}).runtime,folder);
});
test('development and smoke paths retain isolated settings',()=>{
 const dev=storagePaths({...base,packaged:false});assert.equal(dev.settingsFile,path.join(base.appData,'MobiNote/settings.json'));
 const smoke=storagePaths({...base,smoke:true});assert.equal(smoke.settingsFile,path.join(base.sourceDirectory,'runtime/test-settings.json'));
});
