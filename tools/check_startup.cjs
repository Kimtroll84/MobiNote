'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {port,connect,delay}=require('./check_ui.cjs');
const folder=path.resolve(process.argv[2]),report=path.resolve(process.argv[3]),restartGap=Number(process.argv[4]||2000);
(async()=>{
 const measurements=[];
 for(let run=1;run<=3;run++){
  const profile=fs.existsSync(path.join(folder,'user'))?'existing':'new';
  const debug=await port(),start=Date.now();
  const child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,windowsHide:true,stdio:'ignore',env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)}});let client;
  try{
   let portReady;for(let i=0;i<600;i++){try{if((await fetch(`http://127.0.0.1:${debug}/json`)).ok){portReady=Date.now()-start;break;}}catch{}await delay(20);}
   client=await connect(debug);const targetSeen=Date.now()-start;
   for(let i=0;i<300;i++){if(await client.js("typeof state!=='undefined'&&!!state&&document.querySelector('#catalog-list .item')!==null"))break;await delay(20);}
   const uiReady=Date.now()-start;await delay(250);
   const metrics=await client.js(`(()=>{const n=performance.getEntriesByType('navigation')[0];return {timeOrigin:performance.timeOrigin,domInteractive:n.domInteractive,domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd,resources:performance.getEntriesByType('resource').map(r=>r.name),frameLoaded:document.getElementById('agent-frame').hasAttribute('src'),aboutLoaded:document.querySelector('.about-art').hasAttribute('src')};})()`);
   assert.equal(metrics.frameLoaded,false);assert.equal(metrics.aboutLoaded,false);
   assert.equal(metrics.resources.some(n=>/progress.html|about-embrace|tada_clean|Chimes|%EC%B2%AD/.test(n)),false);
   assert.ok(metrics.load>0,'Main load completes without waiting for hidden agent');
   const row={run,profile,portReadyMs:portReady,targetSeenMs:targetSeen,uiReadyMs:uiReady,launchToNavigationMs:Math.round(metrics.timeOrigin-start),...metrics};measurements.push(row);console.log(JSON.stringify(row));fs.writeFileSync(report,JSON.stringify({measurements,validation:'in progress'},null,2));
   if(run===3){
    await client.js("document.querySelector('.brand-portrait').click();document.querySelector('.about-art').decode()");
    assert.equal(await client.js("document.getElementById('about').open&&document.querySelector('.about-art').naturalWidth>0"),true);
    await client.js("document.getElementById('about').close()");
    // Simulate a fast task finishing before the first embedded frame is ready.
    // smoke prevents test notifications from playing actual sounds.
    await client.js(`(()=>{agentBootstrap.smoke=true;state.preferences.agentSeparate=false;showInternalAgent(true);state={...state,running:false,terminal:{type:'done',text:'테스트 작업을 마쳤어요.',completed:1,total:1,results:[{name:'못',kind:'제작',count:1}]}};MobiNative.emit('state',state);MobiNative.emit('result',state.terminal);})()`);
    for(let i=0;i<150;i++){if(await client.js("agentFrameReady&&document.getElementById('agent-frame').contentDocument.querySelector('.bubble strong')?.textContent.includes('테스트 작업')"))break;await delay(20);}
    assert.equal(await client.js("document.getElementById('work-agent').open&&pendingAgentResult===null"),true);
    assert.match(await client.js("document.getElementById('agent-frame').contentDocument.querySelector('.bubble p').textContent"),/못 · 제작 1회/);
    const frameOrigin=await client.js("document.getElementById('agent-frame').contentWindow.performance.timeOrigin");
    await client.js("showInternalAgent(false);state={...state,running:true,terminal:null,stage:{type:'gather',item:'달걀',gathered:4,gatherTarget:10},preferences:{...state.preferences,agentCharacter:'B'}};MobiNative.emit('state',state);showInternalAgent(true)");await delay(100);
    assert.equal(await client.js("document.getElementById('agent-frame').contentWindow.performance.timeOrigin"),frameOrigin);
    assert.match(await client.js("document.getElementById('agent-frame').contentDocument.querySelector('.bubble:not(.exiting) p').textContent"),/4 \/ 10개/);
    assert.match(await client.js("document.getElementById('agent-frame').contentDocument.getElementById('portrait').src"),/archer\//);
    await client.js("state={...state,running:false,stage:{type:'idle'}};MobiNative.emit('state',state);showInternalAgent(false)");
   }
   await client.js("setTimeout(()=>window.mobi.call('close-app'),50);true");for(let i=0;i<100&&child.exitCode===null;i++)await delay(30);
  }finally{client?.ws.close();if(child.exitCode===null)child.kill();}
  // Let the previous WebView2 profile finish shutting down before the next launch.
  if(run<3)await delay(restartGap);
 }
 fs.writeFileSync(report,JSON.stringify({measurements,lazyFrame:'PASS',earlyTerminal:'PASS',frameReuse:'PASS',agentB:'PASS',lazyAboutImage:'PASS',gameCommands:0},null,2));
 console.log('Startup/lazy UI verification: PASS; game commands: 0');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
