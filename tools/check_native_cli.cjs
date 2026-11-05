'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect,port,delay}=require('./check_ui.cjs');
const root=path.resolve(__dirname,'..'),folder=path.resolve(process.argv[2]),fixture=path.resolve(process.argv[3]),db=require('../data/catalog.json');
(async()=>{
 const debug=await port(),child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)},windowsHide:true,stdio:'ignore'});let client;
 try{
  client=await connect(debug);for(let i=0;i<200;i++){if(await client.js("!!window.mobi&&document.readyState==='complete'"))break;await delay(100);}
  const invoke=(method,...args)=>client.js(`window.mobi.call(${JSON.stringify(method)},...${JSON.stringify(args)})`);
  const boot=await invoke('bootstrap');assert.equal(boot.cliPath,'');
  await delay(1000);console.log('native metrics:',await client.js("MobiNative.call('window-metrics')"));
  const viewport=await client.js('({width:innerWidth,height:innerHeight})');assert.ok(Math.abs(viewport.width-920)<=1,JSON.stringify(viewport));assert.ok(Math.abs(viewport.height-920)<=1,JSON.stringify(viewport));
  await invoke('settings',{...boot.state.preferences,cliPath:path.join(fixture,'MabinogiMobile_CLI.exe')});
  const linked=await invoke('connect');assert.equal(linked.state.connected,true);assert.equal(linked.state.wings,100000);
  const craft=db.crafts[0],material=db.materials[0];
  await invoke('add',{kind:'craft',name:craft.name,recipeId:craft.id,count:2});
  await invoke('add',{kind:'materials',name:material.name,recipeId:material.id,count:2});
  await invoke('run');let state;
  for(let i=0;i<150;i++){state=(await invoke('bootstrap')).state;if(!state.running)break;await delay(100);}
  assert.equal(state.terminal.type,'done',JSON.stringify(state.terminal));assert.deepEqual(state.queue.map(t=>t.completed),[2,2]);assert.equal(state.queue[1].finalRegistration,true);
  const responseLog=fs.readFileSync(path.join(folder,'diagnostics.log'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(responseLog.some(r=>r.event==='craft-cli-response'&&r.request.displayName===craft.name));
  await invoke('clear');
  const stateFile=path.join(fixture,'fake-state.json'),slow=JSON.parse(fs.readFileSync(stateFile,'utf8'));slow.slow=true;fs.writeFileSync(stateFile,JSON.stringify(slow));
  await invoke('add',{kind:'craft',name:craft.name,recipeId:craft.id,count:3});await invoke('run');
  for(let i=0;i<100&&!fs.existsSync(path.join(fixture,'started.signal'));i++)await delay(100);
  assert.ok(fs.existsSync(path.join(fixture,'started.signal')));await invoke('stop');
  for(let i=0;i<100;i++){state=(await invoke('bootstrap')).state;if(!state.running)break;await delay(100);}
  assert.equal(state.running,false);assert.equal(state.terminal.type,'stopped');assert.ok(fs.existsSync(path.join(fixture,'stop.signal')));
  const image=await client.js("MobiNative.call('capture-main')");fs.copyFileSync(image,path.join(root,'runtime/webview-main.png'));
  console.log(JSON.stringify({viewport,cliBase64Unicode:'PASS',connect:'PASS',mixedQueue:'PASS',finalRegistration:'PASS',immediateStop:'PASS',rawResponseLog:'PASS',realGameCommands:0}));
  await client.js("setTimeout(()=>window.mobi.call('close-app'),50);true");for(let i=0;i<50&&child.exitCode===null;i++)await delay(100);assert.notEqual(child.exitCode,null);
 }finally{client?.ws.close();if(child.exitCode===null)child.kill();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
