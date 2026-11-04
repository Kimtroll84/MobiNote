const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../ui/app.js'),'utf8');
const choices=new Function(source.slice(source.indexOf('function registrationChoices('),source.indexOf('function renderPicker('))+';return registrationChoices;')();
const products=[{id:'A',ingredients:[{name:'광석',required:2},{name:'천',required:1}]}];
test('registration picker enables stocked products without shortage color',()=>{
 const r=choices(products,[],{광석:2,천:1},['광석']);assert.ok(r.available.has('A'));assert.equal(r.needsGather.size,0);
});
test('registration picker enables and colors only gatherable shortages',()=>{
 const r=choices(products,[],{천:1},['광석']);assert.ok(r.available.has('A'));assert.ok(r.needsGather.has('A'));
 assert.equal(choices(products,[],{광석:100},['광석']).available.size,0);
});
test('registration picker reserves shared materials after each selection',()=>{
 assert.equal(choices(products,['A'],{광석:2,천:1},['광석']).available.size,0);
 const r=choices(products,['A'],{광석:2,천:2},['광석']);assert.ok(r.available.has('A'));assert.ok(r.needsGather.has('A'));
});
test('one-time registration gathers shortages then registers without waiting for finished goods',async()=>{
 const {Engine}=require('../lib/engine.cjs'),{FakeCli,fixtureDb}=require('./fake-cli.cjs');
 const db=fixtureDb(),cli=new FakeCli({db,stock:{}}),e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();
 await e.runImmediate({kind:'register',facility:'시설',pattern:['A','A']});
 assert.equal(e.terminal.type,'done');assert.equal(cli.works.length,2);assert.ok(cli.works.every(w=>!w.IsCompleted));
 const actions=cli.calls.filter(c=>c.command.startsWith('execute_')).map(c=>c.command);
 assert.deepEqual(actions,['execute_gathering','execute_altering','execute_altering']);
});
