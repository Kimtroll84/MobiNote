'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true});const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();return {e,cli};}
test('registration visibility lag is rechecked without repeating production',async()=>{
 const {e,cli}=await setup();const read=cli.read.bind(cli);let stale=0;
 cli.read=async(command,...args)=>{const result=await read(command,...args);if(command==='get_altering_works'&&cli.calls.some(c=>c.command==='execute_altering')&&stale++<2)return {works:[]};return result;};
 const job=e.add({kind:'materials',name:'A',count:1});await e.run();
 assert.equal(job.status,'done');assert.equal(job.completed,1);assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,1);
});
test('unexplained registration holds facility and still produces an unrelated item',async()=>{
 const {e,cli}=await setup();cli.onAction=(command)=>{if(command==='execute_altering')cli.works.push({DisplayName:'unexpected',FacilityName:'시설',RemainingSeconds:1});};
 const job=e.add({kind:'materials',name:'A',count:1}),next=e.add({kind:'craft',name:'키트',count:1});await e.run();
 assert.equal(job.status,'held');assert.equal(next.status,'done');assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,1);
});
test('failed shared raw-material preparation holds dependents but finishes unrelated production',async()=>{
 const {e,cli}=await setup();cli.stock.광석=0;e.db.crafts[0].ingredients=[{name:'천',required:2}];
 e.gather=async()=>{throw new Error('광석의 채집 수량이 늘지 않았어요.');};
 const a=e.add({kind:'materials',name:'A',count:1}),b=e.add({kind:'materials',name:'A',count:1}),next=e.add({kind:'craft',name:'키트',count:1});await e.run();
 assert.equal(a.status,'held');assert.equal(b.status,'held');assert.equal(next.status,'done');
});
test('persistent read disconnection remains manually stoppable',async()=>{
 const {e,cli}=await setup();const read=cli.read.bind(cli);let waits=0;
 cli.read=async(command,...args)=>{if(command==='get_items')throw Object.assign(new Error('disconnected'),{code:'disconnected'});return read(command,...args);};
 e.delay=async()=>{if(++waits===4)await e.stop();};e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'stopped');assert.equal(waits,4);
});
