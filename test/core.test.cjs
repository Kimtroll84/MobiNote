'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/model.cjs');
const { Engine } = require('../lib/engine.cjs');
const { decode } = require('../lib/transport.cjs');
const { FakeCli, fixtureDb } = require('./fake-cli.cjs');
async function fixture(options = {}) {
  const db = fixtureDb(), cli = new FakeCli({ db, ...options });let clock = 0;
  const e = new Engine(cli, {}, { db, now: () => clock, delay: async ms => { clock += ms;await Promise.resolve(); } });
  await e.connect();return { e, cli, db };
}
test('game-sourced catalog covers every item and retains same-name recipe alternatives', () => {
  assert.equal(new Set(M.catalog.crafts.map(r => r.name)).size, 1758);assert.equal(M.catalog.crafts.length, 1838);
  assert.equal(new Set(M.catalog.materials.map(r => r.name)).size, 87);assert.equal(M.catalog.materials.length, 91);
  assert.ok([...M.catalog.crafts, ...M.catalog.materials].every(r => r.ingredients.length && r.ingredients.every(i => Number.isSafeInteger(i.required) && i.required > 0)));
  assert.equal(M.catalog.crafts.some(r => r.name === M.EXCLUDED), false);
  const gold = M.catalog.crafts.find(r => r.name === '데코 트로피 상자(금)');assert.equal(gold.ingredients.find(i => i.name === '황금 주괴').required, 10);
});
test('capacity caps manual materials before calculating gatherable needs', () => {
  const r = fixtureDb().crafts[0], gather = new Set(['광석']);
  const cap = M.capacity(r, { 천: 5 }, gather, 10);assert.equal(cap.quantity, 2);assert.equal(cap.batches, 2);
  assert.equal(M.needs(r, cap.batches, {}, gather).find(x => x.name === '광석').needed, 6);
  assert.equal(M.estimate({ kind: 'craft', name: '키트', count: 10 }, { 천: 5 }, gather, fixtureDb()), 10);
});
test('multi-output crafting capacity is measured in crafting batches', () => {
  const r = { kind: 'craft', produced: 3, ingredients: [{ name: '천', required: 2 }] };
  assert.deepEqual([M.capacity(r, { 천: 3 }, new Set(), 4).batches, M.capacity(r, { 천: 3 }, new Set(), 4).quantity], [1, 1]);
});
test('SET fills all seven slots by selection order and obsolete repeat tasks are rejected', () => {
  assert.deepEqual(M.fillPattern(['A', 'B']), ['A', 'B', 'A', 'B', 'A', 'B', 'A']);
  assert.throws(() => M.taskConfig({ kind: 'repeat' }));
  assert.throws(() => M.taskConfig({ kind: 'cycle', facility: 'wrong', pattern: ['A'] }, fixtureDb()));
  assert.throws(() => M.taskConfig({ kind: 'craft', name: '키트', count: 0 }, fixtureDb()));
});
test('zero-capacity queued production is red, skipped, and does not block the next task', async () => {
  const { e, cli } = await fixture();const a = e.add({ kind: 'craft', name: '키트', count: 3 });
  e.add({ kind: 'gather', name: '광석', count: 1 });assert.equal(e.snapshot().queue[0].insufficient, true);
  await e.run();assert.equal(a.status, 'skipped');assert.equal(e.queue[1].status, 'done');
  assert.equal(cli.calls.filter(x => x.command === 'execute_crafting').length, 0);
  assert.equal(cli.calls.filter(x => x.command === 'execute_gathering').length, 1);
});
test('partial crafting gathers only for affordable output and keeps a red reduction marker', async () => {
  const { e, cli } = await fixture({ stock: { 천: 4 } });const a = e.add({ kind: 'craft', name: '키트', count: 10 });
  await e.run();assert.equal(a.status, 'done');assert.equal(a.completed, 2);assert.equal(cli.stock.천, 0);
  assert.equal(e.snapshot().queue[0].insufficient, true);assert.equal(cli.calls.find(x => x.command === 'execute_crafting').body.craftCount, 2);
});
test('SET fills slots first before ordinary processing gets its turn', async () => {
  const { e, cli } = await fixture({ stock: { 광석: 100, 천: 100 } });
  e.add({ kind: 'cycle', facility: '시설', pattern: ['B', 'C'] });e.add({ kind: 'materials', name: 'A', count: 2 });
  cli.onAction = () => { if (cli.works.length === 7) e.cancelReason = 'user'; };
  await e.run();assert.deepEqual(cli.calls.filter(c => c.command === 'execute_altering').map(c => c.body.displayName), ['B', 'C', 'B', 'C', 'B', 'C', 'B']);
  assert.equal(e.terminal.type, 'stopped');assert.equal(cli.works.length, 7);
});
test('finite processing completes registered batches and ignores existing output stock', async () => {
  const { e, cli } = await fixture({ stock: { 광석: 50, A: 1000 }, autoComplete: true });const job = e.add({ kind: 'materials', name: 'A', count: 3 });
  await e.run();assert.equal(job.status, 'done');assert.equal(job.completed, 3);assert.equal(cli.stock.A, 1000);assert.equal(cli.works.length,3);
  assert.equal(cli.calls.filter(x => x.command === 'execute_altering').length, 3);assert.equal(e.terminal.type, 'done');
});
test('an immediate task leaves unrelated queued tasks waiting', async () => {
  const { e } = await fixture({ stock: { 광석: 100, 천: 10 } });const queued = e.add({ kind: 'craft', name: '키트', count: 1 }), immediate = e.add({ kind: 'gather', name: '광석', count: 1 });
  await e.run(immediate.id);assert.equal(immediate.status, 'done');assert.equal(queued.status, 'waiting');
});
test('bag threshold is 95 by default, actual 94.99 passes, and 95 stops before paid action', async () => {
  const { e, cli } = await fixture({ stock: { 천: 10, 광석: 100 } });assert.equal(e.preferences.limit, 95);
  cli.weight = 94.99;await e.guard();cli.weight = 95;e.add({ kind: 'craft', name: '키트', count: 1 });await e.run();
  assert.equal(e.terminal.type, 'error');assert.equal(cli.calls.filter(x => x.command === 'execute_crafting').length, 0);
});
test('uncertain execution checkpoints cannot be resumed and clean presets remove all runtime history', async () => {
  const { e, db } = await fixture();const job = e.add({ kind: 'craft', name: '키트', count: 2 });job.status = 'stopped';job.uncertain = true;
  await assert.rejects(e.resume(job.id), /실행 결과/);
  const preset = M.presetConfig({ name: '계획', tasks: [job] }, db);assert.equal('status' in preset.tasks[0], false);assert.equal('uncertain' in preset.tasks[0], false);assert.equal(preset.tasks[0].count, 2);
});
test('unexpected registration outcome is stopped as uncertain and cannot silently register again', async () => {
  const { e, cli } = await fixture({ stock: { 광석: 100 } });const job = e.add({ kind: 'materials', name: 'A', count: 1 });
  cli.onAction = () => { cli.works.push({ DisplayName: 'unexpected', FacilityName: '시설', RemainingSeconds: 1 }); };
  await e.run();assert.equal(job.uncertain, true);assert.equal(job.status, 'held');await assert.rejects(e.resume(job.id));
  assert.equal(cli.calls.filter(x => x.command === 'execute_altering').length, 1);
});
test('facility observation continues during a run and timings are explicit user choices', async () => {
  const { e, cli } = await fixture();const n = cli.calls.length;e.running = true;await e.poll();assert.equal(cli.calls.length, n+1);assert.equal(cli.calls.at(-1).command,'get_altering_works');
  assert.deepEqual(M.TIMING, { facilities: 5000, observation: 1000, response: 500, stopChecks: 10 });
});
test('CLI errors preserve maxCount for safe pre-execution count correction', () => {
  let error;try { decode(JSON.stringify({ status: 'rejected', body: { error: 'invalid_count', maxCount: 7 } })); } catch (e) { error = e; }
  assert.equal(error.code, 'invalid_count');assert.equal(error.body.maxCount, 7);
  assert.deepEqual(decode('{"status":"accepted","body":{"result":"completed"}}'), { result: 'completed' });
});
test('progress ratios need an actual configured duration and never invent a recipe time', () => {
  assert.equal(M.progress({ DisplayName: 'A', RemainingSeconds: 40 }, []), null);
  assert.equal(M.progress({ DisplayName: 'A', RemainingSeconds: 40 }, [{ name: 'A', durationSeconds: 100 }]), 60);
  assert.equal(M.progress({ DisplayName: 'A', RemainingSeconds: 40, State: 'NotStarted' }, [{ name: 'A', durationSeconds: 100 }]), 0);
});

