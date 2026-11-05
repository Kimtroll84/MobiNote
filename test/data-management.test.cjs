'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../lib/data-management.cjs'),{fixtureDb}=require('./fake-cli.cjs');
const db=fixtureDb();
function preferences(){return {favorites:['gather:광석','materials:A'],presets:[{id:'p1',name:'테스트',tasks:[{kind:'craft',name:'키트',count:2,completed:1,status:'stopped'},{kind:'register',facility:'시설',pattern:['A','B']},{kind:'cycle',planMode:true,facility:'시설',pattern:['A','A','B'],repeatCount:3,gatherBatches:10}]}],queue:[{name:'제외할 대기줄'}],agentCharacter:'B',cliPath:'private'};}
test('backup round trip preserves ordered favorites and preset task settings, excluding queue and runtime fields',()=>{
 const source=preferences(),file=D.exportData(source,db),restored=D.importData(JSON.parse(JSON.stringify(file)),db);
 assert.deepEqual(Object.keys(file).sort(),['exportedAt','favorites','format','presets','version']);
 assert.deepEqual(restored.favorites,source.favorites);assert.equal(restored.presets[0].tasks[0].count,2);
 assert.equal(restored.presets[0].tasks[0].completed,undefined);assert.equal(restored.presets[0].tasks[0].status,undefined);
 assert.deepEqual(restored.presets[0].tasks[1].pattern,['A','B']);assert.equal(restored.presets[0].tasks[2].repeatCount,3);
 assert.equal(restored.presets[0].tasks[2].gatherBatches,10);assert.equal(source.presets[0].tasks[0].completed,1);
});
test('invalid backup never changes preferences; invalid item references, versions and duplicate preset IDs reject',()=>{
 const source=preferences(),before=JSON.stringify(source),file=D.exportData(source,db);
 for(const bad of [{}, {...file,version:2},{...file,favorites:['craft:不明']},{...file,presets:[...file.presets,...file.presets]},{...file,presets:[{id:'p',name:'壊れた',tasks:[{kind:'craft',name:'キット',count:1}]}]}])assert.throws(()=>D.importData(bad,db));
 assert.equal(JSON.stringify(source),before);
});
test('empty backup is valid for explicit replacement',()=>assert.deepEqual(D.importData({...D.exportData(preferences(),db),favorites:[],presets:[]},db),{favorites:[],presets:[]}));
