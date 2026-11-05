const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{connect,port,delay}=require('./check_ui.cjs');
(async()=>{const folder=path.resolve(process.argv[2]),fixture=path.resolve(process.argv[3]),debug=await port(),child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,windowsHide:true,stdio:'ignore',env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)}});let c;
try{c=await connect(debug);for(let i=0;i<200;i++){if(await c.js(`typeof state!=='undefined'&&!!state&&!!db`))break;await delay(100);}
const invoke=(method,...args)=>c.js(`window.mobi.call(${JSON.stringify(method)},...${JSON.stringify(args)})`);
const boot=await invoke('bootstrap');assert.equal(boot.state.preferences.processingRefillRounds,2);assert.equal(boot.state.preferences.strictOrder,false);
await c.js(`document.querySelector('[data-tab="facility"]').click()`);
assert.equal(await c.js(`document.querySelectorAll('.facility-slot').length`),42);assert.equal(await c.js(`document.getElementById('detail').querySelector('h1')`),null);
const geometry=await c.js(`(()=>{const d=$('detail');return {scrollHeight:d.scrollHeight,clientHeight:d.clientHeight,panes:[...document.querySelector('main').children].map(e=>Math.round(e.getBoundingClientRect().width))};})()`);assert.ok(geometry.scrollHeight<=geometry.clientHeight+2,JSON.stringify(geometry));assert.deepEqual(geometry.panes,[260,400,260]);
await c.js(`document.querySelector('[data-open-facility]').click()`);assert.equal(await c.js(`$('picker').open&& !$('picker').matches(':modal')`),true);
await c.js(`document.querySelector('.facility-item[data-id="'+db.facilities[1].name+'"] .item-main').click()`);await delay(150);assert.equal(await c.js(`selected===db.facilities[1].name`),true);assert.equal(await c.js(`$('picker-facility').value===db.facilities[0].name`),true);await c.js(`$('picker-close').click()`);
await c.js(`$('settings-open').click()`);assert.equal(await c.js(`$('processing-refill').value`),'2');await c.js(`$('processing-refill').value='3';$('strict-order').click();$('apply-settings').click()`);await delay(300);
let prefs=(await invoke('bootstrap')).state.preferences;assert.equal(prefs.processingRefillRounds,3);assert.equal(prefs.strictOrder,true);
await invoke('settings',{...prefs,limit:95,cycleMinutes:120,cliPath:path.join(fixture,'MabinogiMobile_CLI.exe')});await invoke('connect');
await c.js(`document.querySelector('[data-tab="facility"]').click();selected='all';detailSignature='';render()`);
await c.js(`openFacilityPicker(db.facilities[0].name);$('picker-list').querySelector('[data-recipe]:not(:disabled)').click();$('picker-facility').value=db.facilities[1].name;$('picker-facility').dispatchEvent(new Event('change'));$('picker-list').querySelector('[data-recipe]:not(:disabled)').click()`);
assert.equal(await c.js(`facilityPlan.length`),2);assert.equal(await c.js(`document.querySelectorAll('.facility-slot.planned').length`),2);assert.equal(await c.js(`$('picker-list').querySelector('small').textContent.endsWith('개')`),true);
await c.js(`$('queue-repeats').value='2';$('queue-repeats').dispatchEvent(new Event('input'));$('queue-plan').click()`);await delay(400);
let state=(await invoke('bootstrap')).state;assert.equal(state.queue[0].planMode,true);assert.equal(state.queue[0].repeatCount,2);assert.equal(state.queue[0].pattern.length,2);
const shot=await c.js(`MobiNative.call('capture-main')`);fs.copyFileSync(shot,path.resolve('runtime/facility-plan-main.png'));await c.js(`$('picker').close()`);
await invoke('add',{kind:'craft',name:'캠프파이어 키트',count:1});await invoke('run');
for(let i=0;i<600;i++){state=(await invoke('bootstrap')).state;if(!state.running)break;await delay(100);}
assert.equal(state.terminal.type,'done',JSON.stringify(state.terminal));assert.equal(state.queue[0].completed,4);assert.equal(state.queue[1].completed,1);
console.log(JSON.stringify({geometry,slots:42,nonModalPicker:'PASS',settingsPersist:'PASS',multiFacilityPlan:'PASS',nativeProduction:'PASS',realGameCommands:0}));await c.js(`setTimeout(()=>window.mobi.call('close-app'),50);true`);await delay(300);
}finally{c?.ws.close();if(child.exitCode===null)child.kill();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