test('gathering stops at an observed finite quantity using 1s observations and resumes only the remaining amount', async () => {
  const db = fixtureDb(), cli = new FakeCli({ db });let pending, gained = 0, clock = 0, engine, interrupt = true;
  const original = cli.action.bind(cli);cli.action = async (command, body) => {
    if (command === 'execute_gathering') { cli.calls.push({ command, body });gained = 0;return new Promise(resolve => { pending = resolve; }); }
    if (command === 'stop_action' && pending) { cli.calls.push({ command });const resolve = pending;pending = null;resolve({ result: 'stopped', gained });return {}; }
    return original(command, body);
  };
  engine = new Engine(cli, {}, { db, now: () => clock, delay: async ms => { clock += ms;if (pending && ms === 1000) { cli.stock.광석 = (cli.stock.광석 || 0) + 1;gained++;if (interrupt && gained === 2) engine.cancelReason = 'user'; }await Promise.resolve(); } });
  await engine.connect();const job = engine.add({ kind: 'gather', name: '광석', count: 5 });await engine.run();
  assert.equal(job.completed, 2);assert.equal(job.status, 'stopped');assert.equal(engine.terminal.type, 'stopped');
  interrupt = false;await engine.resume(job.id);await engine.run();assert.equal(job.completed, 5);assert.equal(cli.stock.광석, 5);assert.equal(job.status, 'done');
});

