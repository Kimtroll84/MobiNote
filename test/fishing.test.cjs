'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');

for(const mode of ['Fishing','FishingPull','Compass'])test(`fishing waits for a catch and stops at target (${mode})`,async()=>{
  const db=fixtureDb();db.gather=[{id:'bass',name:'농어',kind:'gather',path:['낚시 - 물고기']}];
  const cli=new FakeCli({db}),read=cli.read.bind(cli),action=cli.action.bind(cli);
  let fishing=false,ticks=0,starts=0,stops=0;
  cli.read=async(command,name)=>command==='get_activity'?{Mode:{MainButtonState:fishing?mode:'Compass'}}:read(command,name);
  cli.action=async(command,body)=>{
    if(command==='execute_gathering'){starts++;fishing=true;return {result:'started'};}
    if(command==='stop_action'){stops++;fishing=false;return {};}
    return action(command,body);
  };
  const e=new Engine(cli,{}, {db,delay:async()=>{
    if(fishing&&++ticks===3)cli.stock.농어=1;
    assert.ok(ticks<10,'fishing should stop after target');
    await Promise.resolve();
  }});
  await e.connect();await e.runImmediate({kind:'gather',name:'농어',count:1});
  assert.equal(e.terminal.type,'done');assert.equal(cli.stock.농어,1);
  assert.equal(starts,1);assert.equal(stops,1);assert.equal(fishing,false);assert.ok(ticks>=3);
});

test('user stop ends fishing while waiting for the first catch',async()=>{
  const db=fixtureDb();db.gather=[{id:'bass',name:'농어',kind:'gather',path:['낚시 - 물고기']}];
  const cli=new FakeCli({db}),read=cli.read.bind(cli);let fishing=false,ticks=0;
  cli.read=async(command,name)=>command==='get_activity'?{Mode:{MainButtonState:'Compass'}}:read(command,name);
  cli.action=async(command)=>{if(command==='execute_gathering'){fishing=true;return {result:'started'};}if(command==='stop_action')fishing=false;return {};};
  const e=new Engine(cli,{}, {db,delay:async()=>{if(fishing&&++ticks===3)await e.stop();await Promise.resolve();}});
  await e.connect();await e.runImmediate({kind:'gather',name:'농어',count:1});
  assert.equal(e.terminal.type,'stopped');assert.equal(fishing,false);assert.equal(cli.stock.농어,undefined);
});
