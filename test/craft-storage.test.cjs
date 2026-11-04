'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');

async function setup(sugar=117){
  const db=fixtureDb();
  db.crafts=[{id:'souffle',name:'사과 수플레',kind:'craft',produced:1,path:['음식'],ingredients:[
    {name:'사과',required:8},{name:'밀가루',required:2},{name:'달걀',required:4},{name:'설탕',required:4}]}];
  db.gather=['사과','달걀'].map(name=>({id:'gather:'+name,name,kind:'gather',path:['일상 채집']}));
  const cli=new FakeCli({db,stock:{사과:1,밀가루:419,달걀:1,설탕:sugar}}),read=cli.read.bind(cli);
  cli.read=async(command,name)=>{
    const result=await read(command,name);
    if(command==='get_items')return result.map(row=>({...row,Location:'character_storage'}));
    if(command==='get_craftable_items')return {items:[{DisplayName:'사과 수플레',Craftable:false,Reason:'not_enough_ingredient',
      MissingIngredients:db.crafts[0].ingredients.map(i=>({DisplayName:i.name,Required:i.required,Owned:0}))}]};
    return result;
  };
  const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();
  return {e,cli};
}

test('souffle uses storage flour and sugar despite recipe Owned zero, gathering only missing ingredients',async()=>{
  const {e,cli}=await setup();
  assert.equal((await e.preview({kind:'craft',name:'사과 수플레',count:20})).batches,20);
  const job=e.add({kind:'craft',name:'사과 수플레',count:20});await e.run();
  assert.equal(job.completed,20);assert.equal(cli.stock['사과 수플레'],20);
  assert.equal(cli.stock.밀가루,379);assert.equal(cli.stock.설탕,37);
  assert.deepEqual([...new Set(cli.calls.filter(c=>c.command==='execute_gathering').map(c=>c.body.displayName))].sort(),['달걀','사과']);
});

test('actual shortage of storage sugar still limits crafting and collection',async()=>{
  const {e,cli}=await setup(4);
  assert.equal((await e.preview({kind:'craft',name:'사과 수플레',count:20})).batches,1);
  const job=e.add({kind:'craft',name:'사과 수플레',count:20});await e.run();
  assert.equal(job.completed,1);assert.equal(cli.stock['사과 수플레'],1);
});
