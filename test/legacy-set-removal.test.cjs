const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../lib/data-management.cjs'),{Engine}=require('../lib/engine.cjs'),{fixtureDb,FakeCli}=require('./fake-cli.cjs');
const legacy={id:'old',kind:'cycle',facility:'시설',pattern:['missing-legacy-recipe'],repeatCount:3};
const modern={id:'new',kind:'cycle',planMode:true,facility:'시설',pattern:['A','B'],repeatCount:2};
const craft={kind:'craft',name:'키트',count:2,countUnit:'batches'};
test('import drops only legacy SET tasks and resulting empty presets, without mutating file',()=>{
 const file={format:'MobiNote-user-data',version:1,favorites:['gather:광석'],presets:[{id:'mixed',name:'혼합',tasks:[legacy,craft,modern]},{id:'empty',name:'이전 SET',tasks:[legacy]}]},before=JSON.stringify(file);const r=D.importData(file,fixtureDb());assert.equal(r.presets.length,1);assert.deepEqual(r.presets[0].tasks.map(t=>t.kind),['craft','cycle']);assert.equal(r.presets[0].tasks[1].planMode,true);assert.deepEqual(r.legacyExclusions,{removedTasks:2,removedPresets:1});assert.equal(JSON.stringify(file),before);
});
test('startup cleans saved queue and presets, detaches removed owners without canceling facility work',()=>{
 const db=fixtureDb(),saved={queue:[legacy,modern],presets:[{id:'p',name:'SET',tasks:[legacy]}],ledger:{시설:[{name:'A',owner:'old',recipeId:'A'},{name:'B',owner:'new',recipeId:'B'}]}};const before=JSON.stringify(saved),e=new Engine(new FakeCli({db}),saved,{db});assert.equal(e.queue.length,1);assert.equal(e.queue[0].id,'new');assert.equal(e.preferences.presets.length,0);assert.equal(e.ledger.시설[0].owner,null);assert.equal(e.ledger.시설[1].owner,'new');assert.deepEqual(e.legacyExclusions,{removedTasks:2,removedPresets:1});assert.equal(JSON.stringify(saved),before);assert.deepEqual(new Engine(new FakeCli({db}),e.persistent(),{db}).legacyExclusions,{removedTasks:0,removedPresets:0});
});
test('all-SET backups can restore favorites with no presets and show exclusion counts',()=>{
 const r=D.importData({format:'MobiNote-user-data',version:1,favorites:['materials:A'],presets:[{id:'x',name:'x',tasks:[legacy]}]},fixtureDb());assert.deepEqual(r.presets,[]);assert.deepEqual(r.favorites,['materials:A']);assert.match(D.exclusionMessage(r.legacyExclusions),/1건.*1개/);
});
test('new export omits legacy tasks while preserving modern repeated plan',()=>{const source={favorites:[],presets:[{id:'p',name:'p',tasks:[legacy,modern]}]};const data=D.exportData(source,fixtureDb());assert.equal(data.presets[0].tasks.length,1);assert.equal(data.presets[0].tasks[0].planMode,true);});

test('connection reset observation remains recoverable after processing terminology changes',async()=>{
 const db=fixtureDb(),cli=new FakeCli({db}),e=new Engine(cli,{}, {db,delay:async()=>{}});e.running=true;let attempts=0;cli.read=async()=>{if(!attempts++)throw Object.assign(new Error('reset'),{code:'ECONNRESET'});return {Mode:{MainButtonState:'Compass'}};};assert.deepEqual(await e.read('get_activity'),{Mode:{MainButtonState:'Compass'}});assert.equal(attempts,2);
});
