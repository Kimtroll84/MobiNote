'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {position}=require('../lib/agent-position.cjs');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli}=require('./fake-cli.cjs');
test('agent options default on and preserve independent values when embedded',()=>{
  const e=new Engine(new FakeCli());assert.equal(e.snapshot().preferences.agentSeparate,true);assert.equal(e.snapshot().preferences.agentOnTop,true);
  e.preferences.agentSeparate=false;assert.equal(e.persistent().agentSeparate,false);assert.equal(e.persistent().agentOnTop,true);
});
test('fresh install starts with empty user lists and no remembered agent position',()=>{
 const e=new Engine(new FakeCli());
 assert.deepEqual(e.queue,[]);assert.deepEqual(e.preferences.favorites,[]);assert.deepEqual(e.preferences.presets,[]);
 assert.equal(e.preferences.agentPosition,undefined);assert.equal(e.preferences.cliPath,'');
});
test('valid saved agent position is reused exactly',()=>assert.deepEqual(position({x:120,y:200},{x:0,y:0,width:1920,height:1040}),{x:120,y:200}));
test('offscreen saved agent position is clamped into the current monitor work area',()=>assert.deepEqual(position({x:5000,y:5000},{x:0,y:0,width:1920,height:1040}),{x:1320,y:810}));
test('negative coordinates on a left monitor are valid saved positions',()=>assert.deepEqual(position({x:-1600,y:120},{x:-1920,y:0,width:1920,height:1080}),{x:-1600,y:120}));
test('invalid saved position falls back to native placement',()=>{assert.equal(position(null,{x:0,y:0,width:1920,height:1080}),null);assert.equal(position({x:NaN,y:10},{x:0,y:0,width:1920,height:1080}),null);});
test('a monitor smaller than the agent keeps the window origin visible',()=>assert.deepEqual(position({x:400,y:300},{x:0,y:20,width:500,height:200}),{x:0,y:20}));
