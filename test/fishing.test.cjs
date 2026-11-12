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

 test('fishing does not treat rejected stop and Compass as completion',async()=>{
  const e=new Engine(new FakeCli(),{}, {delay:async()=>{assert.ok(attempts<5);}});
  let attempts=0;
  e.transport.read=async()=>({Mode:{MainButtonState:'Compass'}});
  e.transport.action=async()=>{if(++attempts<3)throw Object.assign(new Error('not stoppable'),{code:'invalid_state'});return {};};
  await e.stopGathering(()=>true,{requireStopAck:true});
  assert.equal(attempts,3);
});
 test('processing preserves storage stock despite recipe Owned zero',async()=>{
  const db=fixtureDb(),cli=new FakeCli({db,stock:{천:641}}),e=new Engine(cli,{}, {db});
  await e.connect();
  e.live.materials=[{DisplayName:'B',MissingIngredients:[{DisplayName:'천',Required:1,Owned:0}]}];
  e.observedStockVersion.set('materials:B',e.stockVersion);
  assert.equal(e.recipeStock(db.materials[1]).천,641);
});
