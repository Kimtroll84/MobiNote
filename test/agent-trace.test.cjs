const {test}=require('node:test'),assert=require('node:assert/strict'),{AgentTraceRecorder}=require('../ui/agent-trace.js');
test('trace captures original change timestamps, deduplicates repeats and batches without awaiting sender',async()=>{
 let now=100,scheduled,rows;const r=new AgentTraceRecorder(batch=>{rows=batch;return new Promise(()=>{});},{clock:()=>now,schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{}});
 r.record('agent-frame',{message:'준비',portrait:'01'});now=110;r.record('agent-frame',{message:'준비',portrait:'01'});now=120;r.record('agent-frame',{message:'채집',portrait:'05'});assert.equal(r.rows.length,2);scheduled();assert.equal(r.rows.length,0);assert.deepEqual(rows.map(x=>x.clientAtMs),[100,120]);r.record('agent-frame',{message:'제작',portrait:'05'});assert.equal(r.rows.length,1);
});
test('trace delivery failures never throw or change source snapshot',async()=>{
 const state={message:'그대로',detail:'1 / 10개'};const r=new AgentTraceRecorder(()=>Promise.reject(new Error('disk unavailable')),{schedule:()=>1,cancel:()=>{}});r.record('agent-frame',state);r.flush();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(state,{message:'그대로',detail:'1 / 10개'});assert.equal(r.rows.length,0);
});
test('counter, prior speech and portrait decode changes are separately observable',()=>{
 const r=new AgentTraceRecorder(()=>{}, {schedule:()=>1,cancel:()=>{}});for(const detail of [{message:'채집',detail:'0 / 10',previous:'준비',portraitReady:false},{message:'채집',detail:'1 / 10',previous:'준비',portraitReady:false},{message:'채집',detail:'1 / 10',previous:'',portraitReady:false},{message:'채집',detail:'1 / 10',previous:'',portraitReady:true}])r.record('agent-frame',detail);assert.equal(r.rows.length,4);
});

test('trace toggle discards pending records and resumes with a fresh snapshot',()=>{
 let sent=0,cancelled=0;const r=new AgentTraceRecorder(()=>sent++,{schedule:()=>1,cancel:()=>cancelled++});
 r.record('agent-frame',{message:'same'});r.setEnabled(false);assert.equal(cancelled,1);assert.equal(r.rows.length,0);r.record('agent-frame',{});r.flush();assert.equal(sent,0);
 r.setEnabled(true);r.record('agent-frame',{message:'same'});r.flush();assert.equal(sent,1);
});
test('trace preference defaults off and survives saved settings',()=>{
 const {Engine}=require('../lib/engine.cjs'),{FakeCli}=require('./fake-cli.cjs');const e=new Engine(new FakeCli());assert.equal(e.snapshot().preferences.agentTraceEnabled,false);e.preferences.agentTraceEnabled=true;const restored=new Engine(new FakeCli(),e.persistent());assert.equal(restored.snapshot().preferences.agentTraceEnabled,true);
});
