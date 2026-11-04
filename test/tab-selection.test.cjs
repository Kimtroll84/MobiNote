'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('tab navigation remembers choices, defaults facilities to all, resets presets and respects unsaved edits',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8');
 const fn=source.slice(source.indexOf('async function setTab('),source.indexOf('function renderFilters('));
 const context=vm.createContext({});
 vm.runInContext(`let tab='gather',selected='egg',materialView=null,quantity=7,activePreset='p1',presetDraft={tasks:[1]},presetBaseline={tasks:[1]},listSignature='',detailSignature='',allowed=true;const tabSelections=new Map();const fields=new Map();const $=id=>{if(!fields.has(id))fields.set(id,{value:''});return fields.get(id);};const guardPreset=async()=>allowed;const current=()=>selected;const render=()=>{};const renderFilters=()=>{};`+fn,context);
 const run=s=>vm.runInContext(s,context);
 await run("setTab('facility')");assert.equal(run('selected'),'all');
 run("selected='금속';");await run("setTab('gather')");assert.equal(run('selected'),'egg');assert.equal(run('quantity'),7);
 await run("setTab('facility')");assert.equal(run('selected'),'금속');
 await run("setTab('presets')");assert.equal(run('selected'),null);assert.equal(run('presetDraft'),null);assert.equal(run('activePreset'),null);
 run("presetDraft={tasks:[1]};activePreset='p1';selected='p1';allowed=false;");await run("setTab('gather')");assert.equal(run('tab'),'presets');
 run('allowed=true');await run("setTab('gather')");await run("setTab('presets')");assert.equal(run('presetDraft'),null);
});
