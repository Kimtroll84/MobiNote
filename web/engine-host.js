'use strict';
(()=>{
 const native=MobiNative,M=MobiModules.require('/lib/model.cjs'),{Engine}=MobiModules.require('/lib/engine.cjs'),D=MobiModules.require('/lib/data-management.cjs');
 const notifyError=error=>native.call('diagnostic',{event:'host-error',message:error.message}).catch(()=>{});
 class NativeTransport{
  constructor(file){this.file=file||'';this.readTail=Promise.resolve();}
  async setPath(file){await native.call('validate-cli',{file});this.file=file;}
  read(command,body){const pending=this.readTail.catch(()=>{}).then(()=>this.request(command,body));this.readTail=pending;return pending;}
  action(command,body){return this.request(command,body);}
  async request(command,body){
   if(!this.file)throw new Error('설정에서 공식 CLI 파일을 선택해 주세요.');
   const result=await native.call('cli',{command,body,file:this.file});
   try{return MobiCliDecode(result.raw,result.exitCode);}catch(error){error.command=command;throw error;}
  }
 }
 let engine,transport,appInfo,agentVisible=false,pollingTimer;
 const ready=(async()=>{
  const startup=await native.call('startup');transport=new NativeTransport(startup.preferences.cliPath);appInfo=startup.appInfo;
  engine=new Engine(transport,startup.preferences);
  if(engine.legacyExclusions.removedTasks){await native.call('backup-settings');await native.call('persist-state',{persistent:engine.persistent(),state:engine.snapshot()});}
  engine.on('change',state=>{native.emit('state',state);native.call('persist-state',{persistent:engine.persistent(),state}).catch(notifyError);});
  engine.on('diagnostic',data=>native.call('diagnostic',data).catch(notifyError));
  engine.on('finished',async result=>{
   if(result.type==='error')await native.call('error-log',result).catch(notifyError);
   await showAgent();native.emit('result',result);await native.call('agent-result',{result}).catch(notifyError);
  });
  native.on('picker-position',position=>{engine.preferences.pickerPosition=position;native.call('persist-state',{persistent:engine.persistent(),state:engine.snapshot()}).catch(notifyError);});
  native.on('agent-position',position=>{engine.preferences.agentPosition=position;native.call('persist-state',{persistent:engine.persistent(),state:engine.snapshot()}).catch(notifyError);});
  native.on('agent-call',async request=>{try{await native.call('agent-response',{id:request.id,ok:true,data:await invoke(request.command,...request.args)});}catch(error){await native.call('agent-response',{id:request.id,ok:false,error:error.message});}});
  native.on('stop-request',()=>engine.stop());
  pollingTimer=setInterval(()=>engine.poll(),M.TIMING.facilities);
  await native.call('publish-state',{state:engine.snapshot()});
 })();
 function idle(){if(engine.running||engine.refreshing)throw new Error('실행이 끝난 뒤 설정해 주세요.');}
 function catalog(){return {...engine.db,materialReferences:M.deferredMaterials};}
 async function showAgent(){
  const embedded=engine.preferences.agentSeparate===false;
  agentVisible=embedded;native.emit('agent-visible',embedded);
  await native.call('show-agent',{embedded,state:engine.snapshot(),onTop:engine.preferences.agentOnTop!==false,position:engine.preferences.agentPosition});
 }
 async function hideAgent(){if(engine.running)return;agentVisible=false;native.emit('agent-visible',false);await native.call('hide-agent');}
 async function invoke(command,...args){
  await ready;const input=args[0];
  switch(command){
   case 'bootstrap':return {state:engine.snapshot(),catalog:catalog(),cliPath:transport.file,smoke:false,agentVisible,appInfo,migrationNotice:D.exclusionMessage(engine.legacyExclusions)};
   case 'connect':await engine.connect();return {state:engine.snapshot(),catalog:catalog()};
   case 'add':return engine.add(input);
   case 'preview':return engine.preview(input);
   case 'facility-slots':return engine.availableSlots(input);
   case 'start':{const execution=engine.runImmediate(input);await showAgent();execution.catch(error=>engine.publish({type:'error',text:error.message}));return true;}
   case 'run':await engine.prepareQueue();await showAgent();engine.run().catch(error=>engine.publish({type:'error',text:error.message}));return true;
   case 'stop':return engine.stop();
   case 'reset-queue':return engine.resetQueue();
   case 'remove':return engine.remove(input);
   case 'reorder':return engine.reorder(input);
   case 'clear':if(engine.running)throw new Error('중단 후 비워 주세요.');engine.queue=[];engine.publish();return;
   case 'wings':return engine.balance();
   case 'show-picker':idle();return native.call('show-picker',{data:input});
   case 'update-picker':return native.call('update-picker',{data:input});
   case 'hide-picker':return native.call('hide-picker');
   case 'picker-response':return native.call('picker-response',input);
   case 'show-progress':return showAgent();
   case 'hide-progress':return hideAgent();
   case 'choose-cli':idle();return native.call('choose-cli');
   case 'close-app':if(engine.running)throw new Error('작업을 중단한 뒤 닫아 주세요.');clearInterval(pollingTimer);await native.call('close-app');return;
   case 'settings':{
    idle();const refill=Number(input.processingRefillRounds??2);if(!Number.isSafeInteger(refill)||refill<1||refill>999)throw new Error('재료 준비 분량은 1~999회분으로 입력해 주세요.');
    const n=Number(input.limit),minutes=Number(input.cycleMinutes||0);
    if(!Number.isInteger(n)||n<1||n>100||!Number.isFinite(minutes)||minutes<0||(input.cycleTimeEnabled&&minutes<=0))throw new Error('가방 공간 기준과 SET 반복 시간을 확인해 주세요.');
    if(input.cliPath&&input.cliPath!==transport.file){await transport.setPath(input.cliPath);engine.connected=false;engine.wingsStale=true;}
    Object.assign(engine.preferences,{cliPath:transport.file,processingRefillRounds:refill,strictOrder:input.strictOrder===true,bagCheck:input.bagCheck===true,limit:n,fantasyMembership:input.fantasyMembership!==false,retryInterrupted:input.retryInterrupted===true,cycleTimeEnabled:input.cycleTimeEnabled===true,cycleMinutes:minutes,agentSeparate:input.agentSeparate!==false,agentOnTop:input.agentOnTop!==false,agentCharacter:input.agentCharacter==='B'?'B':'A'});
    engine.publish();if(await native.call('agent-visible'))await showAgent();return;
   }
   case 'favorite':{
    const keys=new Set([...engine.db.gather,...engine.db.crafts,...engine.db.materials].map(r=>r.kind+':'+(r.kind==='materials'?r.id:r.name)));
    if(!keys.has(input))throw new Error('등록된 품목을 선택해 주세요.');const set=new Set(engine.preferences.favorites);args[1]?set.add(input):set.delete(input);engine.preferences.favorites=[...set];engine.publish();return [...set];
   }
   case 'save-preset':{
    const preset=M.presetConfig(input,engine.db),all=engine.preferences.presets,index=all.findIndex(p=>p.id===preset.id);if(index<0)all.push(preset);else all[index]=preset;engine.publish();return preset;
   }
   case 'delete-preset':engine.preferences.presets=engine.preferences.presets.filter(p=>p.id!==input);engine.publish();return;
   case 'load-preset':{
    idle();const preset=engine.preferences.presets.find(p=>p.id===input);if(!preset)throw new Error('프리셋이 없어요.');engine.queue=preset.tasks.map(t=>M.newTask(t,engine.db));engine.publish();return;
   }
   case 'export-data':idle();return native.call('export-data',{backup:D.exportData(engine.preferences,engine.db)});
   case 'import-data':{
    idle();const text=await native.call('import-data');if(text==null)return false;
    let file;try{file=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('데이터 파일을 읽을 수 없어요. JSON 파일을 확인해 주세요.');}
    const data=D.importData(file,engine.db);
    if(!(await native.call('confirm-import',{favorites:data.favorites.length,presets:data.presets.length})))return false;
    idle();await native.call('backup-settings');const {legacyExclusions,...restored}=data;Object.assign(engine.preferences,restored);engine.publish();return {imported:true,migrationNotice:D.exclusionMessage(legacyExclusions)};
   }
   default:throw new Error('지원하지 않는 요청입니다.');
  }
 }
 window.mobi={call:invoke,subscribe:fn=>native.on('state',fn),onResult:fn=>native.on('result',fn),onCloseRequest:fn=>native.on('close-request',fn),onAgentVisible:fn=>native.on('agent-visible',fn)};
 ready.catch(error=>{document.body.textContent='앱 초기화 실패: '+error.message;notifyError(error);});
})();
