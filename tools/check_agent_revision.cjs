'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {port,connect,delay}=require('./check_ui.cjs');
(async()=>{
 const folder=path.resolve(process.argv[2]),debug=await port();
 const child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,windowsHide:true,stdio:'ignore',env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)}});let client,popup;
 try{
  client=await connect(debug);for(let i=0;i<150;i++){if(await client.js('!!window.mobi'))break;await delay(100);}await delay(400);
  assert.equal(await client.js("window.mobi.call('bootstrap').then(b=>b.appInfo.version)"),JSON.parse(fs.readFileSync(path.join(__dirname,'../app-info.json'),'utf8')).version);
  await client.js("document.getElementById('settings-open').click()");
  assert.equal(await client.js("document.getElementById('retry-interrupted').checked"),true);
  await client.js("document.getElementById('retry-interrupted-help').click()");
  assert.equal(await client.js("document.getElementById('retry-interrupted-popover').matches(':popover-open')"),true);
  assert.match(await client.js("document.getElementById('retry-interrupted-popover').textContent"),/날개/);
  await client.js("document.getElementById('retry-interrupted-popover').hidePopover();document.getElementById('retry-interrupted').click()");
  assert.equal(await client.js("document.getElementById('apply-settings').disabled"),false);
  await client.js("document.getElementById('apply-settings').click()");await delay(300);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'settings.json'),'utf8')).retryInterrupted,false);
  await client.js("document.getElementById('settings-open').click()");
  assert.equal(await client.js("document.getElementById('retry-interrupted').checked"),false);
  assert.equal(await client.js("document.getElementById('apply-settings').disabled"),true);
  await client.js("(async()=>{document.getElementById('settings-close').click();const b=await window.mobi.call('bootstrap');await window.mobi.call('settings',{...b.state.preferences,cliPath:'',agentSeparate:true});await window.mobi.call('show-progress');})()");
  popup=await connect(debug,'https://mobinote.example/ui/progress.html');await delay(400);
  // Intercept only drag requests: exercise real DOM bindings without entering an OS drag loop.
  await popup.js(`(()=>{window.dragRequests=0;const original=window.chrome.webview.postMessage.bind(window.chrome.webview);window.chrome.webview.postMessage=message=>{if(message.method==='drag-agent'){window.dragRequests++;return;}original(message);};})()`);
  for(const selector of ['#portrait','#phase','#messages strong','.bottom','#messages','main']){
   await popup.js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}))`);
  }
  assert.equal(await popup.js('window.dragRequests'),6);
  assert.equal(await popup.js("document.getElementById('close')"),null);
  await popup.js("document.getElementById('stop').dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}))");
  assert.equal(await popup.js('window.dragRequests'),6);
  const completed={type:'done',completed:1,total:2,skipped:1,text:'대기줄의 작업을 모두 마쳤어요.',results:[{name:'못',kind:'제작',count:2}]};
  for(const voice of ['A','B']){
   const text=await popup.js(`AgentDialogue.copy(${JSON.stringify(completed)},${JSON.stringify(voice)})`);
   assert.match(text.detail,/건너뜀 1개/);assert.match(text.detail,/못 · 제작 2회/);
  }
  await client.js("window.mobi.call('hide-progress')");
  console.log('Native UI: retry preference/help/save, six drag regions, buttons excluded, A/B result summary: PASS; game commands: 0');
  await client.js("setTimeout(()=>window.mobi.call('close-app'),50);true");await delay(300);
 }finally{popup?.ws.close();client?.ws.close();if(child.exitCode===null)child.kill();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
