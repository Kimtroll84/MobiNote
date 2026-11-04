'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AgentSpeechHistory}=require('../ui/agent-flow.js');
const text=(message,detail='')=>({message,detail});
test('short speech is retained once while new speech is returned immediately',()=>{
 const f=new AgentSpeechHistory();f.update({type:'checking'},text('확인 중'),'A',0);
 const v=f.update({type:'craft'},text('제작 중'),'A',100);
 assert.equal(v.previous,'확인 중');assert.equal(f.current.message,'제작 중');assert.equal(f.current.since,100);
 f.update({type:'register'},text('등록 중'),'A',200);assert.equal(f.previous,'제작 중');
});
test('sufficiently displayed speech is not carried into the next message',()=>{
 const f=new AgentSpeechHistory();f.update({type:'craft'},text('제작 중'),'A',0);
 assert.equal(f.update({type:'collect'},text('수령 중'),'A',2500).previous,'');
});
test('same message and changing metadata never reset the reading clock or create history',()=>{
 const f=new AgentSpeechHistory();f.update({type:'checking',item:'A'},text('확인 중'),'A',0);
 f.update({type:'checking',item:'B'},text('확인 중'),'A',2000);
 assert.equal(f.current.since,0);assert.equal(f.update({type:'craft'},text('제작 중'),'A',2600).previous,'');
});
for(const type of ['gather','shortage','waiting','done','stopped','error'])test(`${type} remains isolated from previous speech`,()=>{
 const f=new AgentSpeechHistory();f.update({type:'checking'},text('이전 대사'),'A',0);
 assert.equal(f.update({type},text('전용 대사','수량 / 결과'),'A',10).previous,'');
 assert.equal(f.update({type:'craft'},text('다음 제작'),'A',20).previous,'');
});
test('additional progress details immediately remove history even if the main sentence stays the same',()=>{
 const f=new AgentSpeechHistory();f.update({type:'checking'},text('확인'),'A',0);f.update({type:'craft'},text('제작'),'A',10);
 assert.equal(f.previous,'확인');assert.equal(f.update({type:'craft'},text('제작','1 / 10'),'A',20).previous,'');
});
test('repeated updates do not extend history expiry',()=>{
 const f=new AgentSpeechHistory();f.update({type:'checking'},text('확인'),'A',0);const initial=f.update({type:'craft'},text('제작'),'A',10);
 const repeated=f.update({type:'craft'},text('제작'),'A',2000);assert.equal(repeated.expiresAt,initial.expiresAt);
 assert.equal(f.expire(2510),'');assert.equal(f.current.message,'제작');
});
test('switching voice and starting a new run clears earlier speech',()=>{
 const f=new AgentSpeechHistory();f.update({type:'checking'},text('확인해요'),'A',0);
 assert.equal(f.update({type:'craft'},text('제작할게'),'B',10).previous,'');f.reset();assert.equal(f.current,null);
});
