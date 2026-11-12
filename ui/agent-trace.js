'use strict';
// Observation only: sending and disk writes are never awaited by the task engine.
class AgentTraceRecorder {
 constructor(send,{clock=()=>performance.timeOrigin+performance.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}={}){this.send=send;this.clock=clock;this.schedule=schedule;this.cancel=cancel;this.rows=[];this.keys=new Map();this.timer=null;this.viewId=Math.random().toString(36).slice(2);}
 setEnabled(value){this.enabled=value===true;if(!this.enabled){if(this.timer)this.cancel(this.timer);this.timer=null;this.rows=[];this.keys.clear();}}
 record(event,detail={},deduplicate=true){if(this.enabled===false)return;try{const key=JSON.stringify(detail);if(deduplicate&&this.keys.get(event)===key)return;this.keys.set(event,key);this.rows.push({event,viewId:this.viewId,clientAtMs:this.clock(),...detail});if(this.rows.length>=50)this.flush();else if(!this.timer)this.timer=this.schedule(()=>{this.timer=null;this.flush();},1000);}catch{}}
 flush(){if(this.timer){this.cancel(this.timer);this.timer=null;}if(!this.rows.length)return;const batch=this.rows.splice(0,100);try{Promise.resolve(this.send(batch)).catch(()=>{});}catch{}}
}
globalThis.AgentTraceRecorder=AgentTraceRecorder;if(typeof module!=='undefined')module.exports={AgentTraceRecorder};
