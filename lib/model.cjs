'use strict';
const { randomUUID } = require('node:crypto');
const catalog = require('../data/catalog.json');
const processingHistory = require('../data/deferred-processing-recipes.json');
const deferredMaterials = processingHistory.status === 'restored' ? [] : processingHistory.recipes;
const workTime = require('../ui/work-time.js');
const SLOT_COUNT = 7;
const TIMING = Object.freeze({ facilities: 5000, observation: 1000, response: 500, stopChecks: 10 });
const EXCLUDED = '간식 주면 안 잡아먹지';
const done = w => w.IsCompleted === true || w.State === 'Completed';
function rows(body, key = 'items') {
  const value = Array.isArray(body) ? body : body?.[key];
  if (!Array.isArray(value)) throw new Error('게임의 목록 응답을 확인해 주세요.');
  return value;
}
function stocks(items) {
  const result = {};
  for (const item of rows(items)) {
    if (item.IsLocked) continue;
    if (!item.DisplayName || !Number.isSafeInteger(Number(item.Count)) || Number(item.Count) < 0) throw new Error('아이템 수량 응답을 확인해 주세요.');
    result[item.DisplayName] = (result[item.DisplayName] || 0) + Number(item.Count);
  }
  return result;
}
function observedStocks(items) {
  const totals = {};
  for (const item of rows(items)) if (item.DisplayName && Number.isSafeInteger(Number(item.Count)) && Number(item.Count)>=0) totals[item.DisplayName]=(totals[item.DisplayName]||0)+Number(item.Count);
  return totals;
}
function outputName(recipe) { return recipe.kind === 'materials' ? recipe.name.replace(/\([^)]*\)$/, '').trim() : recipe.name; }
function variants(kind, name, db = catalog) { return (kind === 'craft' ? db.crafts : db.materials).filter(r => r.name === name); }
function canonicalMaterialId(id, db = catalog) {
  if (db.materials.some(r => r.id === id)) return id;
  const archived = deferredMaterials.find(r => r.id === id);
  return archived && db.materials.some(r => r.id === archived.activeRecipeId) ? archived.activeRecipeId : id;
}
function migrateMaterialTask(task, db = catalog) {
  const result = { ...task };
  if (task.kind === 'materials' && task.recipeId) result.recipeId = canonicalMaterialId(task.recipeId, db);
  if (task.kind === 'cycle') {
    result.gatherBatches = task.gatherBatches ?? 10;
    result.pattern = task.pattern.map(id => canonicalMaterialId(id, db));
    if (task.productCompleted) result.productCompleted = Object.entries(task.productCompleted).reduce((totals, [id, n]) => { const key = canonicalMaterialId(id, db);totals[key] = (totals[key] || 0) + n;return totals; }, {});
  }
  return result;
}
function recipeFor(task, db = catalog) {
  const list = task.kind === 'craft' ? db.crafts : db.materials;
  const id = task.kind === 'materials' ? canonicalMaterialId(task.recipeId, db) : task.recipeId;
  return id ? list.find(r => r.id === id && r.name === task.name) : list.find(r => r.name === task.name);
}
function migrateTask(task,db=catalog){
  const result=migrateMaterialTask(task,db);
  if(result.kind==='craft'&&result.countUnit!=='batches'){
    const produced=Number(recipeFor(result,db)?.produced)||1;
    result.count=Math.max(1,Math.ceil(result.count/produced));
    if(result.completed!=null)result.completed=Math.min(result.count,Math.ceil(result.completed/produced));
    if(result.possible!=null)result.possible=Math.ceil(result.possible/produced);
    result.countUnit='batches';
  }
  return result;
}
// Directly gatherable materials can be replenished. All others must already exist.
function capacity(recipe, stock, gatherables, requested = 999999) {
  let batches = recipe?.ingredients?.length ? Infinity : 0;
  for (const item of recipe?.ingredients || []) {
    if (!Number.isSafeInteger(item.required) || item.required <= 0) throw new Error('재료표의 필요 수량이 올바르지 않습니다.');
    if (!gatherables.has(item.name)) batches = Math.min(batches, Math.floor((stock[item.name] || 0) / item.required));
  }
  const wanted = requested;
  const possible = Math.min(wanted, batches);
  return { batches: possible, quantity: possible,
    manualMissing: (recipe?.ingredients || []).filter(i => !gatherables.has(i.name) && (stock[i.name] || 0) < i.required * wanted) };
}
function needs(recipe, batches, stock, gatherables) {
  return recipe.ingredients.map(i => ({ ...i, owned: stock[i.name] || 0, needed: i.required * batches,
    missing: Math.max(0, i.required * batches - (stock[i.name] || 0)), gatherable: gatherables.has(i.name) }));
}
function estimate(task, stock, gatherables, db = catalog) {
  if (task.kind === 'collect') return task.reregister ? null : 0;
  if (task.kind === 'cycle') {
    if(!task.repeatCount)return null;
    const pool={...stock},missing={};let registrations=0;
    for(const id of new Set(task.pattern)){
      const recipe=db.materials.find(r=>r.id===id);if(!recipe)return null;
      const count=task.pattern.filter(x=>x===id).length*task.repeatCount;
      const batches=capacity(recipe,pool,task.gatherBatches===0?new Set():gatherables,count).batches;
      registrations+=batches;
      for(const i of recipe.ingredients){const amount=i.required*batches,available=pool[i.name]||0;pool[i.name]=Math.max(0,available-amount);if(gatherables.has(i.name))missing[i.name]=(missing[i.name]||0)+Math.max(0,amount-available);}
    }
    return 5*(registrations+Object.values(missing).reduce((sum,n)=>sum+Math.ceil(n/100),0));
  }
  if (task.kind === 'gather') return task.count === 0 ? null : Math.ceil(task.count / 100) * 5;
  const r = recipeFor(task, db);if (!r) return null;
  const cap = capacity(r, stock, gatherables, task.count);
  const gathering = needs(r, cap.batches, stock, gatherables).filter(i => i.gatherable).reduce((n, i) => n + Math.ceil(i.missing / 100), 0);
  return (gathering + (task.kind === 'craft' ? cap.batches > 0 ? 1 : 0 : cap.batches)) * 5;
}
function fillPattern(pattern, slots = SLOT_COUNT) {
  if (!pattern.length) return [];
  return Array.from({ length: slots }, (_, i) => pattern[i % pattern.length]);
}
function taskConfig(input, db = catalog) {
  if (!input || !['gather', 'craft', 'materials', 'collect', 'cycle', 'register'].includes(input.kind)) throw new Error('지원하지 않는 작업입니다.');
  const task = { kind: input.kind };
  if (['cycle', 'register'].includes(input.kind)) {
    if (!db.facilities.some(f => f.name === input.facility)) throw new Error('가공 시설을 확인해 주세요.');
    const choices = input.pattern;
    if (!Array.isArray(choices) || !choices.length || choices.length > (input.kind === 'register' ? SLOT_COUNT : 100)) throw new Error('가공품을 선택해 주세요.');
    task.facility = input.facility;task.fromCurrent = input.fromCurrent === true;
    if (input.repeatCount != null && input.repeatCount !== '') {
      const count = Number(input.repeatCount);
      if (!Number.isSafeInteger(count) || count < 0 || count > 999999) throw new Error('반복 횟수는 0 이상의 정수로 입력하거나 비워 주세요.');
      task.repeatCount = count || null;
    } else task.repeatCount = null;
    if (input.kind === 'cycle') {
      const batches = Number(input.gatherBatches ?? 10);
      if (!Number.isSafeInteger(batches) || batches < 0 || batches > 999999) throw new Error('재료 채집 횟수는 0 이상의 정수로 입력해 주세요.');
      task.gatherBatches = batches;
    }
    task.pattern = choices.map(choice => {
      const id = canonicalMaterialId(choice, db), r = db.materials.find(r => r.id === id || r.name === choice);
      if (!r || r.facility !== input.facility) throw new Error('해당 시설의 가공품만 선택할 수 있습니다.');
      return r.id;
    });
  } else if (input.kind === 'collect') {
    if (input.facility && !db.facilities.some(f => f.name === input.facility)) throw new Error('가공 시설을 확인해 주세요.');
    task.facility = input.facility || '';task.reregister = input.reregister === true;
  } else {
    if (typeof input.name !== 'string' || input.name === EXCLUDED) throw new Error('품목을 확인해 주세요.');
    const n = Number(input.count);
    if (!Number.isSafeInteger(n) || n < (input.kind === 'gather' ? 0 : 1) || n > 999999) throw new Error('수량을 확인해 주세요.');
    task.name = input.name;task.count = n;
    if(input.kind==='craft')task.countUnit='batches';
    if (input.kind !== 'gather') {
      const r = recipeFor(input, db);if (!r || r.name !== task.name) throw new Error('등록된 레시피를 선택해 주세요.');
      task.recipeId = r.id;
    } else if (!db.gather.some(r => r.name === input.name)) throw new Error('등록된 채집 품목을 선택해 주세요.');
  }
  return task;
}
function newTask(input, db) { return { ...taskConfig(input, db), id: randomUUID(), status: 'waiting', completed: 0 }; }
function presetConfig(input, db = catalog) {
  if (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 120 || !Array.isArray(input.tasks) || !input.tasks.length) throw new Error('프리셋 이름과 작업을 확인해 주세요.');
  return { id: input.id || randomUUID(), name: input.name.trim(), tasks: input.tasks.map(t => taskConfig(t, db)) };
}
const progress = workTime.progress;
module.exports = { catalog, deferredMaterials, canonicalMaterialId, migrateMaterialTask, migrateTask, SLOT_COUNT, TIMING, EXCLUDED, done, rows, stocks, observedStocks, outputName, variants, recipeFor, capacity, needs, estimate, fillPattern, taskConfig, newTask, presetConfig, progress, durationFor: workTime.durationFor };