test('fresh inventory invalidates older missing-ingredient stock and produces a current queue warning', async () => {
  const { e, cli } = await fixture();const job = e.add({ kind: 'craft', name: '키트', count: 2 });await e.fresh(e.db.crafts[0]);
  assert.equal(e.snapshot().queue[0].possible, 0);cli.stock.천 = 4;await e.inventory();
  assert.equal(e.snapshot().queue[0].possible, 2);assert.equal(e.snapshot().queue[0].insufficient, false);assert.equal(job.status, 'waiting');
});

test('cycling can resume a known facility queue, collect partial completions, and refill seven slots', async () => {
  const { e, cli } = await fixture({ stock: { 천: 100 } });const job = e.add({ kind: 'cycle', facility: '시설', pattern: ['B', 'C'] });
  let registrations = 0;cli.onAction = () => { if (++registrations === 7) e.cancelReason = 'user'; };await e.run();
  assert.equal(cli.works.length, 7);cli.works[0].IsCompleted = true;cli.works[0].State = 'Completed';
  await e.resume(job.id);cli.onAction = () => { e.cancelReason = 'user'; };await e.run();
  assert.equal(job.completed, 1);assert.equal(cli.works.length, 7);assert.equal(cli.works.at(-1).DisplayName, 'C');
});

test('cancelling a cycle during registration stops additional paid registrations', async () => {
  const { e, cli } = await fixture({ stock: { 천: 100 } });const job = e.add({ kind: 'cycle', facility: '시설', pattern: ['B'] });
  cli.onAction = () => { job.cancelled = true; };await e.run();
  assert.equal(cli.calls.filter(x => x.command === 'execute_altering').length, 1);assert.equal(cli.works.length, 1);
  assert.equal(job.status, 'stopped');assert.equal(e.terminal.type, 'stopped');
});

test('a successful immediate run counts only its own tasks in the terminal notification', async () => {
  const { e } = await fixture({ stock: { 천: 10, 광석: 100 } });const old = e.add({ kind: 'craft', name: '키트', count: 1 });old.status = 'done';
  const job = e.add({ kind: 'craft', name: '키트', count: 1 });await e.run(job.id);
  assert.equal(e.terminal.completed, 1);assert.equal(e.terminal.total, 1);
});
