'use strict';
(()=>{
  const pending=new Map(),listeners=new Map();let sequence=0;
  const on=(channel,callback)=>{if(!listeners.has(channel))listeners.set(channel,new Set());listeners.get(channel).add(callback);return()=>listeners.get(channel).delete(callback);};
  const emit=(channel,value)=>{for(const callback of [...(listeners.get(channel)||[])])callback(value);};
  const call=(method,body)=>new Promise((resolve,reject)=>{
    const id=++sequence;pending.set(id,{resolve,reject});window.chrome.webview.postMessage({id,method,body});
  });
  window.chrome.webview.addEventListener('message',event=>{
    const data=event.data;if(data.reply!=null){const entry=pending.get(data.reply);if(!entry)return;pending.delete(data.reply);data.ok?entry.resolve(data.data):entry.reject(Object.assign(new Error(data.error?.message||'앱 요청을 처리하지 못했어요.'),data.error||{}));}
    else if(data.event)emit(data.event,data.data);
  });
  globalThis.MobiNative={call,on,emit};
  // The native work-agent window forwards only its allowed actions to the main engine.
  window.mobi={call:(command,...args)=>call('agent-request',{command,args}),subscribe:fn=>on('state',fn),onResult:fn=>on('result',fn)};
  if(location.pathname.endsWith('/progress.html')&&!location.search.includes('embedded=1')){
    window.addEventListener('mousedown',event=>{
      if(event.button===0&&!event.target.closest('button,input,select,textarea,a,[role="button"]')){
        const scroll=event.target.closest('.bubble-scroll');
        if(scroll&&scroll.offsetWidth>scroll.clientWidth&&event.clientX>=scroll.getBoundingClientRect().left+scroll.clientWidth)return;
        event.preventDefault();call('drag-agent').catch(()=>{});
      }
    });
  }
})();
