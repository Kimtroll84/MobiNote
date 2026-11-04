'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
for(const busy of [false,true])test(`slow gather termination waits beyond old limit (busy=${busy})`,async()=>{
 const cli=new FakeCli({db:fixtureDb()}),e=new Engine(cli,{}, {db:fixtureDb()});let ticks=0,stops=0;const stages=[];
 e.running=true;e.stage={type:'gather',item:'광석'};e.on('change',s=>stages.push(s.stage.type));
 cli.read=async()=>({IsAutoTraveling:busy&&ticks<15,Mode:{MainButtonState:'Compass'}});cli.action=async()=>{stops++;return {};};
 e.delay=async()=>{ticks++;};await e.stopGathering(()=>ticks>=18);
 assert.equal(ticks,18);assert.ok(stages.includes('stop-wait'));assert.equal(e.stage.type,'stop-wait');if(!busy)assert.equal(stops,1);
});
test('user stop retains termination confirmation instead of abandoning the running action',async()=>{
 const db=fixtureDb(),cli=new FakeCli({db}),e=new Engine(cli,{}, {db});let ticks=0;e.running=true;
 cli.read=async()=>({Mode:{MainButtonState:'Compass'}});cli.action=async()=>({});e.delay=async()=>{if(++ticks===12)e.cancelReason='user';};
 await e.stopGathering(()=>ticks>=18);assert.equal(ticks,18);assert.equal(e.cancelReason,'user');
});
