'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/model.cjs');
const { Engine } = require('../lib/engine.cjs');
const { decode } = require('../lib/transport.cjs');
const { FakeCli, fixtureDb } = require('./fake-cli.cjs');

test('all 91 processing recipe times come from the supplied CSV, including silver variants', () => {
  const recipes = [...M.catalog.materials, ...M.deferredMaterials];assert.equal(recipes.length, 91);assert.equal(M.deferredMaterials.length, 0);
  assert.ok(recipes.every(r => Number.isSafeInteger(r.durationSeconds) && r.durationSeconds > 0 && r.durationSource === 'user-csv-2026-11-03'));
  assert.deepEqual(recipes.filter(r => r.name === '은합금괴').map(r => r.durationSeconds).sort((a,b)=>a-b), [11400,21600]);
});
test('membership doubles only total duration; actual remaining seconds stay unchanged', () => {
  const recipes = [{ name: 'A', durationSeconds: 100 }], work = { DisplayName: 'A', RemainingSeconds: 40 };
  assert.equal(M.durationFor(work, recipes), 100);assert.equal(M.progress(work, recipes), 60);
  assert.equal(M.durationFor(work, recipes, false), 200);assert.equal(M.progress(work, recipes, false), 80);
  assert.equal(work.RemainingSeconds, 40);
  const variants = [{ name: 'A', durationSeconds: 100 }, { name: 'A', durationSeconds: 200 }];
  assert.equal(M.durationFor(work, variants), 100);
  assert.equal(M.durationFor({ ...work, RemainingSeconds: 150 }, variants), 100);
});
for (const repeatCount of [1, 3, 5]) test(`SET ${repeatCount} laps registers exactly ${repeatCount * 2} jobs and collects all, without overfilling`, async () => {
  const db = fixtureDb(), cli = new FakeCli({ db, stock: { 천: 100 }, autoComplete: true });let now = 0;
  const e = new Engine(cli, {}, { db, now: () => now, delay: async ms => { now += ms;await Promise.resolve(); } });
  await e.connect();const job = e.add({ kind: 'cycle', facility: '시설', pattern: ['B','C'], repeatCount });await e.run();
  assert.deepEqual(cli.calls.filter(c => c.command === 'execute_altering').map(c => c.body.displayName), Array.from({ length: repeatCount }, () => ['B','C']).flat());
  assert.equal(job.completed, repeatCount * 2);assert.equal(job.status, 'done');assert.equal(cli.works.length, 0);
});
test('SET time limit stops registrations and drains already registered works, leaving ordinary tasks unaffected', async () => {
  const db = fixtureDb(), cli = new FakeCli({ db, stock: { 천: 100, 광석: 100 } });let now = 0;
  const e = new Engine(cli, { cycleTimeEnabled: true, cycleMinutes: 0.1 }, { db, now: () => now, delay: async ms => { now += ms;if (now >= 6000) for (const w of cli.works) Object.assign(w, { State: 'Completed', IsCompleted: true });await Promise.resolve(); } });
  await e.connect();const cycle = e.add({ kind: 'cycle', facility: '시설', pattern: ['B','C'], repeatCount: 100 });const craft = e.add({ kind: 'craft', name: '키트', count: 2 });
  await e.run();const registrations = cli.calls.filter(c => c.command === 'execute_altering').length;
  assert.ok(registrations > 0 && registrations < 200);assert.equal(cycle.completed, registrations);assert.equal(cycle.status, 'done');assert.equal(cycle.limitReason, '최대 반복 시간');
  assert.equal(craft.status, 'done');assert.equal(craft.completed, 2);assert.equal(cli.works.length, 0);
});
test('paused SET clocks and saved checkpoints exclude time while the app is stopped', () => {
  const db = fixtureDb();let now = 0;const e = new Engine(new FakeCli({ db }), {}, { db, now: () => now });
  const job = e.add({ kind: 'cycle', facility: '시설', pattern: ['B'], repeatCount: 10 });job.cycleClockStart = now;now = 5000;
  const saved = e.persistent();assert.equal(saved.queue[0].cycleElapsedMs, 5000);assert.equal(saved.queue[0].cycleClockStart, null);
  e.pauseCycle(job);now = 900000;assert.equal(e.cycleElapsed(job), 5000);
  const preset = M.presetConfig({ name: '횟수 보존', tasks: [job] }, db);assert.equal(preset.tasks[0].repeatCount, 10);assert.equal(preset.tasks[0].cycleElapsedMs, undefined);
  assert.equal(M.taskConfig({ kind: 'cycle', facility: '시설', pattern: ['B'], repeatCount: 0 }, db).repeatCount, null);
});
test('background poll never toggles manual refreshing or queries wings, including failure', async () => {
  const db = fixtureDb(), cli = new FakeCli({ db }), e = new Engine(cli, {}, { db });await e.connect();const states = [];e.on('change', s => states.push(s));cli.calls = [];
  await e.poll();assert.ok(states.length);assert.ok(states.every(s => s.refreshing === false));assert.equal(e.polling, null);
  assert.deepEqual(cli.calls.map(c => c.command), ['get_altering_works']);
  cli.read = async () => { throw new Error('연결 종료'); };await e.poll();assert.equal(states.at(-1).refreshing, false);assert.equal(states.at(-1).connected, false);
});
test('loading responses are localized in both JSON and text, preserving structured error data', () => {
  const message = 'This command is only available while in-game. Game is currently loading. Please wait until loading finishes.';
  for (const text of [message, JSON.stringify({ status: 'rejected', body: { error: 'loading', message } })]) assert.throws(() => decode(text), /게임을 불러오는 중이에요/);
  assert.throws(() => decode(JSON.stringify({ status: 'rejected', body: { error: 'unknown', message: 'Unknown technical issue' } })), e => e.code === 'unknown' && !/[a-z]/i.test(e.message));
});

