'use strict';
const { EventEmitter } = require('node:events');
const M = require('./model.cjs');
const Preparation = require('./preparation.cjs');
const Plan = require('./facility-plan.cjs');
const Data = require('./data-management.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const value = x => Number(x?.Value ?? x);
const active = a => a?.IsAutoTraveling || a?.IsAutoPlaying || a?.autoTravel?.IsAutoTraveling || a?.autoPlay?.IsAutoPlaying || ['Stop','Fishing','FishingPull'].includes(a?.Mode?.MainButtonState);
const localRejections=new Set(['not_enough_ingredient','ingredient_locked','insufficient_facility_level','insufficient_living_skill_level','insufficient_decor_score','level_requirement','not_found','requires_user_interaction','tool_missing','tool_broken','required_consumable_missing']);
const transientReads=new Set(['timeout','ECONNRESET','EPIPE','disconnected','connection_lost','game_off','blocked','command_in_progress','rate_limited']);
const requiredCommands=['get_gatherable_items','get_craftable_items','get_alterable_items','get_altering_works','get_items','get_my_info','get_activity','get_currencies','execute_gathering','execute_crafting','execute_altering','complete_altering_work','stop_action'];
const itemError=(message,code='recipe_unavailable')=>Object.assign(new Error(message),{code,taskLocal:true});
class Engine extends EventEmitter {
  constructor(transport, preferences = {}, { db = M.catalog, delay = sleep, now = Date.now } = {}) {
    super();Object.assign(this, { transport, db, delay, now });
    const cleaned=Data.cleanLegacy(preferences);preferences=cleaned.value;this.legacyExclusions={removedTasks:cleaned.removedTasks,removedPresets:cleaned.removedPresets};
    const { timeLimitHours: _oldHours, durations: _oldDurations, ...savedPreferences } = preferences;
    this.preferences = { cliPath:'', bagCheck: true, limit: 95, fantasyMembership: true, retryInterrupted:true, manualMaterialsEnabled:false, manualMaterials:['마력 깃든 돌','반짝이는 이끼'], processingRefillRounds:2, strictOrder:false, cycleTimeEnabled: false, cycleMinutes: 120, agentTraceEnabled:false, agentSeparate:true, agentOnTop:true, agentCharacter:'A', favorites: [], presets: [], ...savedPreferences };
    this.preferences.manualMaterials=Array.isArray(this.preferences.manualMaterials)?[...new Set(this.preferences.manualMaterials.filter(n=>typeof n==='string'))]:['마력 깃든 돌','반짝이는 이끼'];
    this.preferences.favorites = [...new Set(this.preferences.favorites.map(key => key.startsWith('materials:') ? 'materials:' + M.canonicalMaterialId(key.slice(10), db) : key))];
    this.preferences.presets = this.preferences.presets.map(p => ({ ...p, tasks: p.tasks.map(t => M.migrateTask(t, db)) }));
    this.queue = (preferences.queue || []).map(t => ({ ...M.migrateTask(t, db), status: t.status === 'running' ? 'stopped' : t.status }));
    this.ledger = Object.fromEntries(Object.entries(preferences.ledger || {}).map(([facility, slots]) => [facility, slots.map(s => ({ ...s, recipeId: M.canonicalMaterialId(s.recipeId, db) }))]));this.stock = null;this.works = [];this.live = { craft: [], materials: [] };
    this.stockVersion = 0;this.observedStockVersion = new Map();
    this.gatherables = new Set(db.gather.map(r => r.name));this.connected = false;this.running = false;this.refreshing = false;
    this.stage = { type: 'idle', text: '게임 연결을 기다리고 있어요.' };this.wings = null;this.wingsStale = true;this.lastProbe = -Infinity;this.servicing = false;this.requests = [];
    this.bag = null;this.activeCommand = null;this.activeJob = null;this.cancelReason = null;this.terminal = null;
  }
  set gatherables(value){this._gatherables=value;}
  get gatherables(){return this.preferences.manualMaterialsEnabled?new Set([...this._gatherables].filter(name=>!this.preferences.manualMaterials.includes(name))):this._gatherables;}
  finishRegistration(job){
    const target=job.planMode?job.repeatCount&&job.repeatCount*job.pattern.length:job.kind==='materials'?job.limitBatches:null;
    const registered=job.planMode?job.nextIndex:job.registered;
    if(!target||registered<target||job.uncertain)return false;
    for(const slots of Object.values(this.ledger))for(const slot of slots)if(slot.owner===job.id)slot.owner=null;
    job.received=job.completed||0;job.completed=registered;job.status='done';job.finalRegistration=true;
    job.message='마지막 가공 등록을 마쳤어요. 등록한 가공은 게임에서 계속 진행돼요.';
    if(job.planMode){job.registrationStopped=true;this.pauseCycle(job);}if(this.reservations)delete this.reservations[job.id];return true;
  }
  persistent() { return { ...this.preferences, queue: this.queue.map(t => t.kind === 'cycle' ? { ...t, cycleElapsedMs: this.cycleElapsed(t), cycleClockStart: null } : t), ledger: this.ledger }; }
  snapshot() {
    const queue = this.queue.map(t => {
      const r = ['craft', 'materials'].includes(t.kind) ? M.recipeFor(t, this.db) : null;
      const capacity = r && this.stock ? M.capacity(r, this.recipeStock(r), this.gatherables, t.count).quantity : null;
      return { ...t, ...(t.kind === 'cycle' ? { cycleElapsedMs: this.cycleElapsed(t), cycleRemainingMs: t.cycleLimitMs ? Math.max(0, t.cycleLimitMs - this.cycleElapsed(t)) : null } : {}), possible: capacity, insufficient: t.status === 'skipped' || t.blocked === true || t.shortageStopped === true || (['waiting', 'stopped'].includes(t.status) && capacity !== null && capacity < t.count) || t.reduced === true,
        wings: t.initialWings ?? (this.stock ? M.estimate(t, this.stock, this.gatherables, this.db) : null) };
    });
    return { connected: this.connected, running: this.running, refreshing: this.refreshing, stock: this.stock, works: this.works, worksReceivedAt:this.worksReceivedAt, queue, queueMode:this.queueMode(), immediate: this.immediateTask ? { completed: this.immediateTask.status === 'done' ? 1 : 0, total: 1 } : null,
      gatherables: [...this.gatherables], wings: this.wings, wingsStale: this.wingsStale, bag: this.bag, stage: this.stage, terminal: this.terminal, updatedAt: this.updatedAt,
      preferences: { bagCheck: this.preferences.bagCheck, limit: this.preferences.limit, fantasyMembership: this.preferences.fantasyMembership, retryInterrupted:this.preferences.retryInterrupted,manualMaterialsEnabled:this.preferences.manualMaterialsEnabled,manualMaterials:this.preferences.manualMaterials, processingRefillRounds:this.preferences.processingRefillRounds, strictOrder:this.preferences.strictOrder, cycleTimeEnabled: this.preferences.cycleTimeEnabled, cycleMinutes: this.preferences.cycleMinutes, agentTraceEnabled:this.preferences.agentTraceEnabled===true, agentSeparate:this.preferences.agentSeparate, agentOnTop:this.preferences.agentOnTop, agentCharacter:this.preferences.agentCharacter, favorites: this.preferences.favorites, presets: this.preferences.presets } };
  }
  publish(stage) { if (stage) this.stage = stage;this.emit('change', this.snapshot()); }
  preparationStage(job){
    if(!job){const pending=this.tasks.filter(t=>this.eligible(t)&&['waiting','running'].includes(t.status));if(pending.length===1)job=pending[0];}
    return job?{type:'checking',taskKind:job.kind,item:job.name||job.facility||'전체 가공 시설',amount:job.count}:{type:'checking',taskKind:'queue',item:'대기줄'};
  }
  async retryDelay(error) {
    const seconds=Number(error.body?.retryAfterSeconds);
    let remaining=error.code==='rate_limited'&&Number.isFinite(seconds)&&seconds>0?Math.max(M.TIMING.observation,Math.ceil(seconds*1000)):M.TIMING.observation;
    while(remaining>0){if(this.running)this.check();const step=Math.min(remaining,M.TIMING.observation);await this.delay(step);remaining-=step;}
    if(this.running)this.check();
  }
  async read(command,body) {
    let previous,waiting=false,idleRetries=0;
    for(;;){
      if(waiting&&this.running)this.check();
      try{
        const result=await this.transport.read(command,body);
        // A successful inventory response alone need not mean character actions are ready.
        if(waiting&&command!=='get_activity')await this.transport.read('get_activity');
        if(waiting)this.publish(previous);
        return result;
      }catch(error){
        if(!this.running){
          if(!['command_in_progress','rate_limited','connection_lost'].includes(error.code)||idleRetries++>=3)throw error;
          await this.retryDelay(error);continue;
        }
        const loading=error.code==='loading';
        if(!loading&&!transientReads.has(error.code))throw error;
        if(!waiting){previous=this.stage;waiting=true;}
        const type=loading?'loading':error.code==='blocked'?'ui-blocked':'retry-read';if(this.stage.type!==type)this.publish({...previous,type,resumeType:previous.resumeType||previous.type,blockerKind:error.body?.kind,retryCode:error.code});
        await this.retryDelay(error);
      }
    }
  }
  handleTaskError(job,error){
    if(error.facility){this.holdFacility(error.facility,error.message);return true;}
    if(!error.taskLocal||job?.uncertain)return false;
    job.message=error.message;job.skipReason=error.message;job.reduced=true;job.blocked=true;
    if(this.reservations)delete this.reservations[job.id];
    if(job.kind==='cycle'){this.stopCycleForShortage(job);job.message=error.message;}
    if(job.kind==='materials')job.limitBatches=job.registered||0;
    const pending=Object.values(this.ledger).flat().some(s=>s.owner===job.id);
    job.status=pending&&['cycle','materials'].includes(job.kind)?'running':'skipped';
    this.sessionIds?.add(job.id);this.publish();return true;
  }
  holdFacility(facility,message){
    for(const task of this.tasks){
      const target=task.facility||(['materials'].includes(task.kind)?M.recipeFor(task,this.db).facility:null);
      if((target!==facility&&!(task.planMode&&Plan.facilities(task,this.db).includes(facility)))||!['waiting','running'].includes(task.status))continue;
      task.status='held';task.uncertain=true;task.blocked=true;task.message=message;task.skipReason=message;
      if(task.kind==='cycle')this.pauseCycle(task);
      if(this.reservations)delete this.reservations[task.id];
    }
    this.publish();
  }
  async verifyRegistration(facility,count,name){
    for(let attempt=0;attempt<3;attempt++){
      await this.readWorks();const actual=this.works.filter(w=>w.FacilityName===facility);
      if(actual.length===count+1&&actual.at(-1).DisplayName===name)return;
      this.check();if(attempt<2)await this.delay(M.TIMING.observation);
    }
    throw Object.assign(new Error('가공 등록 결과를 확인하지 못해 이 시설만 보류했어요.'),{facility});
  }
  async recoverableAction(command,body,job){
    for(;;){
      this.check();
      try{if(job)job.uncertain=true;return await this.transport.action(command,body);}
      catch(error){
        // Retry only explicit pre-start rejections. Accepted/transport failures may
        // already have spent wings or produced items and must not be resubmitted.
        if(error.responseStatus!=='rejected'||!['loading','blocked','disconnected','connection_lost','game_off','command_in_progress','rate_limited'].includes(error.code))throw error;
        if(job)job.uncertain=false;
        const previous=this.stage;this.publish({...previous,type:error.code==='loading'?'loading':error.code==='blocked'?'ui-blocked':error.code==='command_in_progress'?'busy':'retry-read',resumeType:previous.resumeType||previous.type,blockerKind:error.body?.kind,retryCode:error.code});
        await this.retryDelay(error);await this.confirmIdle();this.publish(previous);
      }
    }
  }
  unavailable(recipe,rows){
    const reason=rows[0]?.Reason||'recipe_unavailable';
    const error=itemError(`${recipe.name}의 제작·가공 조건을 충족하지 못해 이 작업을 건너뛰어요.`,reason);
    if(['blocked','overweight','inventory_full','insufficient_transfer_cost','not_enough_currency','game_off','disconnected'].includes(reason))error.taskLocal=false;
    return error;
  }
  recipeStock(recipe) {
    // Recipe Owned may omit storage. Use the same unlocked inventory/storage
    // totals for planning, display and execution; registration restrictions are checked separately.
    return { ...(this.stock || {}) };
  }

  jobStock(job,recipe){
    const stock=this.recipeStock(recipe);
    for(const other of this.tasks)if(other.id!==job.id&&['waiting','running'].includes(other.status))for(const ingredients of Object.values(this.reservations?.[other.id]||{}))for(const [name,count]of Object.entries(ingredients))stock[name]=Math.max(0,(stock[name]||0)-count);
    return stock;
  }
  reserveRecipe(job,recipe,batches){
    if(!this.reservations)return;
    const allocation=(this.reservations[job.id]||={})[recipe.id]||={};
    for(const i of recipe.ingredients)allocation[i.name]=Math.max(allocation[i.name]||0,i.required*batches);
  }
  consumeReservation(job,recipe,batches){
    const allocation=this.reservations?.[job.id]?.[recipe.id];if(!allocation)return;
    for(const i of recipe.ingredients)allocation[i.name]=Math.max(0,(allocation[i.name]||0)-i.required*batches);
  }
  async prepareMaterials({gather=true}={}){
    const tasks=this.tasks.filter(t=>this.eligible(t)&&['waiting','running'].includes(t.status));
    const production=tasks.filter(t=>!t.planMode&&['craft','materials','cycle'].includes(t.kind)&&!(t.kind==='cycle'&&this.preferences.cycleTimeEnabled&&this.cycleElapsed(t)>=this.preferences.cycleMinutes*60000));
    this.preparing=true;
    try{
      await this.inventory();const seen=new Set(),stock={...this.stock};
      for(const job of production){try{
        const recipes=job.kind==='cycle'?job.pattern.map(id=>this.db.materials.find(r=>r.id===id)):[M.recipeFor(job,this.db)];
        for(const recipe of recipes){const key=recipe.kind+':'+recipe.name;if(!seen.has(key)){await this.fresh(recipe);seen.add(key);}
          const rows=this.live[recipe.kind].filter(r=>r.DisplayName===recipe.name),flag=recipe.kind==='craft'?'Craftable':'Alterable';
          if(rows.length&&rows.every(r=>!r[flag]&&['insufficient_living_skill_level','insufficient_facility_level','insufficient_decor_score','requires_user_interaction'].includes(r.Reason)))throw this.unavailable(recipe,rows);
          Object.assign(stock,this.recipeStock(recipe));}
      }catch(error){if(!this.handleTaskError(job,error))throw error;}}
      this.reservations=Preparation.plan(production.filter(t=>['waiting','running'].includes(t.status)),stock,this.gatherables,this.db);
      this.plannedIds=new Set(tasks.map(t=>t.id));
      if(!gather)return;
      for(const name of Object.keys(Preparation.totals(this.reservations)).filter(n=>this.gatherables.has(n))){
        this.check();await this.inventory();const needed=Math.max(0,(Preparation.totals(this.reservations)[name]||0)-(this.stock[name]||0));if(!needed)continue;
        const owner=production.find(t=>Object.values(this.reservations[t.id]||{}).some(line=>(line[name]||0)>0));
        this.activeJob=owner;if(owner)this.sessionIds.add(owner.id);
        try{
          await this.gather(name,needed,owner,'대기줄 재료 준비');await this.inventory();
          if(owner?.cancelled)continue;
          if((this.stock[name]||0)<(Preparation.totals(this.reservations)[name]||0))throw new Error(`${name} 재료 수량을 확인하지 못했어요. 재료 잠금과 게임 상태를 확인해 주세요.`);
        }
        catch(error){
          const localFailure=/재료 수량을 확인|채집 수량이 늘지/.test(error.message)||(error.responseStatus==='rejected'&&localRejections.has(error.code));
          if(this.cancelReason||error.manual||error.code==='stop_not_confirmed'||!localFailure)throw error;
          for(const task of production)if(Object.values(this.reservations[task.id]||{}).some(line=>(line[name]||0)>0)){
            task.status='held';task.blocked=true;task.message=error.message;task.skipReason=error.message;delete this.reservations[task.id];
          }
          this.publish();
        }
      }
    }catch(error){
      const owner=this.activeJob||production.find(t=>['waiting','running'].includes(t.status));
      if(owner){owner.status='stopped';owner.message=error.message;this.sessionIds.add(owner.id);}throw error;
    }finally{this.preparing=false;this.activeJob=null;}
  }
  async inventory() { const items=await this.read('get_items');this.observedStock=M.observedStocks(items);this.stock = M.stocks(items);this.stockVersion++;this.updatedAt = this.now();return this.stock; }
  async balance() {
    try { const data = await this.read('get_currencies');const a = Array.isArray(data) ? data : data.items || data.currencies;
      const row = a?.find(x => x.DisplayName === '정령의 날개');const n = Number(row?.Amount ?? row?.Count);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('날개 수량을 확인하지 못했어요.');this.wings = n;this.wingsStale = false;
    } catch { this.wingsStale = true; }
    this.publish();
  }
  async connect() {
    if (this.polling) await this.polling;
    if (this.running || this.refreshing) throw new Error('작업이 끝난 뒤 연결을 갱신해 주세요.');
    this.refreshing = true;this.publish();
    try {
      const status = await this.read('status');if (status.pipe !== 'connected') throw new Error('캐릭터 접속과 AI 커넥터를 확인해 주세요.');
      if(this.capabilitiesFile!==this.transport.file){
        const catalog=await this.read('capabilities');
        if(catalog?.loading)throw Object.assign(new Error('게임이 명령 목록을 준비하고 있어요. 로딩이 끝난 뒤 연결해 주세요.'),{code:'loading'});
        if(!Array.isArray(catalog?.commands)||!catalog.commands.length)throw new Error('게임의 명령 목록을 확인하지 못했어요. 연결을 다시 확인해 주세요.');
        const supported=new Set(catalog.commands.map(c=>c.Command));
        const missing=requiredCommands.filter(c=>!supported.has(c));
        if(missing.length)throw new Error('현재 게임에서 필요한 명령을 지원하지 않아요: '+missing.join(', '));
        this.capabilitiesFile=this.transport.file;
      }
      this.live.craft = M.rows(await this.read('get_craftable_items')).filter(r => r.DisplayName !== M.EXCLUDED);
      this.live.materials = M.rows(await this.read('get_alterable_items'));
      const gather = M.rows(await this.read('get_gatherable_items'));this.gatherables = new Set(gather.map(x => x.DisplayName));
      const classification = new Map(require('../data/gather-classification.json').groups.flatMap(g => g.names.map(n => [n, g.category])));
      this.db = { ...this.db, gather: gather.map(x => ({ name: x.DisplayName, id: 'gather:' + x.DisplayName, kind: 'gather', toolOk:x.ToolOk, path: [classification.get(x.DisplayName) || '미분류'] })) };
      await this.inventory();await this.readWorks();await this.readBag();this.connected = true;
      await this.balance();this.publish({ type: 'idle', text: '게임 정보를 확인했어요.' });
    } catch (e) { this.connected = false;this.wingsStale = true;this.publish({ type: 'error', text: e.message });throw e; }
    finally { this.refreshing = false;this.publish(); }
    return this.snapshot();
  }
  async readWorks() { this.works = M.rows(await this.read('get_altering_works'), 'works');this.worksReceivedAt=this.now();return this.works; }
  async poll() {
    if (!this.connected || this.refreshing || this.polling) return;
    // Background observation must not toggle the manual refresh button state.
    this.polling = (async () => {
      try {
        if(this.running){
          // 실행 흐름에 개입하지 않는 시설 현황 조회. 수령·등록은 수행하지 않는다.
          const rows=await this.transport.read('get_altering_works');
          this.works=M.rows(rows,'works');this.worksReceivedAt=this.now();
        }else await this.readWorks();
        this.publish();
      }
      catch (e) { if(this.running)this.emit('diagnostic',{event:'facility-observation-deferred',code:e.code});else{this.connected = false;this.publish({ type: 'error', text: e.message });} }
      finally { this.polling = null; }
    })();
    await this.polling;
  }
  async readBag() {
    const info = await this.read('get_my_info');const v = info?.Vitals;
    const current = value(v?.InventoryWeightCurrent), max = value(v?.InventoryWeightMax);
    this.bag = Number.isFinite(current) && max > 0 ? { current, max, percent: current / max * 100 } : null;return this.bag;
  }
  check() {
    if (this.cancelReason) { const e = new Error(this.cancelReason === 'user' ? '사용자가 작업을 중단했어요.' : this.cancelReason);e.manual = this.cancelReason === 'user';throw e; }
  }
  cycleElapsed(job) { return (job.cycleElapsedMs || 0) + (job.cycleClockStart == null ? 0 : Math.max(0, this.now() - job.cycleClockStart)); }
  pauseCycle(job) { job.cycleElapsedMs = this.cycleElapsed(job);job.cycleClockStart = null; }
  stopCycleForShortage(job) {
    job.registrationStopped=true;job.shortageStopped=true;job.blocked=false;job.limitReason='재료 부족';delete job.refill;
    job.message='재료가 부족해 반복 가공 추가 등록을 멈췄어요. 등록한 가공품은 수령까지 마칠게요.';this.pauseCycle(job);
  }
  cycleRecipeRemaining(job, recipeId) {
    if(job.planMode)return Plan.remaining(job,recipeId);
    if(!job.repeatCount)return Infinity;
    const frequency=job.pattern.filter(id=>id===recipeId).length, laps=Math.floor(job.nextIndex/job.pattern.length), offset=job.nextIndex%job.pattern.length;
    return Math.max(0,(job.repeatCount-laps)*frequency-job.pattern.slice(0,offset).filter(id=>id===recipeId).length);
  }
  cycleRegistrationOpen(job) {
    if (job.registrationStopped) return false;
    const countReached = job.repeatCount != null && job.nextIndex >= job.repeatCount * job.pattern.length;
    const timeReached = job.cycleLimitMs && this.cycleElapsed(job) >= job.cycleLimitMs;
    if (!countReached && !timeReached) return true;
    job.registrationStopped = true;job.blocked = false;
    job.limitReason = countReached ? '지정한 반복 횟수' : '최대 반복 시간';
    job.message = `${job.limitReason}에 도달해 추가 등록을 마쳤어요. 등록한 가공은 수령까지 마칠게요.`;
    this.pauseCycle(job);return false;
  }
  async guard() {
    this.check();if (!this.preferences.bagCheck) return;
    const bag = await this.readBag();if (!bag) throw new Error('가방 공간을 확인할 수 없어요.');
    if (bag.percent >= this.preferences.limit) throw new Error(`가방 공간 확인 기준 ${this.preferences.limit}%에 도달했어요.`);
  }
  async fresh(recipe) {
    const command = recipe.kind === 'craft' ? 'get_craftable_items' : 'get_alterable_items';
    const selected = M.rows(await this.read(command, recipe.name)).filter(x => x.DisplayName === recipe.name);
    if (!selected.length) throw itemError(`${recipe.name}의 게임 레시피를 찾지 못해 이 작업을 건너뛰어요.`,'recipe_not_found');
    this.live[recipe.kind] = [...this.live[recipe.kind].filter(x => x.DisplayName !== recipe.name), ...selected];
    this.observedStockVersion.set(recipe.kind + ':' + recipe.name, this.stockVersion);
    return selected;
  }
  async preview(input) {
    const config = M.taskConfig(input, this.db), recipe = M.recipeFor(config, this.db);
    if (this.running) throw new Error('실행 중에는 대기줄에 담아 주세요.');
    if (!this.connected) throw new Error('게임에 연결해 주세요.');
    await this.inventory();await this.fresh(recipe);this.publish();
    return M.capacity(recipe, this.recipeStock(recipe), this.gatherables, config.count);
  }
  add(input) {
    if(this.running)throw new Error('작업을 중단한 뒤 대기줄에 추가해 주세요.');
    const task = M.newTask(input, this.db);
    if (task.kind === 'cycle' && this.queue.some(x => x.kind === 'cycle' && !x.planMode && !task.planMode && x.facility === task.facility && ['waiting', 'running', 'stopped'].includes(x.status))) throw new Error('이 시설의 반복 작업이 이미 있어요.');
    this.queue.push(task);this.publish();return task;
  }
  remove(id) {
    if(this.running)throw new Error('작업을 중단한 뒤 대기줄을 수정해 주세요.');
    const t = this.queue.find(x => x.id === id);if (!t) return;
    if (t.status === 'running') { t.cancelled = true;this.publish();return; }
    if(this.activeJob?.id===id)t.cancelled=true;
    if(this.reservations)delete this.reservations[id];
    this.queue = this.queue.filter(x => x.id !== id);this.publish();
  }
  reorder(ids) {
    if(this.running)throw new Error('작업을 중단한 뒤 대기줄을 수정해 주세요.');
    if (!Array.isArray(ids) || ids.length !== this.queue.length || new Set(ids).size !== ids.length || ids.some(id => !this.queue.some(x => x.id === id))) throw new Error('작업 순서를 확인해 주세요.');
    this.queue = ids.map(id => this.queue.find(x => x.id === id));this.publish();
  }
  async resume(id) {
    if (this.running) throw new Error('작업을 마친 뒤 이어가 주세요.');
    const job = this.queue.find(x => x.id === id);if (!job || !['stopped', 'error', 'skipped'].includes(job.status)) throw new Error('이어갈 작업을 선택해 주세요.');
    if (job.uncertain) throw new Error('실행 결과를 확인하지 못한 작업이에요. 게임을 확인하고 새로 등록해 주세요.');
    if (job.kind === 'materials' || job.kind === 'cycle') { await this.readWorks();for(const f of job.planMode?Plan.facilities(job,this.db):[job.facility||M.recipeFor(job,this.db).facility])this.reconcile(f); }
    job.status = 'waiting';job.cancelled = false;job.message = '';delete job.limitBatches;this.publish();
  }
  again(id) { const t = this.queue.find(x => x.id === id);if (!t) throw new Error('작업이 없어요.');return this.add(t); }
  queueMode() {
    if (this.queue.some(t => ['stopped','error'].includes(t.status))) return 'resume';
    return this.queue.length && this.queue.every(t => ['done','skipped'].includes(t.status)) ? 'restart' : 'start';
  }
  resetQueue() {
    if (this.running || this.immediateTask || this.refreshing) throw new Error('작업을 중단한 뒤 리셋해 주세요.');
    const replacement = this.queue.map(t => ({ ...M.newTask(t, this.db), id:t.id }));
    const ids = new Set(this.queue.map(t => t.id));
    // Existing game registrations continue, but do not count toward the new run.
    for (const slots of Object.values(this.ledger)) for (const slot of slots) if (ids.has(slot.owner)) slot.owner = null;
    this.queue = replacement;this.terminal = null;this.publish({type:'idle',text:'설정한 작업은 유지하고 진행 횟수를 초기화했어요.'});
  }
  async prepareQueue() {
    if (this.running || this.immediateTask || this.refreshing) throw new Error('이미 작업 중이에요.');
    if (!this.connected) throw new Error('게임에 연결해 주세요.');
    if (this.polling) await this.polling;
    const mode = this.queueMode();
    if (mode === 'restart') { this.resetQueue();return; }
    if (mode !== 'resume') return;
    const stopped = this.queue.filter(t => ['stopped','error'].includes(t.status));
    const facilities = [...new Set(stopped.filter(t => ['materials','cycle'].includes(t.kind)).map(t => t.planMode?Plan.facilities(t,this.db):[t.facility || M.recipeFor(t,this.db).facility]).flat())];
    if(facilities.length)await this.readWorks();
    const uncertain=stopped.filter(t=>t.uncertain);
    const intact=task=>{
      if(!['materials','cycle'].includes(task.kind))return false;
      if(task.planMode){const fs=Plan.facilities(task,this.db),owned=fs.flatMap(f=>this.ledger[f]||[]).filter(s=>s.owner===task.id);return owned.length===task.nextIndex-task.completed&&fs.every(f=>(this.ledger[f]||[]).length===this.works.filter(w=>w.FacilityName===f).length&&(this.ledger[f]||[]).every((s,i)=>s.name===this.works.filter(w=>w.FacilityName===f)[i]?.DisplayName));}
      const facility=task.facility||M.recipeFor(task,this.db).facility,slots=this.ledger[facility],actual=this.works.filter(w=>w.FacilityName===facility);
      const outstanding=(task.kind==='cycle'?task.nextIndex:task.registered)-task.completed;
      return outstanding>0&&slots?.length===actual.length&&slots.every((s,i)=>s.name===actual[i].DisplayName)&&slots.filter(s=>s.owner===task.id).length===outstanding;
    };
    if(uncertain.some(t=>!intact(t)))throw new Error('실행 결과를 확인하지 못한 항목이 있어요. 게임 현황을 확인한 뒤 리셋하면 진행 횟수를 초기화하고 새로 시작할 수 있어요.');
    for(const facility of facilities)this.reconcile(facility);
    for(const task of uncertain){task.uncertain=false;this.emit('diagnostic',{event:'resume-verified',taskId:task.id,registered:task.registered,nextIndex:task.nextIndex,completed:task.completed});}
    for (const task of stopped) { task.status='waiting';task.cancelled=false;task.message='';delete task.limitBatches; }
    this.terminal=null;this.publish();
  }
  async stop() {
    if (!this.running) return;this.cancelReason = 'user';
    if(this.activeCommand){
      const command=this.activeCommand;
      this.publish({type:'stopping',text:'중단을 요청했어요. 멈췄는지 확인하고 있어요.'});
      await this.requestActionStop(command);
    }else this.publish();
  }
  async requestActionStop(command,stageType='stopping'){
    if(this.stopRequestPending)return this.stopRequestPending;
    const pending=(async()=>{
      try{
        const response=await this.transport.action('stop_action');
        this.emit('diagnostic',{event:'user-stop-response',command,response});return true;
      }catch(error){
        this.emit('diagnostic',{event:'user-stop-response',command,code:error.code,response:error.body,message:error.message});
        if(this.running&&(!this.activeCommand||this.activeCommand===command)){
          const text=error.code==='blocked'?(error.body?.kind==='continuous_run_limit'?'게임에서 AI 커넥터 이용 확인을 눌러 주세요. 중단을 다시 요청하고 있어요.':'게임의 열린 창을 닫아 주세요. 중단을 다시 요청하고 있어요.'):'중단을 요청했어요. 멈췄는지 확인하고 있어요.';
          this.publish({...this.stage,type:stageType,text,stopRetry:true,blockerKind:error.code==='blocked'?(error.body?.kind||'unknown_modal'):undefined});
        }
      }
    })();
    this.stopRequestPending=pending;
    try{return await pending;}finally{if(this.stopRequestPending===pending)this.stopRequestPending=null;}
  }
  reconcile(facility) {
    const actual = this.works.filter(w => w.FacilityName === facility), ledger = this.ledger[facility];
    const mismatch=ledger&&(ledger.length!==actual.length||ledger.some((x,i)=>x.name!==actual[i].DisplayName));
    const owned=slot=>slot.owner&&this.tasks.some(t=>t.id===slot.owner);
    if(mismatch&&ledger.some(owned)){
      // Seven slots at most: enumerate deletion-only matches. Every possible
      // match must retain every owned slot, including when names are duplicated.
      const matches=[];
      const match=(next,start,indices)=>{
        if(next===actual.length){matches.push(indices);return;}
        for(let i=start;i<ledger.length;i++)if(ledger[i].name===actual[next].DisplayName)match(next+1,i+1,[...indices,i]);
      };
      match(0,0,[]);
      const protectedIndices=ledger.flatMap((slot,i)=>owned(slot)?[i]:[]);
      const signatures=matches.map(indices=>JSON.stringify(indices.map(i=>owned(ledger[i])?[ledger[i].owner,ledger[i].recipeId]:null)));
      if(!matches.length||matches.some(indices=>protectedIndices.some(i=>!indices.includes(i)))||new Set(signatures).size!==1)throw Object.assign(new Error(`${facility}의 작업 구성이 바뀌어 이 시설만 보류했어요.`),{facility});
      this.ledger[facility]=matches[0].map(i=>owned(ledger[i])?ledger[i]:{...ledger[i],owner:null});
      return this.ledger[facility];
    }
    if (!ledger||mismatch) this.ledger[facility] = actual.map(w => ({ name: w.DisplayName, owner: null,recipeId:this.db.materials.find(r=>r.name===w.DisplayName&&r.facility===facility)?.id }));
    return this.ledger[facility];
  }
  async perform(command, body, job = this.activeJob, stage = {}) {
    for(;;){
      let before;
      if(this.preferences.retryInterrupted&&command!=='execute_crafting'){
        await this.readWorks();before=this.facilitySignature(body.displayName);
      }
      try{return await this.performOnce(command,body,job,stage);}
      catch(error){
        if(!this.retryInterrupted(error,job))throw error;
        if(before!==undefined){
          await this.readWorks();
          // A changed facility may already have registered/collected work. Never replay it.
          if(before!==this.facilitySignature(body.displayName))throw error;
        }
        await this.waitActionRetry(job,body.displayName);
      }
    }
  }
  facilitySignature(name){
    const facility=this.db.materials.find(r=>r.name===name)?.facility;
    if(!facility)throw new Error('재시도할 가공 시설을 확인하지 못했어요.');
    return JSON.stringify(this.works.filter(w=>w.FacilityName===facility).map(w=>w.DisplayName));
  }
  retryInterrupted(error,job){
    return this.preferences.retryInterrupted===true&&!this.cancelReason&&!job?.cancelled
      &&['action_interrupted','blocked','canceled','cancelled'].includes(error.code);
  }
  async waitActionRetry(job,item){
    this.check();this.publish({type:'action-retry',item});
    // Reuse the facility interval and check cancellation every second.
    for(let elapsed=0;elapsed<M.TIMING.facilities;elapsed+=M.TIMING.observation){
      this.check();if(job?.cancelled)throw new Error('작업을 중단했어요.');
      await this.delay(M.TIMING.observation);
    }
    this.check();await this.confirmIdle();await this.guard();
  }
  async performOnce(command, body, job = this.activeJob, stage = {}) {
    await this.guard();
    if(await this.confirmIdle())await this.guard();
    if (command === 'execute_altering' && job?.kind === 'cycle' && !this.cycleRegistrationOpen(job)) return { skippedByLimit: true };
    if (job && ['execute_crafting', 'execute_altering', 'complete_altering_work'].includes(command)) job.uncertain = true;
    const facility=stage.facility||job?.facility||(command==='execute_altering'?this.db.materials.find(r=>r.name===body.displayName)?.facility:null);
    const reregister=stage.reregister??(command==='execute_altering'&&this.stage.reregister&&this.stage.facility===facility&&this.stage.speechJobId===job?.id);
    this.activeCommand = command;this.publish({facility,reregister,speechJobId:job?.id, type: stage.type || (command === 'execute_crafting' ? 'craft' : command === 'execute_altering' ? 'register' : 'collect'), item: body.displayName, ...stage });
    let result, error, settled = false;
    const pending = this.recoverableAction(command, body, job).then(x => { result = x; }, e => { error = e; }).finally(() => { settled = true; });
    try {
      let stopElapsed = M.TIMING.observation;
      while (!settled) {
        if (this.cancelReason && stopElapsed>=M.TIMING.observation) {
          await this.requestActionStop(command);stopElapsed=0;
        }
        await this.delay(M.TIMING.response);stopElapsed+=M.TIMING.response;
      }
      await pending;if (error) {
          if(['rejected','invalid_body','expired','disabled'].includes(error.responseStatus)){
          if(job)job.uncertain=false;
          if(localRejections.has(error.code))error.taskLocal=true;
        }
        throw error;
      }
      if (['stopped_by_user', 'stopped'].includes(result?.result)) { if (job) job.uncertain = false;throw Object.assign(new Error('게임에서 작업이 중단됐어요.'),{code:'action_interrupted',body:result}); }
      // execute_altering's started response confirms registration, not a running character action.
      if (command === 'execute_crafting' && ['started', 'accepted'].includes(result?.result)) {
        for (;;) { if(this.cancelReason)await this.requestActionStop(command);if (!active(await this.read('get_activity'))) break;await this.delay(M.TIMING.observation); }
      }
      return result;
    } finally { this.activeCommand = null;this.publish(); }
  }
  async gather(name, amount, job, source = '') {
    this.check();
    const available=M.rows(await this.read('get_gatherable_items',name)).find(r=>r.DisplayName===name);
    if(!available)throw itemError(`${name}은/는 현재 채집 가능한 목록에 없어요.`,'not_found');
    if(available.ToolOk===false)throw itemError(`${name} 채집 도구가 없거나 내구도가 부족해요. 게임에서 확인해 주세요.`,'tool_missing');
    let remaining = amount, infinite = amount === 0;
    const resourcePath=this.db.gather.find(r=>r.name===name)?.path||[];
    const fishing=resourcePath.some(part=>part.includes('낚시'));
    const fish=resourcePath.some(part=>part.includes('물고기'));
    let fishingStarted=false;
    const egg=name==='달걀'||name==='황금 달걀';let roosterHits=egg&&!source?(job?.roosterHits||0):0;
    let collected=0;const baseline=!source&&job?(job.completed||0):0,goal=infinite?null:(!source&&job?job.count:amount);
    const report=(segment=0,retrying=false)=>{
      if(this.cancelReason==='user')return;
      const count=baseline+collected+segment,gathered=goal==null?count:Math.min(goal,count);
      const finished=goal!=null&&count>=goal;
      this.publish({type:finished?'stop-wait':source?'shortage':'gather',stopReason:finished?'quantity':undefined,item:name,source,fishing,fish,fishingStarted,gathered,gatherTarget:goal,remaining:goal==null?null:Math.max(0,goal-gathered),retrying,...(egg?{roosterHits}:{})});
    };
    while (infinite || remaining > 0) {
      this.check();if (source && job?.kind === 'cycle' && !this.cycleRegistrationOpen(job)) return;
      if (job?.cancelled) { if (source) return;throw new Error('작업을 중단했어요.'); }await this.guard();
      await this.inventory();const before = this.observedStock[name] || 0;
      const target = infinite ? Infinity : remaining, segmentStart = job?.completed || 0;let result, error, settled = false, stoppedFor = null, observed = 0;
      this.activeCommand = 'execute_gathering';report();
      const pending = this.recoverableAction('execute_gathering', { displayName: name }).then(x => { result = x;fishingStarted=x?.result==='started'; }, e => { error = e; }).finally(() => { settled = true; });
      const finishGathering=()=>this.stopGathering(()=>settled,{requireStopAck:fishing,ended:()=>settled&&(
        ['completed','stopped','stopped_by_user'].includes(result?.result)||error?.responseStatus==='rejected'||['blocked','canceled','cancelled','tool_missing','tool_broken','required_consumable_missing','overweight'].includes(error?.code)
      )});
      try {
        for (;;) {
          if (source && job?.cancelled) { await finishGathering();await pending;return; }
          if (source && job?.kind === 'cycle' && !this.cycleRegistrationOpen(job)) { await finishGathering();await pending;return; }
          try { this.check();if (job?.cancelled) throw new Error('작업을 중단했어요.'); }
          catch (e) { stoppedFor = 'stop';await finishGathering();await pending;throw e; }
          if (settled && error) throw error;
          if (settled && !['started', 'accepted'].includes(result?.result)) break;
          await this.inventory();observed = Math.max(observed, (this.observedStock[name] || 0) - before);
          if (!source && job) job.completed = infinite?segmentStart+observed:Math.min(job.count, segmentStart + observed);
          if (observed >= target) stoppedFor = 'quantity';
          try { await this.guard(); } catch (e) { stoppedFor = 'stop';await finishGathering();await pending;throw e; }
          if (!stoppedFor && !this.preparing && !this.foregroundRunning && this.managedFacilities().length && this.now() - this.lastProbe >= M.TIMING.facilities) {
            await this.readWorks();this.lastProbe = this.now();
            if (this.works.some(w => M.done(w) && this.managedFacilities().includes(w.FacilityName))) stoppedFor = 'facility';
          }
          report(observed);
          if (stoppedFor) { await finishGathering();await pending;break; }
          // 공식 CLI의 started는 목표 없이 계속되는 자동 낚시 시작 응답이다.
          // 낚시 중에도 Compass가 반환되므로 행동 상태로 종료를 판단하지 않는다.
          if (settled && result?.result !== 'started' && !active(await this.read('get_activity'))) break;
          await this.delay(M.TIMING.observation);
        }
        await pending;
        if(error && stoppedFor && ['canceled','cancelled','stopped_by_user'].includes(error.code)){result={...error.body,result:'stopped'};error=null;}
        if (error) throw error;
        if (['stopped', 'stopped_by_user'].includes(result?.result) && !stoppedFor) throw Object.assign(new Error('게임에서 채집이 중단됐어요.'),{code:'action_interrupted',body:result});
        await this.inventory();
        const gained = Math.max(observed, (this.observedStock[name] || 0) - before, Number(result?.gained) || 0);
        observed=Math.max(observed,gained);
        collected+=gained;
        if (!infinite) { remaining = Math.max(0, remaining - gained);if (!source && job) job.completed = Math.min(job.count, job.count - remaining); }
        if(infinite&&!source&&job)job.completed=segmentStart+gained;
        if (!gained && !stoppedFor) throw new Error(`${name}의 채집 수량이 늘지 않았어요.`);
        report();
      } catch (e) {
        observed=Math.max(observed,Number(e.body?.gained)||0);
        if(this.retryInterrupted(e,job)){
          // The original request has ended; retain gains once, then retry the remainder.
          await pending;await this.inventory();
          observed=Math.max(observed,(this.observedStock[name]||0)-before);
          collected+=observed;if(!infinite)remaining=Math.max(0,remaining-observed);
          if(!source&&job)job.completed=infinite?segmentStart+observed:Math.min(job.count,segmentStart+observed);
          if(infinite||remaining>0)await this.waitActionRetry(job,name);
          report();continue;
        }
        const confirmation=e.code==='blocked'&&e.body?.kind==='continuous_run_limit';
        if((e.code==='loading'||confirmation)&&!this.cancelReason&&!job?.cancelled){
          this.publish({type:confirmation?'ui-blocked':'loading',blockerKind:confirmation?'continuous_run_limit':undefined,item:name,source,fishing,fish,fishingStarted,resumeType:source?'shortage':'gather'});
          if(confirmation)await this.delay(M.TIMING.observation);
          // Do not send another paid gathering command until the previous request
          // has settled and the character is idle again after the transition.
          while(!settled||active(await this.read('get_activity'))){this.check();await this.delay(M.TIMING.observation);}
          await this.inventory();
          observed=Math.max(observed,(this.observedStock[name]||0)-before);
          collected+=observed;if(!infinite)remaining=Math.max(0,remaining-observed);
          if(!source&&job)job.completed=infinite?segmentStart+observed:Math.min(job.count,segmentStart+observed);
          report();continue;
        }
        if(egg&&e.code==='interrupted_by_attack'){roosterHits++;if(!source&&job)job.roosterHits=roosterHits;}
        if(e.code==='interrupted_by_attack'&&!this.cancelReason&&!job?.cancelled){
          for(;;){
            this.check();if(source&&job?.kind==='cycle'&&!this.cycleRegistrationOpen(job))return;
            try{await finishGathering();break;}
            catch(stopError){if(stopError.code!=='stop_not_confirmed')throw stopError;await this.guard();report(observed,true);await this.delay(M.TIMING.observation);}
          }
          await this.inventory();
          observed=Math.max(observed,(this.observedStock[name]||0)-before,Number(e.body?.gained)||0);
          collected+=observed;if(!infinite)remaining=Math.max(0,remaining-observed);
          if(!source&&job)job.completed=infinite?segmentStart+observed:Math.min(job.count,segmentStart+observed);
          report(0,infinite||remaining>0);
          if(infinite||remaining>0){await this.delay(M.TIMING.observation);this.check();}
          continue;
        }
        try { await finishGathering(); } catch(stopError){if(stopError.message!==e.message)e.message += ` · ${stopError.message}`;}
        throw e;
      } finally {
        if (!source && job) job.completed = infinite?segmentStart+Math.max(observed,Number(result?.gained)||0):Math.min(job.count, segmentStart + Math.max(observed, Number(result?.gained) || 0));
        const confirmedGathered=Math.max(observed,Number(result?.gained)||0);
        if(confirmedGathered>0)this.recordResult(name,'채집',confirmedGathered,fish?'마리':'개');
        this.activeCommand = null;
      }
      if (stoppedFor === 'facility') { await this.confirmIdle();await this.service(true); }
      this.publish();
    }
  }
  async stopGathering(settled,{ended=()=>false,requireStopAck=false}={}) {
    const previous=this.stage;let waiting=false,stopAccepted=false;
    for(let attempt=0;;attempt++){
      if(ended())return;
      let activity;try{activity=await this.transport.read('get_activity');}catch(error){this.emit('diagnostic',{event:'gather-stop-observation',code:error.code});}
      // 낚시는 Compass로 보이기도 하므로 중단 명령을 최소 한 번 보낸다.
      if(attempt>0&&activity&&!active(activity)&&settled()&&(!requireStopAck||stopAccepted)){
        if(waiting)this.emit('diagnostic',{event:'gather-stop-confirmed',activity,settled:true});return;
      }
      if(attempt>=M.TIMING.stopChecks){
        if(!waiting){waiting=true;this.emit('diagnostic',{event:'gather-stop-wait',activity,settled:settled(),item:previous.item});this.publish({...previous,type:this.cancelReason==='user'?'stopping':'stop-wait',...(this.cancelReason==='user'?{text:'중단을 요청했어요. 멈췄는지 확인하고 있어요.'}:{})});}
      }
      // Once the character is idle, wait for the original CLI response rather than
      // repeatedly issuing stop commands. Never start another action here.
      if(attempt===0||(!activity||active(activity)||requireStopAck&&!stopAccepted)&&attempt%2===0){
        stopAccepted=await this.requestActionStop('execute_gathering',this.cancelReason==='user'?'stopping':'stop-wait')||stopAccepted;
      }
      await this.delay(waiting?M.TIMING.observation:M.TIMING.response);
    }
  }
  async confirmIdle() {
    let waited=false;const previous=this.stage;
    for(;;){
      if(this.running)this.check();const activity=await this.read('get_activity');
      if(!active(activity)){if(waited)this.publish(previous);return waited;}
      if(!waited){waited=true;this.publish({type:'busy'});}
      await this.delay(M.TIMING.observation);
    }
  }
  async craft(job) {
    const recipe = M.recipeFor(job, this.db);await this.inventory();await this.fresh(recipe);
    const desired = Math.max(0, job.count - job.completed), cap = M.capacity(recipe, this.jobStock(job,recipe), this.gatherables, desired);
    if (!desired) { job.status = 'done';this.publish();return; }
    job.possible = cap.quantity;job.reduced = cap.quantity < desired;
    if (!cap.batches) { job.status = 'skipped';job.message = '직접 준비할 재료가 부족해 제작 가능 횟수가 0회예요.';this.publish();return; }
    let batches = cap.batches,ingredientRetry=false;
    while (batches > 0) {
      this.check();await this.inventory();let live = await this.fresh(recipe);
      const capNow = M.capacity(recipe, this.jobStock(job,recipe), this.gatherables, batches);
      if (!capNow.batches) { job.reduced = true;break; }
      const plan = M.needs(recipe, capNow.batches, this.jobStock(job,recipe), this.gatherables);
      for (const need of plan.filter(x => x.gatherable && x.missing)) await this.gather(need.name, need.missing, job, recipe.name);
      live = await this.fresh(recipe);
      // 창고 재료를 제외한 사전 조회가 부족으로 응답하더라도 실제 제작은
      // 창고를 사용할 수 있다. 다른 제한은 유지하고 최종 실행 응답을 따른다.
      const storageReady = live.length > 0 && live.every(x => x.Reason === 'not_enough_ingredient')
        && M.needs(recipe, capNow.batches, this.jobStock(job,recipe), this.gatherables).every(i => !i.missing);
      if (!live.some(x => x.Craftable === true) && !storageReady) throw this.unavailable(recipe,live);
      let n = capNow.batches;
      let result;
      try { result = await this.perform('execute_crafting', { displayName: recipe.name, craftCount: n }, job); }
      catch (e) {
        if(e.taskLocal&&e.code==='not_enough_ingredient'&&!ingredientRetry){
          ingredientRetry=true;await this.inventory();await this.fresh(recipe);
          const refreshed=M.capacity(recipe,this.jobStock(job,recipe),this.gatherables,(job.count-job.completed));
          if(refreshed.batches>0&&refreshed.batches<n){batches=Math.min(batches,refreshed.batches);job.reduced=true;continue;}
        }
        if (e.code !== 'invalid_count' || !(Number(e.body?.maxCount) > 0)) throw e;
        job.uncertain = false;n = Math.min(n, Number(e.body.maxCount));result = await this.perform('execute_crafting', { displayName: recipe.name, craftCount: n }, job);
      }
      this.consumeReservation(job,recipe,Number(result?.craftCount)||n);
      const crafted=Number(result?.craftCount)||n;
      job.completed = Math.min(job.count, job.completed + crafted);job.uncertain = false;batches -= crafted;
      this.recordResult(recipe.name,'제작',crafted);
      await this.inventory();this.publish();if(!this.foregroundRunning)await this.service(true);
    }
    job.status = 'done';job.message = job.reduced ? `재료에 맞춰 ${job.completed}회 제작했어요.` : '';
  }
  get tasks() { return this.immediateTask ? [...this.queue, this.immediateTask] : this.queue; }
  runImmediate(input) {
    if (this.running || this.immediateTask || this.refreshing || !this.connected) throw new Error('게임에 연결하고 기존 작업이 끝난 뒤 시작해 주세요.');
    const job = M.newTask(input, this.db);this.immediateTask = job;
    return this.run(job.id).finally(() => { this.immediateTask = null;this.publish(); });
  }
  async availableSlots(facility) {
    if (this.running || this.immediateTask || this.refreshing) throw new Error('작업을 마친 뒤 가공품을 추가해 주세요.');
    if (!this.connected || !this.db.facilities.some(f => f.name === facility)) throw new Error('게임 연결과 가공 시설을 확인해 주세요.');
    if (this.polling) await this.polling;
    await this.inventory();await this.readWorks();this.publish();return Math.max(0, M.SLOT_COUNT - this.works.filter(w => w.FacilityName === facility&&!M.done(w)).length);
  }
  async registerJob(job) {
    await this.readWorks();let slots = this.reconcile(job.facility);
    const remaining=job.pattern.slice(job.completed);
    if (remaining.length > M.SLOT_COUNT - this.works.filter(w=>w.FacilityName===job.facility&&!M.done(w)).length) throw new Error('빈 가공 슬롯이 줄었어요. 다시 선택해 주세요.');
    if(this.works.some(w=>w.FacilityName===job.facility&&M.done(w))){
      await this.collectFacility(job.facility,job);await this.readWorks();slots=this.reconcile(job.facility);
      if(remaining.length>M.SLOT_COUNT-slots.length)throw new Error('완료품 수령을 확인하지 못했어요. 시설 현황을 확인해 주세요.');
    }
    for (const id of remaining) {
      this.check();const recipe = this.db.materials.find(r => r.id === id && r.facility === job.facility);
      await this.inventory();await this.fresh(recipe);
      if (!M.capacity(recipe, this.recipeStock(recipe), this.gatherables, 1).batches) { job.reduced = true;continue; }
      for (const need of M.needs(recipe, 1, this.recipeStock(recipe), this.gatherables).filter(i => i.gatherable && i.missing)) await this.gather(need.name, need.missing, job, recipe.name);
      await this.readWorks();slots = this.reconcile(job.facility);
      if (slots.length >= M.SLOT_COUNT) throw new Error('가공 시설의 빈 슬롯이 없어요.');
      const count = slots.length;await this.perform('execute_altering', { displayName: recipe.name }, job);
      await this.verifyRegistration(job.facility,count,recipe.name);
      slots.push({ name:recipe.name, owner:null, recipeId:recipe.id });job.uncertain = false;job.completed++;this.recordResult(recipe.name,'가공 등록',1);this.publish();
    }
    job.status = job.completed ? 'done' : 'skipped';
    if (job.reduced) job.message = '보유 재료로 등록 가능한 가공품만 등록했어요.';
  }
  managedFacilities() {
    return [...new Set(this.tasks.filter(t => ['materials', 'cycle'].includes(t.kind) && t.status === 'running').flatMap(t => t.planMode?Plan.facilities(t,this.db):[t.facility || M.recipeFor(t,this.db).facility]))];
  }
  async activate({onlyCycles=false,materialId=null}={}) {
    for (const job of this.tasks.filter(t => this.eligible(t) && t.status === 'waiting' && ['materials', 'cycle'].includes(t.kind)&&(!onlyCycles||t.kind==='cycle')&&(!materialId||t.id===materialId))) {
      if(job.status!=='waiting')continue;
      try{
      const facility = job.facility || M.recipeFor(job, this.db).facility;job.facility = facility;
      if (job.kind === 'materials' && this.tasks.some(t => t.kind === 'materials' && t.status === 'running' && t.facility === facility)) continue;
      if(job.planMode){for(const f of Plan.facilities(job,this.db))this.reconcile(f);}else this.reconcile(facility);job.status = 'running';this.sessionIds?.add(job.id);job.registered ||= 0;job.nextIndex ||= 0;
      if (job.kind === 'cycle') {
        job.cycleLimitMs = this.preferences.cycleTimeEnabled ? this.preferences.cycleMinutes * 60000 : null;
        if(job.planMode)job.productRegistered||={};job.cycleClockStart = this.now();job.registrationStopped = false;job.shortageStopped = false;this.cycleRegistrationOpen(job);
      }
      if (job.kind === 'materials') {
        if (job.completed >= job.count) { job.status = 'done';this.publish();continue; }
        const r = M.recipeFor(job, this.db);await this.inventory();await this.fresh(r);
        const cap = M.capacity(r, this.jobStock(job,r), this.gatherables, Math.max(0, job.count - job.registered));
        job.limitBatches = job.registered + cap.batches;job.reduced = job.limitBatches < job.count;
        if (!cap.batches && job.registered <= job.completed) { job.status = 'skipped';job.message = '직접 준비할 재료가 부족해 생산 가능량이 0회예요.'; }
      }
      this.publish();
      }catch(error){if(!this.handleTaskError(job,error))throw error;}
    }
  }
  registrationPlanned(job){
    if(!job||job.cancelled)return false;
    if(job.kind==='collect')return !!job.reregister;
    if(job.kind==='register')return job.completed<job.count;
    if(job.kind==='materials')return job.registered<(job.limitBatches??job.count);
    if(job.kind==='cycle')return !job.registrationStopped&&!job.shortageStopped&&(!job.repeatCount||job.nextIndex<job.repeatCount*job.pattern.length);
    return false;
  }
  async collectFacility(facility, job = null) {
    if(this.now()<(this.collectionRetryAt?.[facility]||0))return [];
    const before = this.works.filter(w => w.FacilityName === facility), first = before.find(M.done);if (!first) return [];
    const ledger = this.reconcile(facility);let ready = ledger.filter((_, i) => M.done(before[i]));
    let result;
    try{result=await this.perform('complete_altering_work', { displayName: first.DisplayName }, job,{facility,reregister:this.registrationPlanned(job)});}
    catch(error){
      const notReady=['no_completed_work_at_facility','no_completed_work','not_completed_yet','no_altering'].includes(error.code);
      if((error.code!=='timeout'&&!notReady)||this.cancelReason)throw error;
      result={error:error.code,message:error.message,notReady};
    }
    let expected,after,confirmed=false;
    // A successful collection can include work that completed during travel.
    // collected is diagnostic data, not necessarily a number of facility slots.
    const acknowledged=result?.collected!=null||result?.result==='completed';
    for(let attempt=0;attempt<3;attempt++){
      await this.readWorks();after=this.works.filter(w=>w.FacilityName===facility);
      if(result?.notReady&&after.length===ledger.length&&after.every((w,i)=>w.DisplayName===ledger[i].name)){
        if(job)job.uncertain=false;
        (this.collectionRetryAt||={})[facility]=this.now()+M.TIMING.facilities;
        this.emit('diagnostic',{event:'collection-deferred',facility,response:result,before,after});
        this.publish();return [];
      }
      const removed=before.length-after.length;
      const prefix=removed>=ready.length&&removed>0&&after.every((w,i)=>w.DisplayName===ledger[removed+i]?.name);
      const initialReadyRemoved=before.every((w,i)=>!M.done(w)||i<removed);
      const ordinary=ledger.filter((_,i)=>!M.done(before[i]));
      if(prefix&&initialReadyRemoved&&acknowledged){ready=ledger.slice(0,removed);expected=ledger.slice(removed);confirmed=true;}
      else if(!result?.notReady&&after.length===ordinary.length&&after.every((w,i)=>w.DisplayName===ordinary[i].name)){expected=ordinary;confirmed=true;}
      this.emit('diagnostic',{event:'collection-check',facility,attempt:attempt+1,response:result,before,after,confirmed});
      if(confirmed)break;
      if(attempt<2){this.check();await this.delay(M.TIMING.observation);}
    }
    if(!confirmed){
      const message='수령 결과를 확인하지 못해 이 시설만 보류했어요. 다른 작업은 계속 진행해요.';
      for(const task of this.tasks.filter(t=>(t.facility||(['materials'].includes(t.kind)?M.recipeFor(t,this.db)?.facility:null))===facility&&['waiting','running'].includes(t.status))){
        task.status='held';task.uncertain=true;task.blocked=true;task.message=message;task.skipReason=message;
        if(task.kind==='cycle')this.pauseCycle(task);
        if(this.reservations)delete this.reservations[task.id];
      }
      if(job){job.status='held';job.uncertain=true;job.blocked=true;job.message=message;job.skipReason=message;}
      this.publish();return null;
    }
    for (const slot of ready) {
      this.recordResult(slot.name,'가공 수령',1);
      const owner = this.tasks.find(t => t.id === slot.owner);if (owner) {
        owner.completed++;
        if (owner.kind === 'cycle') { owner.productCompleted ||= {};owner.productCompleted[slot.recipeId] = (owner.productCompleted[slot.recipeId] || 0) + 1; }
      }
    }
    this.ledger[facility] = expected;if (job) job.uncertain = false;await this.inventory();this.publish();return ready;
  }
  async service(force = false,{collect=true,registerMaterials=true,registerSets=true,materialId=null,holdDeferred=false}={}) {
    if (this.servicing || !this.managedFacilities().length || (!force && this.now() - this.lastProbe < M.TIMING.facilities)) return;
    this.servicing = true;this.lastProbe = this.now();this.requests = [];
    try {
      await this.readWorks();await this.inventory();
      await this.servicePlans({collect,registerSets});
      for (const facility of this.managedFacilities()) {
        this.check();let slots;
        try{slots=this.reconcile(facility);}catch(error){if(!error.facility)throw error;this.holdFacility(facility,error.message);continue;}
        let jobs = this.tasks.filter(t => !t.planMode && t.facility === facility && t.status === 'running');
        for (const job of jobs.filter(j => j.cancelled)) { if (job.kind === 'cycle') this.pauseCycle(job);job.status = 'stopped';job.message = '추가 등록을 중단했어요. 시설에 등록된 가공은 계속 진행돼요.';for (const slot of slots) if (slot.owner === job.id) slot.owner = null; }
        jobs = jobs.filter(j => !j.cancelled);
        for (const job of jobs.filter(j => j.kind === 'cycle')) this.cycleRegistrationOpen(job);
        if (!jobs.length) continue;
        for(const job of jobs.filter(j=>j.kind==='materials'))this.finishRegistration(job);jobs=jobs.filter(j=>j.status==='running');if(!jobs.length)continue;
        if (collect&&this.works.some(w => w.FacilityName === facility && M.done(w))){const collected=await this.collectFacility(facility, jobs.find(t => t.kind === 'materials') || jobs[0]);if(collected===null)continue;}
        slots = this.ledger[facility];
        for (const job of jobs.filter(t => t.kind === 'materials')) if (job.completed >= job.limitBatches && !slots.some(s => s.owner === job.id)) { job.status = 'done';job.message = job.reduced ? `재료에 맞춰 ${job.completed}회 가공했어요.` : ''; }
        const finite = registerMaterials?jobs.find(t => t.kind === 'materials' && t.status === 'running'&&(!materialId||t.id===materialId)):null, cycle = jobs.find(t => t.kind === 'cycle' && t.status === 'running');
        const reserveDeferred=holdDeferred&&this.tasks.some(t=>this.eligible(t)&&t.kind==='materials'&&t.deferred&&['waiting','running'].includes(t.status)&&(t.facility||M.recipeFor(t,this.db).facility)===facility&&(t.registered||0)<(t.limitBatches??t.count));
        while (slots.length < M.SLOT_COUNT) {
          let job, recipe;
          if (this.priming&&cycle&&this.cycleRegistrationOpen(cycle)) {job=cycle;recipe=this.db.materials.find(r=>r.id===cycle.pattern[cycle.nextIndex%cycle.pattern.length]);}
          else if (finite && finite.registered < finite.limitBatches) { job = finite;recipe = M.recipeFor(job, this.db); }
          else if (registerSets&&!reserveDeferred&&cycle && this.cycleRegistrationOpen(cycle)) { job = cycle;recipe = this.db.materials.find(r => r.id === cycle.pattern[cycle.nextIndex % cycle.pattern.length]); }
          else break;
          try{
          if (job.cancelled) { if (job.kind === 'cycle') this.pauseCycle(job);job.status = 'stopped';for (const slot of slots) if (slot.owner === job.id) slot.owner = null;break; }
          await this.fresh(recipe);const stock = this.jobStock(job,recipe), cap = M.capacity(recipe, stock, this.gatherables, 1);
          if (!cap.batches) {
            job.blocked = true;job.message = '직접 준비할 재료가 부족해요.';
            if (job.kind === 'materials') { job.limitBatches = job.registered;job.reduced = true;if (job.completed === job.registered) job.status = job.completed ? 'done' : 'skipped'; }
            else this.stopCycleForShortage(job);
            break;
          }
          let missing = M.needs(recipe, 1, stock, this.gatherables).find(i => i.gatherable && i.missing);
          if(this.priming&&missing)break;
          if(job.kind==='cycle') {
            if(missing && !job.refill) {
              const requested=job.gatherBatches ?? 10;
              if(!requested){this.stopCycleForShortage(job);break;}
              const wanted=Math.min(requested,this.cycleRecipeRemaining(job,recipe.id));
              job.refill={recipeId:recipe.id,batches:M.capacity(recipe,stock,this.gatherables,wanted).batches};
              this.reserveRecipe(job,recipe,job.refill.batches);
            }
            if(job.refill) {
              const batches=M.capacity(recipe,stock,this.gatherables,job.refill.batches).batches;
              missing=M.needs(recipe,batches,stock,this.gatherables).find(i=>i.gatherable&&i.missing);
              if(!missing)delete job.refill;
            }
          }
          if (missing) { this.requests.push({ name: missing.name, amount: missing.missing, job, source: recipe.name });break; }
          job.blocked = false;
          const observed = this.live.materials.filter(x => x.DisplayName === recipe.name);
          if (!observed.some(x => x.Alterable === true)) {
            if(observed.some(x=>x.Reason==='queue_full')){await this.readWorks();this.reconcile(facility);break;}
            throw this.unavailable(recipe,observed);
          }
          const result = await this.perform('execute_altering', { displayName: recipe.name }, job);
          if (result?.skippedByLimit) break;
          await this.verifyRegistration(facility,slots.length,recipe.name);
          slots.push({ name: recipe.name, owner: job.id, recipeId: recipe.id });
          this.consumeReservation(job,recipe,1);
          if (job.kind === 'materials'){job.registered++;this.recordResult(recipe.name,'가공 등록',1);}else job.nextIndex++;
          job.uncertain = false;
          await this.inventory();this.publish();
          }catch(error){if(!this.handleTaskError(job,error))throw error;break;}
        }
        if(finite?.status==='running')this.finishRegistration(finite);
        if (cycle?.status === 'running' && !this.cycleRegistrationOpen(cycle) && !slots.some(slot => slot.owner === cycle.id)) {
          cycle.status = cycle.shortageStopped ? 'skipped' : 'done';cycle.message = cycle.shortageStopped ? '재료 부족으로 추가 등록을 멈추고 등록된 가공품은 모두 수령했어요.' : `${cycle.limitReason}까지 실행하고 등록한 가공품을 모두 수령했어요.`;this.pauseCycle(cycle);
        }
      }
    } finally { this.servicing = false;this.publish(); }
  }
  async gatherRequest(request){
    this.foregroundRunning=true;
    try{for(const need of request.needs||[{name:request.name,amount:request.amount}]){this.check();await this.gather(need.name,need.amount,request.job,request.source);}}
    finally{this.foregroundRunning=false;}
  }
  async servicePlans({collect=true,registerSets=true}={}){
    const jobs=this.tasks.filter(t=>t.planMode&&this.eligible(t)&&t.status==='running');
    // Harvest all eligible finished goods before deciding what can be registered.
    for(const job of jobs){
      if(this.finishRegistration(job))continue;
      if(!this.cycleRegistrationOpen(job)&&!Object.values(this.ledger).flat().some(s=>s.owner===job.id)){job.status=job.shortageStopped?'skipped':'done';this.pauseCycle(job);continue;}
      if(collect)for(const f of Plan.facilities(job,this.db)){
        try{this.reconcile(f);if(this.works.some(w=>w.FacilityName===f&&M.done(w)))await this.collectFacility(f,job);}
        catch(error){if(!this.handleTaskError(job,error))throw error;}
      }
    }
    if(!registerSets)return;
    for(const job of jobs.filter(j=>j.status==='running')){
      let needsFacility=null,workingFacility=null;
      while(this.cycleRegistrationOpen(job)){
        this.check();const candidates=Plan.order(Plan.candidates(job,this.db),this.stock,this.gatherables,this.db,this.preferences.strictOrder);
        if(!candidates.length)break;
        const open=candidates.filter(r=>(this.ledger[r.facility]||[]).length<M.SLOT_COUNT);
        const planStock=r=>this.priming?this.recipeStock(r):this.jobStock(job,r);
        const ready=r=>r.ingredients.every(i=>(planStock(r)[i.name]||0)>=i.required);
        let recipe=this.preferences.strictOrder?candidates[0]:open.find(r=>r.facility===workingFacility&&ready(r))||open.find(ready);
        if(recipe&&(this.ledger[recipe.facility]||[]).length>=M.SLOT_COUNT)break;
        if(!recipe){needsFacility=open.find(r=>!this.warmingFacilities?.has(r.facility))?.facility;break;}
        await this.fresh(recipe);const stock=planStock(recipe),cap=M.capacity(recipe,stock,this.gatherables,1);
        if(!cap.batches){this.stopCycleForShortage(job);break;}
        if(M.needs(recipe,1,stock,this.gatherables).some(i=>i.missing)){needsFacility=recipe.facility;break;}
        const observed=this.live.materials.filter(x=>x.DisplayName===recipe.name);
        if(!observed.some(x=>x.Alterable)){
          if(observed.some(x=>x.Reason==='queue_full'))break;
          const error=this.unavailable(recipe,observed);if(this.handleTaskError(job,error))break;throw error;
        }
        workingFacility=recipe.facility;const slots=this.ledger[recipe.facility],count=slots.length;
        await this.perform('execute_altering',{displayName:recipe.name},job);
        await this.verifyRegistration(recipe.facility,count,recipe.name);
        slots.push({name:recipe.name,owner:job.id,recipeId:recipe.id});
        job.productRegistered[recipe.id]=(job.productRegistered[recipe.id]||0)+1;job.nextIndex++;this.recordResult(recipe.name,'가공 등록',1);
        this.consumeReservation(job,recipe,1);job.uncertain=false;await this.inventory();this.publish();
      }
      if(needsFacility&&!this.priming&&this.cycleRegistrationOpen(job)){
        const pool=this.jobStock(job,{kind:'materials',name:'',ingredients:[]}),needs={};let blocked=false;
        for(const {recipe,batches:wanted} of Plan.window(job,needsFacility,this.preferences.processingRefillRounds,this.db)){
          const batches=M.capacity(recipe,pool,this.gatherables,wanted).batches;
          if(!batches){blocked=true;continue;}
          this.reserveRecipe(job,recipe,batches);
          for(const i of recipe.ingredients){const amount=i.required*batches,owned=pool[i.name]||0;if(this.gatherables.has(i.name))needs[i.name]=(needs[i.name]||0)+Math.max(0,amount-owned);pool[i.name]=Math.max(0,owned-amount);}
        }
        const missing=Object.entries(needs).map(([name,amount])=>({name,amount})).filter(i=>i.amount>0);
        if(missing.length)this.requests.push({job,source:needsFacility,needs:missing});
        else if(blocked)this.stopCycleForShortage(job);
      }
      if(this.finishRegistration(job))continue;
      if(!this.cycleRegistrationOpen(job)&&!Object.values(this.ledger).flat().some(s=>s.owner===job.id)){
        job.status=job.shortageStopped?'skipped':'done';this.pauseCycle(job);
      }
    }
  }
  async warmPlans(){
    if(!this.tasks.some(t=>t.planMode&&t.status==='running'))return;
    this.reservations={};this.warmingFacilities=new Set();
    try{for(;;){
      await this.service(true,{registerMaterials:false});
      const request=this.requests.find(r=>r.job?.planMode&&!this.warmingFacilities.has(r.source));
      if(!request)break;this.warmingFacilities.add(request.source);await this.gatherRequest(request);
    }}finally{this.warmingFacilities=null;this.requests=[];}
  }
  async runStrictQueue(){
    const previous=this.onlyId;
    try{while(this.tasks.some(t=>t.status==='waiting'||t.status==='running')){
      this.check();const job=this.tasks.find(t=>['waiting','running'].includes(t.status));this.onlyId=job.id;
      this.plannedIds=new Set([job.id]);await this.prepareMaterials();await this.activate();await this.service(true);
      if(job.status==='waiting'){
        this.activeJob=job;this.sessionIds.add(job.id);job.status='running';this.publish(this.preparationStage(job));
        try{if(job.kind==='gather'){await this.gather(job.name,job.count===0?0:Math.max(0,job.count-job.completed),job);job.status='done';}
        if(job.kind==='craft')await this.craft(job);if(job.kind==='collect')await this.collectJob(job);if(job.kind==='register')await this.registerJob(job);}
        catch(error){if(!this.handleTaskError(job,error))throw error;}finally{this.activeJob=null;}
      }
      const request=this.requests.shift();if(request){await this.gatherRequest(request);continue;}
      if(['waiting','running'].includes(job.status)){this.publish({type:'waiting',details:this.waitingDetails()});await this.delay(M.TIMING.facilities);}
    }}finally{this.onlyId=previous;}
  }
  async collectJob(job) {
    await this.readWorks();const facilities = job.facility ? [job.facility] : [...new Set(this.works.map(w => w.FacilityName))];
    for (const facility of facilities) {
      this.reconcile(facility);const ready = await this.collectFacility(facility, job);if(ready===null)return;
      if (job.reregister) for (const slot of ready) {
        const recipe = this.db.materials.find(r => r.id === slot.recipeId) || this.db.materials.find(r => r.name === slot.name && r.facility === facility);
        if (!recipe) throw new Error('재등록할 가공품을 DB에서 찾지 못했어요.');
        await this.fresh(recipe);const cap = M.capacity(recipe, this.recipeStock(recipe), this.gatherables, 1);
        if (!cap.batches) { job.reduced = true;continue; }
        for (const i of M.needs(recipe, 1, this.recipeStock(recipe), this.gatherables).filter(i => i.gatherable && i.missing)) await this.gather(i.name, i.missing, job, recipe.name);
        const count = this.ledger[facility].length;
        await this.perform('execute_altering', { displayName: recipe.name }, job);
        await this.verifyRegistration(facility,count,recipe.name);
        this.ledger[facility].push({ name: recipe.name, owner: null, recipeId: recipe.id });job.uncertain = false;this.recordResult(recipe.name,'가공 등록',1);
      }
    }
    job.status = 'done';this.publish();
  }
  eligible(task) { return task.status!=='held'&&(!this.onlyId || task.id === this.onlyId); }
  waitingDetails(){
    const ids=new Set(this.tasks.map(t=>t.id));
    return this.tasks.filter(t=>t.status==='running').map(t=>({
      name:t.name||t.facility,completed:t.completed,target:t.kind==='materials'?t.limitBatches:t.repeatCount?t.repeatCount*t.pattern.length:null,
      registered:t.kind==='materials'?t.registered:t.kind==='cycle'?t.nextIndex:null,blocked:t.blocked,
      existingWorks:(t.planMode?Plan.facilities(t,this.db):[t.facility]).flatMap(f=>this.ledger[f]||[]).filter(slot=>!ids.has(slot.owner)).length
    }));
  }
  async primeFacilities(){
    await this.prepareMaterials({gather:false});
    this.priming=true;
    try{
      await this.activate({onlyCycles:true});
      await this.activate();
      await this.service(true);
    }finally{this.priming=false;this.requests=[];}
  }
  async runQueueFlow(){
    while(this.tasks.some(t=>this.eligible(t)&&['waiting','running'].includes(t.status))){
      this.check();
      if(this.tasks.some(t=>this.eligible(t)&&t.status==='waiting'&&!this.plannedIds.has(t.id))){await this.prepareMaterials();await this.activate({onlyCycles:true});}
      const ordinary=this.tasks.filter(t=>this.eligible(t)&&t.kind!=='cycle'&&['waiting','running'].includes(t.status));
      for(const job of ordinary){
        this.check();if(!this.tasks.includes(job)||!['waiting','running'].includes(job.status))continue;
        if(job.kind==='materials'){
          if(job.status==='waiting')await this.activate({materialId:job.id});
          if(job.status==='running')await this.service(true,{collect:false,registerSets:false,materialId:job.id});
          job.deferred=['waiting','running'].includes(job.status);
          if(job.deferred){job.message=job.registered>job.completed?'가공 완료를 기다리는 동안 다음 작업을 진행해요.':'빈 슬롯을 기다리는 동안 다음 작업을 진행해요.';this.publish();continue;}
        }else if(job.status==='waiting'){
          this.activeJob=job;this.foregroundRunning=true;this.sessionIds.add(job.id);job.status='running';this.publish(this.preparationStage(job));
          try{
            if(job.kind==='gather'){if(job.count===0||job.completed<job.count)await this.gather(job.name,job.count===0?0:job.count-job.completed,job);job.status='done';}
            if(job.kind==='craft')await this.craft(job);
            if(job.kind==='collect')await this.collectJob(job);
            if(job.kind==='register')await this.registerJob(job);
          }catch(error){if(!this.handleTaskError(job,error))throw error;}
          finally{this.foregroundRunning=false;this.activeJob=null;}
        }
        await this.service(true,{registerMaterials:false,holdDeferred:true});
      }
      // End of this pass: deferred work gets a registration opportunity before 반복 가공 refills.
      await this.service(true);
      const request=this.requests.shift();
      if(request){await this.gatherRequest(request);continue;}
      if(!this.tasks.some(t=>this.eligible(t)&&['waiting','running'].includes(t.status)))break;
      const details=this.waitingDetails();
      this.publish({type:details.some(t=>t.blocked)?'shortage-wait':'waiting',details});await this.delay(M.TIMING.facilities);
    }
  }
  async run(onlyId = null) {
    if (this.polling) await this.polling;
    if (this.running || this.refreshing || (this.immediateTask && onlyId !== this.immediateTask.id)) throw new Error('이미 작업 중이에요.');
    if (!this.connected) throw new Error('게임에 연결해 주세요.');
    if (!this.tasks.some(t => t.status === 'waiting')) throw new Error('대기 중인 작업이 없어요.');
    this.onlyId = onlyId;this.sessionIds = new Set();this.results=[];this.running = true;this.cancelReason = null;this.terminal = null;this.reservations={};this.plannedIds=null;
    this.publish(this.preparationStage());
    let failure;
    try {
      await this.confirmIdle();await this.inventory();await this.readWorks();
      for(const job of this.tasks)if(job.kind==='cycle'&&job.repeatCount&&job.initialWings==null)job.initialWings=M.estimate(job,this.stock,this.gatherables,this.db);
      if(!this.immediateTask){if(this.preferences.strictOrder)await this.runStrictQueue();else{await this.primeFacilities();await this.warmPlans();await this.prepareMaterials();await this.runQueueFlow();}}
      while (this.immediateTask&&this.tasks.some(t => this.eligible(t) && ['waiting', 'running'].includes(t.status))) {
        this.check();await this.activate();await this.service(true);
        const job = this.tasks.find(t => this.eligible(t) && t.status === 'waiting' && !['materials', 'cycle'].includes(t.kind));
        if (job) {
          this.activeJob = job;this.sessionIds.add(job.id);job.status = 'running';this.publish(this.preparationStage(job));
          try{
          if (job.kind === 'gather') { if (job.count === 0 || job.completed < job.count) await this.gather(job.name, job.count === 0 ? 0 : job.count - job.completed, job);job.status = 'done'; }
          if (job.kind === 'craft') await this.craft(job);
          if (job.kind === 'collect') await this.collectJob(job);
          if (job.kind === 'register') await this.registerJob(job);
          }catch(error){if(!this.handleTaskError(job,error))throw error;}
          this.activeJob = null;this.publish();continue;
        }
        const request = this.requests.shift();
        if (request) { await this.gatherRequest(request);continue; }
        if (!this.tasks.some(t => this.eligible(t) && ['waiting', 'running'].includes(t.status))) break;
        const details = this.waitingDetails();
        this.publish({ type: details.some(t => t.blocked) ? 'shortage-wait' : 'waiting', details });await this.delay(M.TIMING.facilities);
      }
    } catch (e) {
      failure = e;for (const job of this.tasks.filter(t => t.status === 'running')) { job.status = 'stopped';job.message = e.message; }
    } finally {
      for (const job of this.tasks.filter(t => t.kind === 'cycle')) this.pauseCycle(job);
      this.activeJob = null;this.running = false;
      this.foregroundRunning=false;
      this.reservations={};this.plannedIds=null;
      const cancelledTask = this.tasks.some(t => this.sessionIds.has(t.id) && t.cancelled && t.status === 'stopped');
      const held=this.tasks.filter(t=>t.status==='held').length;
      const type = failure ? failure.manual || this.cancelReason === 'user' ? 'stopped' : 'error' : cancelledTask ? 'stopped' : 'done';
      this.terminal = { type, errorCode:failure?.code, errorCommand:failure?.command, errorKind:failure?.body?.kind, errorOriginalMessage:failure?.body?.message, errorResponseStatus:failure?.responseStatus, text: failure?.message || (cancelledTask ? '요청하신 반복 작업을 멈췄어요.' : this.immediateTask ? '요청하신 작업을 마쳤어요.' : held?`확인이 필요한 시설 ${held}개 작업을 보류하고 나머지 작업을 마쳤어요.`:'대기줄의 작업을 모두 마쳤어요.'), held, total: this.sessionIds.size, completed: this.tasks.filter(t => this.sessionIds.has(t.id) && t.status === 'done').length, skipped: this.tasks.filter(t => this.sessionIds.has(t.id) && t.status === 'skipped').length };
      this.terminal.results=structuredClone(this.results||[]);
      this.terminal.notices=this.tasks.filter(t=>this.sessionIds.has(t.id)&&(['skipped','held'].includes(t.status)||t.reduced&&t.message)).map(t=>({name:t.name||t.facility||'가공 작업',status:t.status,reason:t.skipReason||t.message||'작업 조건을 확인해 주세요.'}));
      const sessionSlots=Object.values(this.ledger).flat().filter(slot=>this.sessionIds.has(slot.owner));
      const registeredNames=new Set([...sessionSlots.map(slot=>slot.name),...this.terminal.results.filter(r=>r.kind==='가공 등록').map(r=>r.name)]);
      this.terminal.processingContinues=this.works.some(work=>registeredNames.has(work.DisplayName)&&!M.done(work));
      this.publish(this.terminal);await this.balance();this.emit('finished', this.terminal);
    }
    return this.snapshot();
  }
  recordResult(name,kind,count,unit){
    this.results||=[];const row=this.results.find(r=>r.name===name&&r.kind===kind);
    if(row)row.count+=count;else this.results.push({name,kind,count,...(unit?{unit}:{})});
  }
}
module.exports = { Engine, active };
