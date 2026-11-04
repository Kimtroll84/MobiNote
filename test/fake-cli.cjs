'use strict';
const M = require('../lib/model.cjs');
class FakeCli {
  constructor({ db = M.catalog, stock = {}, autoComplete = false } = {}) {
    this.db = db;this.stock = { ...stock };this.works = [];this.calls = [];this.autoComplete = autoComplete;this.weight = 20;this.file = 'mock-cli';this.onAction = null;
  }
  setPath(file) { this.file = file; }
  async read(command, name) {
    this.calls.push({ command, body: name });
    if (command === 'status') return { pipe: 'connected' };
    if (command === 'capabilities') return {commands:[...require('../lib/transport.cjs').READ,...require('../lib/transport.cjs').ACTION].map(Command=>({Command}))};
    if (command === 'get_items') return Object.entries(this.stock).map(([DisplayName, Count]) => ({ DisplayName, Count, Location: 'inventory', IsLocked: false }));
    if (command === 'get_my_info') return { Vitals: { InventoryWeightCurrent: this.weight, InventoryWeightMax: 100 } };
    if (command === 'get_activity') return { autoTravel: { IsAutoTraveling: false }, Mode: { MainButtonState: 'Compass' } };
    if (command === 'get_currencies') return [{ DisplayName: '정령의 날개', Amount: 12345 }];
    if (command === 'get_gatherable_items') return { items: this.db.gather.map(r => ({ DisplayName: r.name, ToolOk: true })) };
    if (command === 'get_altering_works') return { works: structuredClone(this.works) };
    if (['get_craftable_items', 'get_alterable_items'].includes(command)) {
      const craft = command === 'get_craftable_items';return { items: (craft ? this.db.crafts : this.db.materials).filter(r => !name || r.name === name).map(r => {
        const missing = r.ingredients.filter(i => (this.stock[i.name] || 0) < i.required);
        return { DisplayName: r.name, [craft ? 'Craftable' : 'Alterable']: !missing.length, [craft ? 'ProducedPerCraft' : 'ProducedPerWork']: r.produced,
          ...(missing.length ? { Reason: 'not_enough_ingredient', MissingIngredients: missing.map(i => ({ DisplayName: i.name, Required: i.required, Owned: this.stock[i.name] || 0 })) } : {}) };
      }) };
    }
    throw new Error('Unexpected fake read: ' + command);
  }
  async action(command, body) {
    this.calls.push({ command, body });
    if (command === 'stop_action') return {};
    if (command === 'execute_gathering') { this.stock[body.displayName] = (this.stock[body.displayName] || 0) + 100;return { result: 'completed', gained: 100 }; }
    if (command === 'complete_altering_work') {
      const facility = this.works.find(w => w.DisplayName === body.displayName && M.done(w))?.FacilityName;
      if (!facility) throw new Error('No completed fake work');
      const ready = this.works.filter(w => w.FacilityName === facility && M.done(w));
      for (const w of ready) { const r = this.db.materials.find(r => r.name === w.DisplayName);const name = M.outputName(r);this.stock[name] = (this.stock[name] || 0) + r.produced; }
      this.works = this.works.filter(w => w.FacilityName !== facility || !M.done(w));return { result: 'completed', collected: ready.length };
    }
    const list = command === 'execute_crafting' ? this.db.crafts : this.db.materials;
    const recipe = list.find(r => r.name === body.displayName && r.ingredients.every(i => (this.stock[i.name] || 0) >= i.required * (body.craftCount || 1)));
    if (!recipe) throw new Error('Fake missing ingredients');
    for (const i of recipe.ingredients) this.stock[i.name] -= i.required * (body.craftCount || 1);
    if (command === 'execute_crafting') { this.stock[recipe.name] = (this.stock[recipe.name] || 0) + recipe.produced * body.craftCount;this.onAction?.(command, body);return { result: 'completed', craftCount: body.craftCount }; }
    this.works.push({ DisplayName: recipe.name, FacilityName: recipe.facility, RemainingSeconds: this.autoComplete ? 0 : 60, State: this.autoComplete ? 'Completed' : 'InProgress', IsCompleted: this.autoComplete });
    this.onAction?.(command, body);return { result: 'started' };
  }
}
function fixtureDb() {
  return { crafts: [{ id: 'kit', name: '키트', kind: 'craft', produced: 1, ingredients: [{ name: '천', required: 2 }, { name: '광석', required: 3 }], path: ['기타'] }],
    materials: [{ id: 'A', name: 'A', kind: 'materials', produced: 3, facility: '시설', ingredients: [{ name: '광석', required: 2 }], path: ['가공'] }, { id: 'B', name: 'B', kind: 'materials', produced: 1, facility: '시설', ingredients: [{ name: '천', required: 1 }], path: ['가공'] }, { id: 'C', name: 'C', kind: 'materials', produced: 1, facility: '시설', ingredients: [{ name: '천', required: 1 }], path: ['가공'] }],
    gather: [{ id: 'gather:광석', name: '광석', kind: 'gather', path: ['광석 캐기'] }], facilities: [{ name: '시설' }] };
}
module.exports = { FakeCli, fixtureDb };
