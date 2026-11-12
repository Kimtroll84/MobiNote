'use strict';
if(new URLSearchParams(location.search).get('embedded')==='1'){
  document.documentElement.classList.add('embedded-agent');
  const stateListeners=[],resultListeners=[],pending=new Map();let sequence=0,initial;
  window.agentApi={
    call:(command,...args)=>{
      if(command==='bootstrap'&&initial)return Promise.resolve(initial);
      if(!['bootstrap','stop','hide-progress','agent-trace'].includes(command))return Promise.reject(new Error('허용되지 않은 작업 에이전트 요청이에요.'));
      const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,command});parent.postMessage({type:'agent-call',id,command,args},'*');});
    },
    subscribe:callback=>stateListeners.push(callback),onResult:callback=>resultListeners.push(callback)
  };
  window.addEventListener('message',event=>{
    if(event.source!==parent||!event.data)return;const data=event.data;
    if(data.type==='agent-init'){
      initial=data.data;for(const [id,request]of pending)if(request.command==='bootstrap'){request.resolve(initial);pending.delete(id);}
    }
    if(data.type==='agent-response'){const request=pending.get(data.id);if(request){pending.delete(data.id);data.error?request.reject(new Error(data.error)):request.resolve(data.data);}}
    if(data.type==='agent-state')for(const callback of stateListeners)callback(data.state);
    if(data.type==='agent-result')for(const callback of resultListeners)callback(data.result);
  });
}
