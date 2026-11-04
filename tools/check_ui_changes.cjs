'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {connect,port,delay}=require('./check_ui.cjs');
const root=path.resolve(__dirname,'..'),folder=path.resolve(process.argv[2]);
(async()=>{
 const debug=await port(),child=spawn(path.join(folder,'MobiNote.exe'),[],{cwd:folder,env:{...process.env,MOBINOTE_DEBUG_PORT:String(debug)},windowsHide:true,stdio:'ignore'});let client;
 try{
  client=await connect(debug);for(let i=0;i<200;i++){if(await client.js("!!window.mobi&&document.readyState==='complete'"))break;await delay(100);}await delay(500);
  await client.js(`(async()=>{
    state=structuredClone((await window.mobi.call('bootstrap')).state);state.connected=true;state.worksReceivedAt=Date.now();
    state.works=db.facilities.flatMap(f=>unique(db.materials.filter(r=>r.facility===f.name)).slice(0,7).map((r,i)=>({DisplayName:r.name,FacilityName:f.name,State:i<2?'Completed':i<4?'InProgress':'NotStarted',IsCompleted:i<2,RemainingSeconds:i<2?0:120+i*10})));
    tab='facility';selected='all';detailSignature='';listSignature='';render();
  })()`);
  const overview=await client.js(`(()=>{const detail=document.getElementById('detail'),cards=[...document.querySelectorAll('.facility-card')];return {cards:cards.length,works:state.works.length,scrollHeight:detail.scrollHeight,clientHeight:detail.clientHeight,last:cards.at(-1).getBoundingClientRect().bottom,bottom:detail.getBoundingClientRect().bottom,font:getComputedStyle(document.querySelector('.facility-product')).fontSize};})()`);
  assert.equal(overview.cards,6);assert.equal(overview.works,42);assert.ok(overview.scrollHeight<=overview.clientHeight+1,JSON.stringify(overview));assert.ok(overview.last<=overview.bottom);assert.equal(overview.font,'13px');
  const shot=await client.js("MobiNative.call('capture-main')");fs.copyFileSync(shot,path.join(root,'runtime/facility-overview-cards.png'));
  await client.js("document.querySelector('.facility-more').click()");await delay(1200);assert.equal(await client.js("document.querySelector('.facility-popover').matches(':popover-open')"),true);
  assert.equal(await client.js("document.querySelector('.facility-popover').querySelectorAll('.facility-product').length"),7);
  await client.js("document.querySelector('.facility-popover').hidePopover()");
  const cardStyle=await client.js("(()=>{const h=getComputedStyle(document.querySelector('.facility-card-heading'));return {background:h.backgroundColor,color:h.color,border:h.borderBottomWidth};})()");
  assert.equal(cardStyle.background,'rgb(96, 118, 76)');assert.equal(cardStyle.color,'rgb(255, 255, 255)');assert.equal(cardStyle.border,'1px');
  await client.js("document.querySelector('.facility-card-heading h2').click()");
  assert.equal(await client.js("selected===db.facilities[0].name&&document.querySelector('.facility-item.selected').dataset.id===selected"),true);
  await client.js("selected='all';detailSignature='';render();document.querySelectorAll('.facility-card')[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  assert.equal(await client.js("selected===db.facilities[1].name"),true);
  await client.js("selected='all';detailSignature='';const saved=state.works;state.works=[];render();window.testSavedWorks=saved;document.querySelector('.facility-empty').click()");
  assert.equal(await client.js("selected===db.facilities[0].name"),true);
  await client.js("state.works=window.testSavedWorks;delete window.testSavedWorks;selected='all';detailSignature='';render()");
  await client.js(`(()=>{pickerMode='register';pickerSlots=7;slotSelection=[];pickerFacility=db.facilities[0].name;state.stock={};for(const r of db.materials)for(const i of r.ingredients)state.stock[i.name]=10000;renderPicker(pickerFacility);document.getElementById('picker').showModal();fitPicker();})()`);
  const rect=()=>client.js("(()=>{const p=document.getElementById('picker').getBoundingClientRect(),r=document.querySelector('#picker-list [data-recipe]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,dialogX:p.x,dialogY:p.y,dialogWidth:p.width,dialogHeight:p.height};})()");
  const before=await rect();for(let i=0;i<3;i++){
    const point={x:before.x+before.w/2,y:before.y+before.h/2,button:'left',clickCount:1};
    await client.command('Input.dispatchMouseEvent',{type:'mousePressed',buttons:1,...point});await client.command('Input.dispatchMouseEvent',{type:'mouseReleased',buttons:0,...point});
    assert.deepEqual(await rect(),before);
  }
  assert.equal(await client.js("document.querySelectorAll('#picker-set [data-picker-remove]').length"),1);assert.equal(await client.js("document.querySelector('#picker-set .set-multiplier').textContent"),'×3');
  await client.js("document.querySelector('#picker-set [data-picker-remove]').click()");assert.equal(await client.js('slotSelection.length'),2);assert.deepEqual(await rect(),before);
  assert.equal(await client.js("document.getElementById('picker-list').getBoundingClientRect().bottom<document.getElementById('picker-set').getBoundingClientRect().top"),true);
  const pickerShot=await client.js("MobiNative.call('capture-main')");fs.copyFileSync(pickerShot,path.join(root,'runtime/register-picker-layout.png'));
  const close=await client.js("(()=>{const b=document.getElementById('picker-close'),s=getComputedStyle(b),r=b.getBoundingClientRect();return {width:r.width,height:r.height,padding:s.padding,lineHeight:s.lineHeight,display:s.display};})()");assert.equal(close.width,28);assert.equal(close.height,28);assert.equal(close.padding,'0px');assert.equal(close.display,'grid');
  await client.js("document.getElementById('picker').close();window.mobi.call('show-progress')");
  const popup=await connect(debug,'https://mobinote.example/ui/progress.html');await delay(300);
  assert.equal(await popup.js('document.activeElement.tagName'),'MAIN');
  console.log('agent focus:',await popup.js("(()=>{const b=document.getElementById('stop'),s=getComputedStyle(b);return {focused:b.matches(':focus'),visible:b.matches(':focus-visible'),outline:s.outline,border:s.border,styles:[...document.styleSheets[0].cssRules].slice(-5).map(r=>r.cssText)};})()"));
  assert.equal(await popup.js("getComputedStyle(document.getElementById('stop')).outlineWidth"),'0px');
  const agentShot=await client.js("MobiNative.call('capture-agent')");fs.copyFileSync(agentShot,path.join(root,'runtime/agent-focus-style.png'));popup.ws.close();
  await client.js("window.mobi.call('hide-progress')");
  console.log(JSON.stringify({overview,facilityCardNavigation:'PASS',facilityCardHeader:'PASS',pickerClickPositions:'STABLE',groupedSelection:'PASS',popoverRefresh:'PASS',closeAlignment:'PASS',agentFocus:'PASS',gameCommands:0}));
  await client.js("setTimeout(()=>window.mobi.call('close-app'),50);true");for(let i=0;i<50&&child.exitCode===null;i++)await delay(100);assert.notEqual(child.exitCode,null);
 }finally{client?.ws.close();if(child.exitCode===null)child.kill();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