for (const operation of ['connect', 'run']) test(`${operation} waits for an in-flight background poll before proceeding`, async () => {
  const db = fixtureDb(), cli = new FakeCli({ db, stock: { 천: 10, 광석: 10 } });
  const e = new Engine(cli, {}, { db, delay: async () => { await Promise.resolve(); } });await e.connect();
  e.add({ kind: 'craft', name: '키트', count: 1 });const originalRead = cli.read.bind(cli);let release;
  cli.read = async (...args) => { if (args[0] === 'get_altering_works' && !release) await new Promise(resolve => { release = resolve; });return originalRead(...args); };
  const poll = e.poll(), followup = e[operation]();assert.equal(e.refreshing, false);assert.equal(e.running, false);
  assert.equal(cli.calls.some(c => /^execute_/.test(c.command)), false);release();await Promise.all([poll, followup]);
  assert.equal(e.polling, null);assert.equal(e.connected, true);if (operation === 'run') assert.equal(e.queue[0].status, 'done');
});

test('all processing recipes are active, while time bars use the shortest same-name duration', () => {
  assert.equal(M.catalog.materials.length, 91);assert.equal(new Set(M.catalog.materials.map(r=>r.name)).size, 87);assert.equal(M.deferredMaterials.length,0);
  for(const recipe of M.catalog.materials) {
    const duration=Math.min(...M.catalog.materials.filter(r=>r.name===recipe.name).map(r=>r.durationSeconds));
    assert.equal(M.progress({DisplayName:recipe.name,RemainingSeconds:duration/2},M.catalog.materials),50);
    assert.equal(M.durationFor({DisplayName:recipe.name},M.catalog.materials),duration);
  }
});
test('recipe 2 IDs in jobs, presets and facility records remain selected after restart', () => {
  const second=M.catalog.materials.find(r=>r.name==='은합금괴'&&r.durationSeconds===21600);
  const task={kind:'materials',name:second.name,recipeId:second.id,count:4,completed:2,status:'stopped'};
  const cycle={kind:'cycle',planMode:true,facility:second.facility,pattern:[second.id],completed:1,nextIndex:2};
  const e=new Engine(new FakeCli(),{queue:[task],favorites:['materials:'+second.id],presets:[{id:'p',name:'재료표2',tasks:[task,cycle]}],ledger:{[second.facility]:[{name:second.name,recipeId:second.id}]}});
  assert.equal(e.queue[0].recipeId,second.id);assert.equal(e.queue[0].completed,2);assert.equal(e.preferences.presets[0].tasks[0].recipeId,second.id);
  assert.deepEqual(e.preferences.presets[0].tasks[1].pattern,[second.id]);assert.equal(e.ledger[second.facility][0].recipeId,second.id);
  assert.equal(M.taskConfig(task).recipeId,second.id);assert.deepEqual(M.taskConfig(cycle).pattern,[second.id]);
});
