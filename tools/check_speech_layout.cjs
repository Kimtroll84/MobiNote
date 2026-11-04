'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {port,connect,delay}=require('./check_ui.cjs');
(async()=>{
 const folder=path.resolve(process.argv[2]),debug=await port(),child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,windowsHide:true,stdio:'ignore',env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)}});let main,popup;
 try{
  main=await connect(debug);for(let i=0;i<100;i++){if(await main.js('!!window.mobi'))break;await delay(50);}await main.js("window.mobi.call('show-progress')");
  popup=await connect(debug,'https://mobinote.example/ui/progress.html');await delay(200);
  await popup.js("testMode=true;window.speechBase=structuredClone(state);speechBase.running=true;speechBase.terminal=null;speechBase.preferences.agentCharacter='A'");
  const change=async stage=>{await popup.js(`update({...speechBase,stage:${JSON.stringify(stage)}})`);await delay(190);};
  const geometry=()=>popup.js(`(()=>{const b=document.querySelector('.bubble').getBoundingClientRect(),s=document.getElementById('stop').getBoundingClientRect(),scroll=document.querySelector('.bubble-scroll');return {width:innerWidth,height:innerHeight,bubbleHeight:b.height,bubbleWidth:b.width,bottom:b.bottom,buttonTop:s.top,phaseBottom:document.getElementById('phase').getBoundingClientRect().bottom,history:!document.getElementById('speech-history').hidden,scrolling:scroll.scrollHeight>scroll.clientHeight,bubbles:document.querySelectorAll('.bubble').length};})()`);
  const shot=async name=>{const file=await main.js("MobiNative.call('capture-agent')");fs.copyFileSync(file,path.resolve('runtime/'+name+'.png'));};
  await change({type:'checking',text:'작업을 확인하고 있어요.'});const small=await geometry();await shot('agent-094-short');
  assert.equal(await popup.js("document.getElementById('close')"),null);assert.equal(await popup.js("document.getElementById('phase').closest('.bottom')!==null"),true);
  await change({type:'craft',item:'사과 수플레'});const history=await geometry();assert.equal(history.history,true);assert.ok(history.bubbleHeight>small.bubbleHeight);await shot('agent-094-history');
  await delay(2600);await delay(180);assert.equal((await geometry()).history,false);assert.ok((await geometry()).bubbleHeight<history.bubbleHeight);
  await change({type:'gather',item:'달걀',gathered:12,gatherTarget:30,roosterHits:3});const counter=await geometry();assert.equal(counter.history,false);await shot('agent-094-counter');
  const results=Array.from({length:12},(_,i)=>({name:'테스트 생산품 '+(i+1),kind:'제작',count:i+1}));
  await popup.js(`update({...speechBase,running:false,terminal:{type:'done',completed:12,total:12,skipped:0,text:'대기줄의 작업을 모두 마쳤어요.',results:${JSON.stringify(results)}}})`);await delay(190);
  const report=await geometry();assert.equal(report.history,false);assert.equal(report.scrolling,true);await shot('agent-094-results');
  await popup.js(`(()=>{window.scrollDragCount=0;const original=window.chrome.webview.postMessage.bind(window.chrome.webview);window.chrome.webview.postMessage=m=>{if(m.method==='drag-agent'){window.scrollDragCount++;return;}original(m);};const scroller=document.querySelector('.bubble-scroll'),r=scroller.getBoundingClientRect();scroller.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true,clientX:r.right-1,clientY:r.top+10}));})()`);
  assert.equal(await popup.js('window.scrollDragCount'),0,'Scrollbar must not drag the whole agent');
  await popup.js("update({...speechBase,stage:{type:'checking',text:'오래 표시된 대사'}});speechHistory.current.since=performance.now()-3000");
  await change({type:'register',item:'목재'});assert.equal((await geometry()).history,false);
  for(const g of [small,history,counter,report]){assert.equal(g.width,600);assert.equal(g.height,230);assert.equal(g.bubbles,1);assert.equal(g.bubbleWidth,small.bubbleWidth);assert.ok(g.bottom<=g.buttonTop);assert.equal(g.buttonTop,small.buttonTop);}
  const metrics=await main.js("MobiNative.call('window-metrics')");assert.equal(metrics.agent.width,600);assert.equal(metrics.agent.height,230);
  console.log(JSON.stringify({small,history,counter,report,fixedNativeWindow:metrics.agent,gameCommands:0}));
  fs.writeFileSync(path.resolve('runtime/agent-094-layout.json'),JSON.stringify({small,history,counter,report,gameCommands:0},null,2));
  await main.js("window.mobi.call('hide-progress');setTimeout(()=>window.mobi.call('close-app'),50);true");await delay(300);
 }finally{popup?.ws.close();main?.ws.close();if(child.exitCode===null)child.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
