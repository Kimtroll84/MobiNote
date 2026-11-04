'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=path.resolve(process.argv[2]||path.join(root,'build'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function connect(port,page='https://mobinote.example/ui/index.html'){
 let target;for(let i=0;i<120;i++){try{target=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page'&&t.url===page);if(target)break;}catch{}await delay(100);}
 assert.ok(target,'main WebView must load');const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const pending=new Map();let sequence=0;
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data),entry=pending.get(msg.id);if(entry){pending.delete(msg.id);clearTimeout(entry.timer);msg.error?entry.reject(new Error(JSON.stringify(msg.error))):entry.resolve(msg.result);}});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('timeout: '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const js=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};return {ws,command,js};
}
if(require.main===module)(async()=>{
 const debug=await port(),child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)},windowsHide:true,stdio:'ignore'});let client;
 try{
  client=await connect(debug);
  for(let i=0;i<200;i++){if(await client.js("!!window.mobi&&document.readyState==='complete'"))break;await delay(100);}
  console.log('body:',(await client.js('document.body.innerText')).slice(0,180));
  console.log('viewport:',await client.js('({width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,visibility:document.visibilityState})'));
  const boot=await client.js("window.mobi.call('bootstrap').then(b=>({version:b.appInfo.version,runtime:b.appInfo.runtime,cli:b.cliPath,queue:b.state.queue.length,character:b.state.preferences.agentCharacter}))");
  assert.equal(boot.version,JSON.parse(fs.readFileSync(path.join(root,'app-info.json'),'utf8')).version);assert.equal(boot.runtime,'C# + WebView2');assert.equal(boot.queue,0);assert.equal(boot.cli,'');
  await client.js("document.getElementById('settings-open').click();document.querySelector('[data-agent-choice=B]').click();document.getElementById('apply-settings').click()");await delay(400);
  assert.match(await client.js("document.querySelector('.brand img').src"),/archer\/01.png$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'settings.json'),'utf8')).agentCharacter,'B');
  await client.js("window.mobi.call('show-progress')");await delay(400);
  const targets=await (await fetch(`http://127.0.0.1:${debug}/json`)).json();assert.ok(targets.find(t=>t.url==='https://mobinote.example/ui/progress.html'));
  const popup=await connect(debug,'https://mobinote.example/ui/progress.html');await delay(300);
  assert.deepEqual(await popup.js('({width:innerWidth,height:innerHeight})'),{width:600,height:230});
  assert.match(await popup.js("document.getElementById('portrait').src"),/archer\//);popup.ws.close();
  const agentShot=await client.js("MobiNative.call('capture-agent')");fs.copyFileSync(agentShot,path.join(root,'runtime/webview-agent.png'));
  await client.js("window.mobi.call('hide-progress')");await delay(200);
  await client.js("document.getElementById('settings-open').click();document.getElementById('agent-separate').click();document.getElementById('apply-settings').click()");await delay(300);
  await client.js("window.mobi.call('show-progress')");await delay(300);assert.equal(await client.js("document.getElementById('work-agent').open"),true);
  await client.js("window.mobi.call('hide-progress')");
  if(process.env.MOBINOTE_CAPTURE==='1'){const image=await client.js("MobiNative.call('capture-main')");fs.mkdirSync(path.join(root,'runtime'),{recursive:true});fs.copyFileSync(image,path.join(root,'runtime/webview-main.png'));}
  console.log(JSON.stringify({boot,ui:'PASS',persist:'PASS',nativeAgent:'PASS',embeddedAgent:'PASS',gameCommands:0}));
  await client.js("setTimeout(()=>window.mobi.call('close-app'),50);true");for(let i=0;i<50&&child.exitCode===null;i++)await delay(100);assert.notEqual(child.exitCode,null);
 }finally{client?.ws.close();if(child.exitCode===null)child.kill();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={connect,port,delay};
