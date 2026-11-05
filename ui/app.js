'use strict';
const $ = id => document.getElementById(id), api = (name, ...args) => window.mobi.call(name, ...args);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('ko-KR');
const labels = { gather: '자원 채집', materials: '자원 가공', craft: '아이템 제작', cycle: '가공 SET', collect: '수령' };
const gatherOrder = ['일상 채집', '나무 베기', '광석 캐기', '약초 채집', '양털 깎기', '추수', '호미질', '곤충 채집', '낚시 - 물고기', '낚시 - 기타'];
const materialOrder = ['금속 가공', '목재 가공', '가죽 가공', '옷감 가공', '약품 가공', '식재료 가공'];
const craftOrder = ['무기', '방어구', '장신구', '도구', '퀵슬롯', '펫 장비', '재료', '캠프파이어', '염색약', '아이템-기타', '음식', '데코'];
const markupCache = new WeakMap();
function setMarkup(element, markup) { if (markupCache.get(element) !== markup) { element.innerHTML = markup;markupCache.set(element, markup); } }
function setText(element, text) { text = String(text);if (element.textContent !== text) element.textContent = text; }
let state, db, cliPath = '', tab = 'gather', selected = null, quantity = 100, favoriteOnly = false, listSignature = '', detailSignature = '', byId = new Map();
function setCatalog(value) { db = value;byId = new Map([...db.gather, ...db.crafts, ...db.materials].map(r => [r.id, r])); }
let dragId = null, presetDrag = null, presetDraft = null, activePreset = null, pickerSelection = [], pickerMode = 'plan', pickerSlots = 0, slotSelection = [];
const expanded = new Set(), sets = new Map(), repeatCounts = new Map(), gatherBatchCounts = new Map();
let materialView = null;
let facilityPlan=[], immediateRepeats=1, queueRepeats=1;
const tabSelections=new Map();
let presetBaseline = null, settingsBaseline = null, pickerBaseline = [], pickerFacility = '', decision = null, navigating = false;
function presetValue(draft) {
  if (!draft) return null;
  return { name:draft.name, tasks:draft.tasks.map(t => {
    const value = {kind:t.kind};
    for (const key of ['name','recipeId','count','facility','pattern','fromCurrent','reregister','repeatCount','gatherBatches','planMode']) if (t[key] !== undefined) value[key]=t[key];
    return value;
  }) };
}
function presetDirty() { return JSON.stringify(presetValue(presetDraft)) !== JSON.stringify(presetValue(presetBaseline)); }
function settingsValue() { return { cliPath:$('cli-path').value,processingRefillRounds:$('processing-refill').value,strictOrder:$('strict-order').checked, bagCheck:$('bag-check').checked, limit:$('bag-limit').value, fantasyMembership:$('fantasy-membership').checked, retryInterrupted:$('retry-interrupted').checked, cycleTimeEnabled:$('cycle-time-enabled').checked, cycleMinutes:$('cycle-minutes').value, agentCharacter:$('agent-character').value, agentSeparate:$('agent-separate').checked, agentOnTop:$('agent-on-top').checked }; }
function settingsDirty() { return $('settings').open && JSON.stringify(settingsValue()) !== JSON.stringify(settingsBaseline); }
function pickerDirty() { return $('picker').open && pickerMode === 'set' && JSON.stringify([...pickerSelection]) !== JSON.stringify(pickerBaseline); }
function updateSaveButtons() {
  if ($('preset-save')) $('preset-save').disabled = !presetDirty();
  $('apply-settings').disabled = !settingsDirty();
  if ($('picker').open && pickerMode === 'set') $('picker-apply').disabled = !pickerDirty();
}
function askUnsaved(subject) {
  if (decision) return decision;
  setText($('unsaved-message'), `${subject} 변경사항을 저장할까요?`);
  decision = new Promise(resolve => {
    const finish = answer => { $('unsaved').close();decision=null;resolve(answer); };
    $('unsaved-save').onclick=()=>finish('save');$('unsaved-discard').onclick=()=>finish('discard');$('unsaved-stay').onclick=()=>finish('stay');
    $('unsaved').oncancel=e=>{e.preventDefault();finish('stay');};
  });$('unsaved').showModal();return decision;
}
async function guardEdit(dirty, save, discard, subject) {
  if (!dirty()) return true;
  const answer=await askUnsaved(subject);if(answer==='stay')return false;
  if(answer==='discard'){discard();return true;}
  try { await save();return true; } catch(error){toast(error);return false;}
}
function restorePreset() { presetDraft=presetBaseline ? structuredClone(presetBaseline) : null;detailSignature=''; }
async function guardPreset() { return guardEdit(presetDirty,savePreset,restorePreset,'프리셋'); }
async function savePreset() {
  const invalid=[...document.querySelectorAll('[data-preset-amount]')].find(e=>!e.checkValidity());
  if(invalid){invalid.reportValidity();throw new Error('수량은 허용 범위의 정수로 입력해 주세요.');}
  if($('preset-name'))presetDraft.name=$('preset-name').value;
  const saved=await api('save-preset',{...presetDraft,id:activePreset});activePreset=saved.id;selected=saved.id;presetDraft=structuredClone(saved);presetBaseline=structuredClone(saved);
  listSignature='';detailSignature='';render();
}
async function saveSettings() {
  const value=settingsValue();await api('settings',{...value,processingRefillRounds:Number(value.processingRefillRounds),limit:Number(value.limit),cycleMinutes:Number(value.cycleMinutes)});
  cliPath=value.cliPath;settingsBaseline=value;$('settings').close();updateSaveButtons();
}
function commitPicker() { sets.set(pickerFacility,[...pickerSelection]);pickerBaseline=[...pickerSelection];$('picker').close();detailSignature='';renderDetail(); }
async function closeSettings() { if(await guardEdit(settingsDirty,saveSettings,()=>{},'설정'))$('settings').close(); }
async function closePicker() { if(await guardEdit(pickerDirty,commitPicker,()=>{pickerSelection=[...pickerBaseline];},'가공 SET'))$('picker').close(); }
async function guardedNavigate(action) {
  if(navigating)return;navigating=true;
  try{if(await guardPreset())await action();}finally{navigating=false;}
}
function detailAlternatives(r) { return (r.kind === 'craft' ? db.crafts : [...db.materials, ...(db.materialReferences || [])]).filter(x => x.name === r.name); }
function displayedRecipe(r) { return r.kind === 'materials' ? detailAlternatives(r).find(x => x.id === materialView) || r : r; }
function recipeHelp(r, alternatives) {
  return `<div class="recipe-toolbar"><div class="variant-tabs" role="tablist" aria-label="재료표">${alternatives.map((v, i) => `<button role="tab" aria-selected="${v.id === displayedRecipe(r).id}" data-variant="${v.id}" class="${v.id === displayedRecipe(r).id ? 'active' : ''}">재료표 ${i + 1}</button>`).join('')}</div><button id="recipe-help" class="recipe-help" aria-label="중복 레시피 안내" aria-expanded="false" aria-controls="recipe-help-popover">?</button></div><div id="recipe-help-popover" class="recipe-help-popover" popover="auto" role="note">같은 이름의 레시피가 ${alternatives.length}개 있어요. 게임은 ${r.kind === 'materials' ? '가공' : '제작'} 가능한 레시피 중 목록에서 가장 앞선 것을 사용해요. 앞 레시피로 ${r.kind === 'materials' ? '가공' : '제작'}할 수 없으면 다음 것을 사용하며, 재료표 탭은 실제 실행 레시피를 지정하지 않아요.${r.kind === 'materials' ? '<br><br>선택한 재료표로 재료를 수급해요. 진행률의 시간 계산은 짧은 시간 레시피를 기준으로 유지해요.' : ''}</div>`;
}
function bindRecipeHelp() { bindHelpPopover($('recipe-help'),$('recipe-help-popover')); }
function bindHelpPopover(button,bubble) {
  if (!button) return;
  button.onclick = () => {
    bubble.togglePopover();const open = bubble.matches(':popover-open');button.setAttribute('aria-expanded', String(open));if (!open) return;
    const rect = button.getBoundingClientRect();bubble.style.left = `${Math.max(12, Math.min(innerWidth - bubble.offsetWidth - 12, rect.right - bubble.offsetWidth))}px`;
    bubble.style.top = `${Math.max(12, rect.bottom + bubble.offsetHeight + 9 <= innerHeight - 12 ? rect.bottom + 9 : rect.top - bubble.offsetHeight - 9)}px`;
  };
  bubble.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(bubble.matches(':popover-open'))));
}
function toast(error) { $('status').textContent = error?.message || String(error); }
async function perform(fn) { try { return await fn(); } catch (e) { toast(e);return null; } }
function favoriteKey(r) { return r.kind + ':' + (r.kind === 'materials' ? r.id : r.name); }
function groupedProducts(pattern){
  const groups=new Map();for(const id of pattern)groups.set(id,(groups.get(id)||0)+1);
  return [...groups].map(([id,count])=>({id,count,recipe:db.materials.find(r=>r.id===id)})).filter(g=>g.recipe);
}
function addSetProduct(id){const at=pickerSelection.lastIndexOf(id);pickerSelection.splice(at<0?pickerSelection.length:at+1,0,id);}
function removeSetProduct(pattern,id){const at=pattern.lastIndexOf(id);if(at>=0)pattern.splice(at,1);}
function multiplier(count){return count>1?`<span class="set-multiplier">×${count}</span>`:'';}
function unique(list) { const seen = new Set();return list.filter(r => !seen.has(r.name) && seen.add(r.name)); }
function catalog() {
  if (tab === 'gather') return db.gather;
  if (tab === 'materials') return unique(db.materials);
  if (tab === 'craft') return unique(db.crafts);
  if (tab === 'favorites') return state.preferences.favorites.map(key => [...db.gather, ...db.crafts, ...db.materials].find(r => favoriteKey(r) === key)).filter(Boolean);
  if (tab === 'facility') return [{ id: 'all', name: '전체 가공 시설', kind: 'facility' }, ...db.facilities.map(f => ({ ...f, id: f.name, kind: 'facility' }))];
  return state.preferences.presets.map(p => ({ ...p, kind: 'presets' }));
}
function current() { return catalog().find(r => r.id === selected) || (['materials', 'craft', 'favorites'].includes(tab) ? [...db.materials, ...db.crafts].find(r => r.id === selected) : null); }
function owned(r) {
  if (!state.stock) return null;
  if (r.kind === 'craft' && ['무기', '방어구', '장신구', '도구', '펫 장비'].includes(r.path?.[0])) return state.stock[r.name] ?? null;
  return state.stock[r.name] ?? state.stock[r.kind === 'materials' ? r.name.replace(/\([^)]*\)$/, '').trim() : r.name] ?? 0;
}
function ownership(r, css = '') { const n = owned(r);return `<span class="owned ${css} ${state.connected ? '' : 'stale'}" data-stock-kind="${r.kind}" data-stock-id="${escape(r.id)}" title="${n == null ? 'CLI에서 보유량 확인 전 또는 장비 조회 미지원' : state.connected ? '마지막 게임 조회 기준' : '연결 전 마지막 확인 수량'}">${n == null ? '—' : fmt(n)}개 보유중</span>`; }
function refreshOwnership() {
  for (const e of document.querySelectorAll('[data-stock-id]')) {
    const r = byId.get(e.dataset.stockId);if (!r) continue;
    const n = owned(r), text = `${n == null ? '—' : fmt(n)}개 보유중`;if (e.textContent !== text) e.textContent = text;e.classList.toggle('stale', !state.connected);
  }
}
function selectedConfig() { const r = displayedRecipe(current());return { kind: r.kind, name: r.name, recipeId: r.id, count: quantity }; }
async function setTab(next) {
  if(next===tab)return;
  if(tab === 'presets' && next !== tab && !(await guardPreset()))return;
  if(tab!=='presets')tabSelections.set(tab,{selected,materialView,quantity});
  tab=next;
  const remembered=tabSelections.get(next);
  selected=remembered?.selected??(next==='facility'?'all':null);
  materialView=remembered?.materialView??null;quantity=remembered?.quantity??(next==='gather'?100:1);
  if(next==='presets'){activePreset=null;presetDraft=null;presetBaseline=null;}
  if(selected&&!current()){selected=next==='facility'?'all':null;materialView=null;}
  listSignature = '';detailSignature = '';$('search').value = '';for (const id of ['category', 'subcategory', 'job-category']) $(id).value = '';renderFilters();render();
}
function renderFilters() {
  const selector = $('category'), previous = selector.value;
  document.querySelector('.search-line').hidden = ['facility','presets'].includes(tab);
  selector.replaceChildren(new Option('전체 분류', ''));
  const groups = ['favorites', 'facility', 'presets'].includes(tab) ? [] : [...new Set(catalog().map(r => r.path?.[0]).filter(Boolean))];
  if (tab === 'gather') groups.sort((a, b) => (gatherOrder.includes(a) ? gatherOrder.indexOf(a) : 99) - (gatherOrder.includes(b) ? gatherOrder.indexOf(b) : 99));
  if (tab === 'materials') groups.sort((a, b) => materialOrder.indexOf(a) - materialOrder.indexOf(b));
  if (tab === 'craft') groups.sort((a, b) => craftOrder.indexOf(a) - craftOrder.indexOf(b));
  for (const label of groups) selector.add(new Option(label, label));selector.value = groups.includes(previous) ? previous : '';selector.hidden = !groups.length;
  for (const [id, depth, label] of [['subcategory', 1, '중분류 전체'], ['job-category', 2, '소분류 전체']]) {
    const select = $(id), before = select.value;select.replaceChildren(new Option(label, ''));
    const parent = depth === 1 ? selector.value : $('subcategory').value;
    const values = parent && !selector.hidden ? [...new Set(catalog().filter(r => r.path?.[0] === selector.value && (depth === 1 || r.path?.[1] === parent)).map(r => r.path?.[depth]).filter(Boolean))] : [];
    for (const value of values) select.add(new Option(value, value));select.value = values.includes(before) ? before : '';select.hidden = !values.length;
  }
  $('favorite-filter').hidden = ['favorites', 'facility', 'presets'].includes(tab);
}
function seconds(n) { n = Math.max(0, Math.ceil(Number(n) || 0));return n >= 3600 ? `${Math.floor(n / 3600)}시간 ${Math.floor(n % 3600 / 60)}분 ${n % 60}초` : n >= 60 ? `${Math.floor(n / 60)}분 ${n % 60}초` : `${n}초`; }
const isDone = w => w.IsCompleted || w.State === 'Completed';
function workRemaining(work) { return MobiWorkTime.remainingAt(work,state.worksReceivedAt); }
function workLabel(work) { return work.State!=='NotStarted' && workRemaining(work)===0 ? '완료 확인 중' : seconds(workRemaining(work)); }
function workMarkup(work) {
  const completed = isDone(work), remaining = workRemaining(work);
  const ratio = MobiWorkTime.progress({...work,RemainingSeconds:remaining}, db.materials, state.preferences.fantasyMembership);
  return `<div class="work-bubble ${completed ? 'complete' : ''}" title="${escape(work.DisplayName)}${ratio == null ? ' · 전체 가공 시간을 확정할 수 없어요' : ''}"><span class="work-fill" data-fill="${ratio ?? 0}"></span><strong>${escape(work.DisplayName)}</strong><small>${completed ? '완료' : (work.State === 'NotStarted' ? '대기 · ' : '') + workLabel(work)}</small></div>`;
}
function applyFills() { for (const e of document.querySelectorAll('[data-fill]')) e.style.transform = `scaleX(${Number(e.dataset.fill) / 100})`; }
function rowMarkup(r) {
  const favorite = state.preferences.favorites.includes(favoriteKey(r)), facility = r.kind === 'facility', preset = r.kind === 'presets';
  const works = facility ? state.works.filter(w => r.id === 'all' || w.FacilityName === r.name) : [];
  return `<div class="item ${facility ? 'facility-item' : ''} ${r.id === selected ? 'selected' : ''}" data-id="${escape(r.id)}"><button class="item-main" title="${escape(r.name)}"><strong>${escape(r.name)}</strong>${facility ? `<span class="count">${works.filter(isDone).length}건 완료</span>` : preset ? '' : ownership(r)}</button>${facility || preset ? '' : `<button class="star ${favorite ? 'active' : ''}" aria-label="${escape(r.name)} 즐겨찾기" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button>`}</div>`;
}
function tree(items, depth = 0) {
  const groups = new Map();for (const r of items) { const label = r.path?.[depth] || '';if (!groups.has(label)) groups.set(label, []);groups.get(label).push(r); }
  const entries = [...groups];if (tab === 'gather' && depth === 0) entries.sort(([a], [b]) => (gatherOrder.includes(a) ? gatherOrder.indexOf(a) : 99) - (gatherOrder.includes(b) ? gatherOrder.indexOf(b) : 99));
  if (tab === 'materials' && depth === 0) entries.sort(([a], [b]) => materialOrder.indexOf(a) - materialOrder.indexOf(b));
  if (tab === 'craft' && depth === 0) entries.sort(([a], [b]) => craftOrder.indexOf(a) - craftOrder.indexOf(b));
  return entries.map(([label, children]) => {
    if (!label) return children.map(rowMarkup).join('');
    const path = tab + ':' + children[0].path.slice(0, depth + 1).join('/'), open = expanded.has(path) || $('search').value.trim() || $('category').value || favoriteOnly;
    return `<details class="group" data-group="${escape(path)}" ${open ? 'open' : ''}><summary><span>${escape(label)}</span><small>${children.length}</small></summary><div class="group-content">${tree(children, depth + 1)}</div></details>`;
  }).join('');
}
function renderList() {
  const query = $('search').value.trim(), filters = ['category', 'subcategory', 'job-category'].map(id => $(id).value);
  const items = catalog().filter(r => r.name.includes(query) && filters.every((value, depth) => !value || r.path?.[depth] === value) && (!favoriteOnly || ['favorites', 'facility', 'presets'].includes(tab) || state.preferences.favorites.includes(favoriteKey(r))));
  const sig = JSON.stringify([tab, selected, query, filters, favoriteOnly, state.preferences.favorites, items.map(r => [r.id, r.name]), null]);
  $('list-count').textContent = tab === 'facility' ? `${items.filter(r => r.id !== 'all').length}개 시설` : `${items.length}개 ${tab === 'presets' ? '프리셋' : '품목'}`;
  if (sig === listSignature) return;listSignature = sig;const scroll = $('catalog-list').scrollTop;
  $('catalog-list').innerHTML = items.length ? ['favorites', 'facility', 'presets'].includes(tab) ? items.map(rowMarkup).join('') : tree(items) : '<div class="queue-empty">표시할 품목이 없어요.</div>';
  $('catalog-list').scrollTop = scroll;
  // 초기 open 속성에도 toggle이 발생하므로 사용자 조작만 기록한다.
  for (const e of document.querySelectorAll('[data-group]')) e.querySelector('summary').onclick = event => {
    event.preventDefault();e.open = !e.open;
    e.open ? expanded.add(e.dataset.group) : expanded.delete(e.dataset.group);
  };
  for (const row of $('catalog-list').querySelectorAll('.item')) {
    const r = items.find(r => r.id === row.dataset.id);
    row.querySelector('.item-main').onclick = () => perform(async () => { if (tab === 'presets' && r.id === activePreset) return;if (tab === 'presets' && !(await guardPreset())) return;selected = r.id;if (r.kind === 'materials') materialView = r.id;quantity = r.kind === 'gather' ? 100 : 1;detailSignature = '';if (tab === 'presets') { activePreset = r.id;presetDraft = structuredClone(state.preferences.presets.find(p => p.id === r.id));presetBaseline=structuredClone(presetDraft); }render(); });
    const star = row.querySelector('.star');if (star) star.onclick = () => perform(() => api('favorite', favoriteKey(r), !state.preferences.favorites.includes(favoriteKey(r))));
  }
}
function capFor(r, amount = quantity) {
  const gather = new Set(state.gatherables), stock = state.stock || {};
  const wanted = amount;
  let n = wanted;for (const i of r.ingredients || []) if (!gather.has(i.name)) n = Math.min(n, Math.floor((stock[i.name] || 0) / i.required));
  return { batches: n, amount: n };
}
function tableRows(r) {
  const batches = quantity;
  return r.ingredients.map(i => { const stock = state.stock?.[i.name], n = i.required * batches, missing = state.stock ? Math.max(0, n - (stock || 0)) : null;
    return `<tr><td>${escape(i.name)}<small>1회 ${i.required}개 · ${state.gatherables.includes(i.name) ? '채집' : '드랍 및 제작, 가공'}</small></td><td>${stock == null && !state.stock ? '—' : fmt(stock)}</td><td>${fmt(n)}</td><td class="${missing ? 'missing' : ''}">${missing == null ? '—' : fmt(missing)}</td></tr>`;
  }).join('');
}
function estimateView(r) {
  if (r.kind === 'gather') return quantity === 0 ? '무한 채집' : `최소 날개 ${fmt(Math.ceil(quantity / 100) * 5)}개`;
  if (!state.stock) return '날개 —';const cap = capFor(r), gather = new Set(state.gatherables);
  const calls = r.ingredients.filter(i => gather.has(i.name)).reduce((sum, i) => sum + Math.ceil(Math.max(0, i.required * cap.batches - (state.stock[i.name] || 0)) / 100), 0) + (r.kind === 'craft' ? cap.batches > 0 ? 1 : 0 : cap.batches);
  return `최소 날개 ${fmt(calls * 5)}개`;
}
function renderDetail() {
  if (tab === 'presets') { renderPresets();return; }
  const r = current();if (!r) { if (detailSignature !== 'empty') $('detail').innerHTML = '<div class="empty">품목을 선택하세요</div>';detailSignature = 'empty';return; }
  if (r.kind === 'facility') { renderFacility(r);return; }
  const signature = r.id + ':' + displayedRecipe(r).id;
  if (signature !== detailSignature) {
    detailSignature = signature;const alternatives = r.kind === 'gather' ? [] : detailAlternatives(r);
    $('detail').innerHTML = `<div class="eyebrow">${escape((r.path || []).join(' > '))}</div><div class="title-row"><h1 title="${escape(r.name)}">${escape(r.name)}</h1>${ownership(r)}</div>${alternatives.length > 1 ? recipeHelp(r, alternatives) : ''}<section class="section"><div class="quantity-label"><strong>${r.kind === 'gather' ? '채집 수량' : r.kind === 'materials' ? '가공 횟수' : '제작 횟수'}</strong>${r.produced > 1 ? `<span class="yield">1회 ${r.produced}개</span>` : ''}</div><div class="quantity"><button id="minus" aria-label="수량 줄이기">−</button><input id="quantity" type="number" value="${quantity}" min="${r.kind === 'gather' ? 0 : 1}" max="999999" aria-label="수량"><button id="plus" aria-label="수량 늘리기">+</button><span>${r.kind === 'gather' ? '개' : '회'}</span><div class="quick-add"><button data-add="1">+1</button><button data-add="10">+10</button><button data-add="100">+100</button></div></div></section>${r.kind === 'gather' ? '' : '<section class="section"><div class="ingredients-title"><h2 class="field-title">재료 목록</h2><small id="stock-time"></small></div><table class="ingredients"><thead><tr><th>재료</th><th>보유</th><th>필요</th><th>부족</th></tr></thead><tbody id="ingredient-rows"></tbody></table></section>'}<div class="run-actions"><button id="start" class="primary"><span>${r.kind === 'gather' ? '자원 채집 시작' : r.kind === 'craft' ? '재료 수급 후 제작' : '재료 수급 후 가공'}</span><small class="cost-label"></small></button><button id="add"><span>+ 대기줄에 담기</span><small class="cost-label"></small></button></div>${r.kind === 'gather' ? '<p class="muted">수량 0은 가방 공간 확인 기준에 도달할 때까지 무한 채집해요.</p>' : ''}`;
    bindRecipeHelp();
    for (const b of document.querySelectorAll('[data-variant]')) b.onclick = () => { if (r.kind === 'materials') materialView = b.dataset.variant;else selected = b.dataset.variant;detailSignature = '';renderDetail(); };
    $('quantity').oninput = () => { const n = Number($('quantity').value);if ($('quantity').value !== '' && Number.isSafeInteger(n) && n >= (r.kind === 'gather' ? 0 : 1) && n <= 999999) { quantity = n;updateAmounts(r); } };
    $('quantity').onchange = () => { $('quantity').value = quantity;updateAmounts(r); };
    const add = n => { quantity = Math.max(r.kind === 'gather' ? 0 : 1, Math.min(999999, quantity + n));$('quantity').value = quantity;updateAmounts(r); };
    $('minus').onclick = () => add(-1);$('plus').onclick = () => add(1);for (const b of document.querySelectorAll('[data-add]')) b.onclick = () => add(Number(b.dataset.add));
    $('add').onclick = () => perform(() => api('add', selectedConfig()));
    $('start').onclick = () => perform(async () => {
      let task = selectedConfig();
      if (task.kind === 'craft') {
        const preview = await api('preview', task);
        if (preview.quantity < task.count) {
          if (!preview.quantity) { toast('직접 준비할 재료가 부족해 지금은 제작할 수 없어요.');return; }
          $('shortage-detail').textContent = `${task.count}회를 요청했지만 현재 재료로는 ${preview.quantity}회 제작할 수 있어요. 가능한 횟수만 진행할까요?`;
          const answer = await confirmShortage(preview.quantity);if (!answer) return;task = { ...task, count: preview.quantity };
        }
      }
      await api('start', task);
    });
  }
  updateAmounts(r);
}
function updateAmounts(r) {
  if ($('ingredient-rows')) { setMarkup($('ingredient-rows'), tableRows(displayedRecipe(r)));setText($('stock-time'), state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' }) + ' 기준' : ''); }
  for (const e of document.querySelectorAll('.cost-label')) setText(e, estimateView(displayedRecipe(r)));
  if ($('start')) $('start').disabled = !state.connected || state.running || state.refreshing;
  if ($('add')) $('add').disabled = state.running;
}
function confirmShortage(n) {
  $('shortage-yes').textContent = `${fmt(n)}회만 제작`;$('shortage').showModal();
  return new Promise(resolve => { const finish = answer => { $('shortage').close();$('shortage').onclose = null;resolve(answer); };$('shortage-no').onclick = () => finish(false);$('shortage-yes').onclick = () => finish(true);$('shortage').onclose = () => resolve(false); });
}
function facilityWorks(name){return state.works.filter(w=>w.FacilityName===name);}
function facilityAvailable(name){return Math.max(0,7-facilityWorks(name).filter(w=>!isDone(w)).length);}
function pendingFor(name){return facilityPlan.filter(id=>byId.get(id)?.facility===name);}
function planStock(){
 const stock={...(state.stock||{})};for(const id of facilityPlan)for(const i of byId.get(id)?.ingredients||[])stock[i.name]=Math.max(0,(stock[i.name]||0)-i.required);return stock;
}
function facilitySlotMarkup(name,detail=false){
 const works=facilityWorks(name),pending=[...pendingFor(name)];const assigned=new Map();
 for(let i=0;i<7;i++)if(!works[i]&&pending.length)assigned.set(i,pending.shift());
 for(let i=0;i<7;i++)if(works[i]&&isDone(works[i])&&pending.length)assigned.set(i,pending.shift());
 return Array.from({length:7},(_,i)=>{
  const w=works[i],id=assigned.get(i),recipe=id?byId.get(id):null,missing=recipe?.ingredients.some(n=>(state.stock?.[n.name]||0)<n.required);
  const nameLabel=recipe?.name||w?.DisplayName||'',status=id?'등록 예정':w?isDone(w)?'완료':w.State==='NotStarted'?'대기':workRemaining(w)===0?'완료 확인 중':seconds(workRemaining(w)):'빈 슬롯';
  return `<button class="facility-slot ${id?'planned'+(missing?' needs-gather':''):w?isDone(w)?'complete':'working':'empty'}" data-facility="${escape(name)}" data-slot="${i}" ${id?`data-planned="${escape(id)}"`:''} title="${escape(nameLabel+' · '+status+(id&&w?' · 기존 완료품 수령 후 등록':''))}" ${state.running?'disabled':''}><span>${escape(nameLabel)||'＋'}</span>${nameLabel?`<small>${escape(detail?status:id?'예정':isDone(w)?'✓':'◷')}</small>`:''}</button>`;
 }).join('');
}
function facilityCardMarkup(f,index){return `<article class="facility-card"><button class="facility-card-heading" data-open-facility="${escape(f.name)}"><h2>${escape(f.name.replace(' 시설',''))}</h2><span class="facility-counts"></span></button><div class="facility-slots" data-slots-facility="${escape(f.name)}"></div></article>`;}
function refreshFacilityStatus(r,works){
 const names=r.id==='all'?db.facilities.map(f=>f.name):[r.name];
 for(const name of names){const container=[...document.querySelectorAll('[data-slots-facility]')].find(el=>el.dataset.slotsFacility===name);if(!container)continue;
  setMarkup(container,facilitySlotMarkup(name,r.id!=='all'));
  const count=container.parentElement.querySelector('.facility-counts');if(count)setText(count,`완료 ${facilityWorks(name).filter(isDone).length}`);
 }
 for(const b of document.querySelectorAll('[data-open-facility]')){b.disabled=state.running;b.onclick=()=>openFacilityPicker(b.dataset.openFacility);}
 for(const b of document.querySelectorAll('.facility-slot'))b.onclick=()=>{
  if(b.dataset.planned){facilityPlan.splice(facilityPlan.indexOf(b.dataset.planned),1);detailSignature='';renderDetail();if($('picker').open)renderPicker(pickerFacility);return;}
  const w=facilityWorks(b.dataset.facility)[Number(b.dataset.slot)];
  if(w&&!isDone(w)){toast(w.DisplayName+' · '+seconds(workRemaining(w)));return;}openFacilityPicker(b.dataset.facility);
 };
 for(const id of ['collect-now','collect-repeat'])$(id).disabled=!state.connected||state.running||!works.some(isDone);
 $('clear-facility-plan').disabled=state.running||!facilityPlan.length;
 for(const id of ['execute-plan','queue-plan'])$(id).disabled=!state.connected||state.running||!facilityPlan.length;
 if($('picker').open)renderPicker(pickerFacility);
}
function refreshFacilityList(){if(tab!=='facility')return;for(const row of document.querySelectorAll('.facility-item')){const works=state.works.filter(w=>row.dataset.id==='all'||w.FacilityName===row.dataset.id);setText(row.querySelector('.count'),`${works.filter(isDone).length}건 완료`);}}
function planConfig(repeats){return {kind:'cycle',planMode:true,facility:'전체 가공 시설',pattern:[...facilityPlan],repeatCount:Number(repeats),gatherBatches:state.preferences.processingRefillRounds??2};}
function renderFacility(r){
 const signature=JSON.stringify([r.id,state.running,state.connected,facilityPlan]);
 const works=state.works.filter(w=>r.id==='all'||w.FacilityName===r.name);
 if(signature===detailSignature){refreshFacilityStatus(r,works);return;}detailSignature=signature;
 $('detail').innerHTML=`<div class="facility-top-actions"><button id="collect-now">일괄 수령</button><button id="collect-repeat">수령 후 재등록</button><button id="clear-facility-plan">예정 비우기</button></div>${r.id==='all'?'<div class="facility-overview">'+db.facilities.map(facilityCardMarkup).join('')+'</div>':`<article class="facility-card single-facility"><button class="facility-card-heading" data-open-facility="${escape(r.name)}"><h2>${escape(r.name)}</h2><span class="facility-counts"></span></button><div class="facility-slots" data-slots-facility="${escape(r.name)}"></div></article>`}<div class="facility-plan-actions"><div class="execute-with-count"><button class="primary" id="execute-plan">즉시 실행</button><input type="number" min="0" max="999999" id="immediate-repeats" value="${immediateRepeats}" aria-label="즉시 실행 반복 횟수" title="0은 무한 반복"><span>회</span></div><div class="execute-with-count"><button id="queue-plan">대기줄에 담기</button><input type="number" min="0" max="999999" id="queue-repeats" value="${queueRepeats}" aria-label="대기줄 반복 횟수" title="0은 무한 반복"><span>회</span></div></div>`;
 $('collect-now').onclick=()=>perform(()=>api('start',{kind:'collect',facility:r.id==='all'?'':r.name,reregister:false}));
 $('collect-repeat').onclick=()=>perform(()=>api('start',{kind:'collect',facility:r.id==='all'?'':r.name,reregister:true}));
 $('clear-facility-plan').onclick=()=>{facilityPlan=[];detailSignature='';renderDetail();};
 $('immediate-repeats').oninput=e=>immediateRepeats=e.target.value;$('queue-repeats').oninput=e=>queueRepeats=e.target.value;
 $('execute-plan').onclick=()=>perform(async()=>{await api('start',planConfig(immediateRepeats));facilityPlan=[];$('picker').close();detailSignature='';render();});
 $('queue-plan').onclick=()=>perform(async()=>{await api('add',planConfig(queueRepeats));facilityPlan=[];detailSignature='';render();});
 refreshFacilityStatus(r,works);
}
function openFacilityPicker(facility){if(state.running)return;pickerMode='plan';pickerFacility=facility;renderPicker(facility);if(!$('picker').open)$('picker').show();fitPicker();}
function registrationChoices(products, chosen, stock, gatherables = []) {
  const remaining={...stock},gather=new Set(gatherables),available=new Set(),needsGather=new Set();
  for(const id of chosen)for(const i of products.find(r=>r.id===id)?.ingredients||[])remaining[i.name]=Math.max(0,(remaining[i.name]||0)-i.required);
  for(const r of products){
    if(!r.ingredients?.length||!r.ingredients.every(i=>(remaining[i.name]||0)>=i.required||gather.has(i.name)))continue;
    available.add(r.id);
    if(r.ingredients.some(i=>(remaining[i.name]||0)<i.required))needsGather.add(r.id);
  }
  return {available,needsGather};
}
function renderPicker(facility){
 const selector=$('picker-facility');setMarkup(selector,db.facilities.map(f=>`<option value="${escape(f.name)}">${escape(f.name)}</option>`).join(''));selector.value=facility;
 selector.onchange=()=>{pickerFacility=selector.value;renderPicker(pickerFacility);};
 const products=unique(db.materials.filter(r=>r.facility===facility)),stock=planStock(),choices=registrationChoices(products,[],stock,state.gatherables||[]),free=facilityAvailable(facility)-pendingFor(facility).length,scroll=$('picker-list').scrollTop;
 $('picker-list').innerHTML=products.map(p=>{const missing=!choices.available.has(p.id),gather=choices.needsGather.has(p.id);return `<button class="product-chip ${gather?'needs-gather':''} ${missing?'unavailable':''}" data-recipe="${escape(p.id)}" title="${missing||gather?'재료 부족':'1회 '+p.produced+'개'}" ${state.running||free<=0||missing?'disabled':''}>${escape(p.name)} <small>${fmt(state.stock?.[p.name.replace(/\([^)]*\)$/, '').trim()]||0)}개</small></button>`;}).join('');
 $('picker-list').scrollTop=scroll;for(const b of $('picker-list').querySelectorAll('[data-recipe]'))b.onclick=()=>{facilityPlan.push(b.dataset.recipe);detailSignature='';renderDetail();renderPicker(pickerFacility);};
}
function fitPicker(){const dialog=$('picker');if(!dialog.open)return;const width=Math.min(410,innerWidth-24);dialog.style.width=width+'px';if(!dialog.dataset.moved){dialog.style.left=Math.max(12,innerWidth-width-16)+'px';dialog.style.top='145px';}}
let pickerDrag=null;
$('picker-drag').onpointerdown=e=>{if(e.target.closest('button'))return;const r=$('picker').getBoundingClientRect();pickerDrag={x:e.clientX-r.left,y:e.clientY-r.top};$('picker-drag').setPointerCapture(e.pointerId);};
$('picker-drag').onpointermove=e=>{if(!pickerDrag)return;const p=$('picker');p.dataset.moved='1';p.style.left=Math.max(0,Math.min(innerWidth-p.offsetWidth,e.clientX-pickerDrag.x))+'px';p.style.top=Math.max(0,Math.min(innerHeight-50,e.clientY-pickerDrag.y))+'px';};
$('picker-drag').onpointerup=$('picker-drag').onlostpointercapture=()=>pickerDrag=null;
window.addEventListener('resize', fitPicker);
function queueName(t) { return t.kind === 'register' ? groupedProducts(t.pattern).map(({recipe:r,count})=>r.name+(count>1?' ×'+count:'')).join(' / ')+' 등록' : t.kind === 'cycle' ? t.facility : t.kind === 'collect' ? t.facility || '전체 가공 시설' : t.name; }
function renderQueue() {
  if (dragId && !state.running) return;
  if(state.running)dragId=null;
  const statuses = { waiting: '대기', running: '실행 중', done: '완료', stopped: '중단됨', skipped: '건너뜀', held:'시설 확인 대기', error: '오류' };
  const markup = t => {
    const products = t.kind === 'cycle' ? groupedProducts(t.pattern).map(({id,count,recipe:r})=>({name:r.name+(count>1?' ×'+count:''),amount:t.repeatCount?`${t.productCompleted?.[id]||0}/${t.repeatCount*count}회`:'무한 반복'})) : t.kind==='register' ? groupedProducts(t.pattern).map(({recipe:r,count})=>({name:r.name,amount:`${count}건 등록`})) : [{ name: queueName(t), amount: t.kind === 'gather' && t.count === 0 ? '무한' : t.kind === 'gather' ? `${t.completed ? t.completed + '/' : ''}${t.count}개` : ['craft','materials'].includes(t.kind) ? `${t.completed ? t.completed + '/' : ''}${t.count}회` : t.reregister ? '수령·재등록' : '수령' }];
    return `<div class="queue-card ${t.kind === 'cycle' ? 'cycle' : ''} ${t.insufficient ? 'shortage' : ''} ${t.status}" data-task="${t.id}" draggable="${(t.kind !== 'cycle'||state.preferences.strictOrder) && !state.running}" title="${escape(t.message || '')}"><div class="q-lines">${products.map(p => `<div class="q-line"><strong>${escape(p.name)}</strong><span>${escape(p.amount)}</span></div>`).join('')}${t.insufficient ? `<span class="q-meta">${t.skipReason ? escape(t.skipReason) : t.possible == null ? t.message || '재료 부족' : `생산 가능 ${fmt(t.possible)}${t.kind === 'gather' ? '개' : '회'}${t.status === 'skipped' ? ' · 건너뜀' : ''}`}</span>` : t.status !== 'waiting' ? `<span class="q-meta">${statuses[t.status] || t.status}${t.kind === 'cycle' && t.completed ? ' · ' + t.completed + '회 수령' : ''}</span>` : ''}</div><div class="q-controls"><span class="q-cost">${t.wings == null ? t.kind === 'cycle' && !t.repeatCount ? '∞ 날개' : '날개 —' : `${fmt(t.wings)}날개`}</span><button data-action="remove" ${state.running ? 'disabled' : ''}>삭제</button></div></div>`;
  };
  setMarkup($('cycle-list'), state.preferences.strictOrder?'':state.queue.filter(t => t.kind === 'cycle').map(markup).join(''));
  setMarkup($('queue-list'), state.queue.filter(t => state.preferences.strictOrder||t.kind !== 'cycle').map(markup).join('') || '<div class="queue-empty">작업을 담아 주세요.</div>');
  $('queue-count').textContent = state.queue.length;const waiting = state.queue.filter(t => t.status === 'waiting');
  $('queue-summary').textContent = `대기 ${waiting.length} · 완료 ${state.queue.filter(t => t.status === 'done').length}${state.queue.some(t => t.insufficient) ? ' · 재료 부족 있음' : ''}`;
  const mode = state.queueMode || 'start';
  setText($('run-queue'), mode === 'resume' ? '이어서 생산하기' : mode === 'restart' ? '다시 실행' : '대기줄 순차 실행');
  $('run-queue').disabled = state.running || state.refreshing || !state.connected || !state.queue.length || (mode === 'start' && !waiting.length);
  $('reset-queue').disabled = state.running || state.refreshing || !state.queue.length;
  $('stop-queue').disabled = !state.running;$('queue-clear').disabled = state.running || !state.queue.length;
  const clearDropMarks = () => document.querySelectorAll('[data-task]').forEach(card => card.classList.remove('drop-before','drop-after'));
  const queueList=$('queue-list');
  const dropPosition = y => {
    const cards=[...queueList.querySelectorAll('[data-task]')].filter(card=>card.dataset.task!==dragId);
    const before=cards.find(card=>y<card.getBoundingClientRect().top+card.offsetHeight/2);
    return {before,cards};
  };
  queueList.ondragover = e => {
    clearDropMarks();if(!dragId||state.running)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const {before,cards}=dropPosition(e.clientY);
    if(before)before.classList.add('drop-before');else cards.at(-1)?.classList.add('drop-after');
  };
  queueList.ondragleave = e => {if(!queueList.contains(e.relatedTarget))clearDropMarks();};
  queueList.ondrop = e => {
    e.preventDefault();clearDropMarks();if(!dragId||state.running)return;
    const {before}=dropPosition(e.clientY),ids=state.queue.map(t=>t.id),from=ids.indexOf(dragId);
    if(from<0)return;ids.splice(from,1);ids.splice(before?ids.indexOf(before.dataset.task):ids.length,0,dragId);
    dragId=null;perform(()=>api('reorder',ids));
  };
  for (const card of document.querySelectorAll('[data-task]')) {
    const id = card.dataset.task;
    for (const b of card.querySelectorAll('[data-action]')) b.onclick = () => {if(!state.running)perform(() => api('remove',id));};
    card.ondragstart = e => { if (state.running || (card.classList.contains('cycle')&&!state.preferences.strictOrder)) { e.preventDefault();return; }clearDropMarks();dragId = id;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain', id); };
    card.ondragover=null;card.ondragleave=null;card.ondrop=null;
    card.ondragend = () => { clearDropMarks();card.classList.remove('dragging');dragId = null;renderQueue(); };
  }
}
function blankPreset() { return perform(() => guardedNavigate(() => { activePreset=null;presetDraft={name:'',tasks:state.queue.map(t=>structuredClone(t))};presetBaseline=structuredClone(presetDraft);detailSignature='';renderPresets(); })); }
function confirmPresetReplace() {
  const dialog=$('preset-replace');dialog.showModal();
  return new Promise(resolve=>{
    const finish=answer=>{dialog.onclose=null;dialog.oncancel=null;dialog.close();resolve(answer);};
    $('preset-replace-no').onclick=()=>finish(false);$('preset-replace-yes').onclick=()=>finish(true);
    dialog.oncancel=event=>{event.preventDefault();finish(false);};dialog.onclose=()=>finish(false);
  });
}
function presetAmount(task, index) {
  if (task.kind !== 'cycle' && task.count == null) return '<small>수령</small>';
  const cycle = task.kind === 'cycle', unit = cycle || ['craft','materials'].includes(task.kind) ? '회' : '개';
  return `<label class="preset-amount"><input type="number" data-preset-amount="${index}" min="${cycle || task.kind === 'gather' ? 0 : 1}" max="999999" step="1" ${cycle ? 'placeholder="∞"' : 'required'} value="${cycle ? task.repeatCount ?? '' : task.count}" aria-label="${escape(queueName(task))} ${cycle ? '반복 횟수' : '수량'}"><span>${unit}</span></label>`;
}
function presetSignature() { return JSON.stringify([activePreset, presetDraft?.tasks, !!presetDraft, state.running]); }
function renderPresets() {
  const signature = presetSignature();if (signature === detailSignature) return;detailSignature = signature;
  $('detail').innerHTML = `<div class="preset-title"><h1>작업 프리셋</h1><div class="preset-header-actions"><button id="preset-capture">대기줄에서 가져오기</button><button id="preset-new">새 프리셋 생성</button></div></div>${presetDraft ? `<label for="preset-name">프리셋 이름</label><input class="preset-name" id="preset-name" maxlength="120" value="${escape(presetDraft.name)}" placeholder="프리셋 이름"><div class="section" id="preset-tasks">${presetDraft.tasks.map((t, i) => `<div class="preset-task" draggable="true" data-index="${i}"><strong>${escape(queueName(t))}</strong>${presetAmount(t, i)}<button data-delete="${i}">×</button></div>`).join('') || '<p class="muted">대기줄에 작업을 담은 뒤 가져와 주세요.</p>'}</div><div class="preset-actions"><button id="preset-save" class="primary">저장</button><button id="preset-load" ${!activePreset || state.running ? 'disabled' : ''}>대기줄에 등록</button><button id="preset-delete" ${activePreset ? '' : 'disabled'}>삭제</button></div>` : '<div class="empty"><button id="preset-create" class="primary">현재 작업 대기줄에서 불러와 생성하기</button></div>'}`;
  $('preset-new').onclick = blankPreset;if ($('preset-create')) $('preset-create').onclick = blankPreset;
  $('preset-capture').onclick = async () => { if (!presetDraft) { blankPreset();return; }if(presetDraft.tasks.length&&!(await confirmPresetReplace()))return;presetDraft.tasks=state.queue.map(t=>structuredClone(t));detailSignature='';renderPresets(); };
  updateSaveButtons();if (!presetDraft) return;
  for (const input of document.querySelectorAll('[data-preset-amount]')) {
    input.oninput = () => {
      const task = presetDraft.tasks[Number(input.dataset.presetAmount)];
      if (task.kind === 'cycle') task.repeatCount = input.value === '' ? null : Number(input.value);else task.count = input.value === '' ? '' : Number(input.value);
      detailSignature = presetSignature();updateSaveButtons();
    };
    input.addEventListener('dragstart', e => { e.preventDefault();e.stopPropagation(); });
  }
  $('preset-name').oninput = () => { presetDraft.name = $('preset-name').value;updateSaveButtons(); };
  $('preset-save').onclick = () => perform(savePreset);
  $('preset-load').onclick = () => perform(async () => { if(await guardPreset()){detailSignature='';renderPresets();await api('load-preset',activePreset);} });
  $('preset-delete').onclick = () => perform(async () => { if(!(await guardPreset()))return;await api('delete-preset', activePreset);activePreset = null;presetDraft = null;presetBaseline=null;selected = null;detailSignature = '';render(); });
  for (const button of document.querySelectorAll('[data-delete]')) button.onclick = () => { presetDraft.tasks.splice(Number(button.dataset.delete), 1);detailSignature = '';renderPresets(); };
  for (const card of document.querySelectorAll('[data-index]')) {
    card.ondragstart = e => { presetDrag = Number(card.dataset.index);e.dataTransfer.setData('text/plain', String(presetDrag)); };
    card.ondragover = e => e.preventDefault();card.ondrop = e => { e.preventDefault();if (presetDrag == null) return;const task = presetDraft.tasks.splice(presetDrag, 1)[0];presetDraft.tasks.splice(Number(card.dataset.index), 0, task);presetDrag = null;detailSignature = '';renderPresets(); };
  }
}
function render() {
  if (!state || !db) return;
  if(state.running&&$('picker').open)$('picker').close();
  const character=$('settings').open?$('agent-character').value:state.preferences.agentCharacter;
  const brandImage=document.querySelector('.brand img'),brandSource=`assets/characters/${character==='B'?'archer':'healer'}/01.png`;
  if(brandImage.getAttribute('src')!==brandSource)brandImage.src=brandSource;
  for (const e of document.querySelectorAll('[data-tab]')) { e.classList.toggle('active', e.dataset.tab === tab);e.setAttribute('aria-pressed', String(e.dataset.tab === tab)); }
  $('connection').textContent = state.connected ? '● 게임 연결됨' : '● 연결 대기';$('connection').classList.toggle('online', state.connected);setText($('connect'), '연결');$('connect').classList.toggle('connected', state.connected);$('connect').disabled = state.running || state.refreshing;
  $('progress-show').hidden = !state.running;$('settings-open').disabled = state.running;
  $('favorite-filter').classList.toggle('active', favoriteOnly);setText($('favorite-filter'), favoriteOnly ? '★' : '☆');$('favorite-filter').setAttribute('aria-pressed', String(favoriteOnly));
  $('detail').classList.toggle('preset-detail', tab === 'presets');
  $('bag-current').textContent = `(현재 ${state.bag ? state.bag.percent.toFixed(1) : '—'}%)`;
  renderList();refreshFacilityList();renderDetail();renderQueue();refreshOwnership();applyFills();updateSaveButtons();
  $('status').textContent = state.stage.text || ({ checking: '작업에 필요한 정보를 확인하고 있어요.', gather: '자원을 모으고 있어요.', shortage: '부족한 재료를 모으고 있어요.', craft: '아이템을 제작하고 있어요.', register: '시설에 가공을 등록하고 있어요.', collect: '완료된 가공품을 수령하고 있어요.', waiting: '가공품이 만들어지는 중이에요.', 'shortage-wait': '직접 준비할 재료를 기다리고 있어요.' }[state.stage.type] || '게임 정보를 확인했어요.');
  $('wings').textContent = `날개 ${state.wings == null ? '—' : fmt(state.wings)}${state.wingsStale && state.wings != null ? ' · 갱신 대기' : ''}`;
}
for (const e of document.querySelectorAll('[data-tab]')) e.onclick = () => perform(() => setTab(e.dataset.tab));
$('search').oninput = () => renderList();
for (const id of ['category', 'subcategory', 'job-category']) $(id).onchange = () => { if (id === 'category') $('subcategory').value = '';if (id !== 'job-category') $('job-category').value = '';refreshFilterList(); };
function refreshFilterList() { listSignature = '';renderFilters();renderList(); }
$('favorite-filter').onclick = () => { favoriteOnly = !favoriteOnly;listSignature = '';render(); };
$('connect').onclick = () => perform(async () => { const result = await api('connect');setCatalog(result.catalog);state = result.state;listSignature = '';renderFilters();render(); });
$('run-queue').onclick = () => perform(() => api('run'));$('reset-queue').onclick = () => perform(() => api('reset-queue'));$('stop-queue').onclick = () => perform(() => api('stop'));$('queue-clear').onclick = () => perform(() => api('clear'));
$('wings').onclick = () => perform(() => api('wings'));$('progress-show').onclick = () => perform(() => api('show-progress'));
$('picker-close').onclick = () => perform(closePicker);
$('picker').oncancel=e=>{e.preventDefault();perform(closePicker);};
$('settings-close').onclick=()=>perform(closeSettings);
$('settings').oncancel=e=>{e.preventDefault();perform(closeSettings);};
$ ('settings').querySelector('form').onsubmit=e=>{e.preventDefault();if(settingsDirty())perform(saveSettings);};
$('settings-open').onclick = () => { $('processing-refill').value=state.preferences.processingRefillRounds??2;$('strict-order').checked=state.preferences.strictOrder===true; $('cli-path').value = cliPath;$('bag-check').checked = state.preferences.bagCheck;$('bag-limit').value = state.preferences.limit;$('fantasy-membership').checked = state.preferences.fantasyMembership !== false;$('cycle-time-enabled').checked = state.preferences.cycleTimeEnabled;$('cycle-minutes').value = state.preferences.cycleMinutes || '';$('cycle-minutes').disabled = !$('cycle-time-enabled').checked;$('agent-character').value=state.preferences.agentCharacter==='B'?'B':'A';$('agent-separate').checked=state.preferences.agentSeparate!==false;$('agent-on-top').checked=state.preferences.agentOnTop!==false;$('agent-on-top').disabled=!$('agent-separate').checked;settingsBaseline=settingsValue();$('settings').showModal();updateSaveButtons(); };
$('agent-separate').onchange=()=>{$('agent-on-top').disabled=!$('agent-separate').checked;updateSaveButtons();};
$('cycle-time-enabled').onchange = () => { $('cycle-minutes').disabled = !$('cycle-time-enabled').checked;updateSaveButtons(); };
$('choose-cli').onclick = () => perform(async () => { const file = await api('choose-cli');if (file) { $('cli-path').value = file;updateSaveButtons(); } });
const retryRow=document.createElement('div');retryRow.className='setting-row';
retryRow.innerHTML='<label><input id="retry-interrupted" type="checkbox"> 행동이 중단되었을 때 다시 작업 시도</label><button type="button" id="retry-interrupted-help" class="recipe-help" aria-label="자동 재시도 주의사항" aria-expanded="false" aria-controls="retry-interrupted-popover">?</button><div id="retry-interrupted-popover" class="recipe-help-popover" popover="auto" role="note">게임에서 행동이 중단되거나 창에 막히면 잠시 기다린 뒤 다시 요청해요. 게임에서 직접 중단한 행동도 다시 시작할 수 있어요.<br><br>재시도마다 정령의 날개가 추가로 소비될 수 있어요. 일부 제작 후 중단하면 완료 횟수를 확인할 수 없어 중복 제작될 수 있어요.<br><br>앱의 중단 버튼을 누르면 재시도하지 않아요. 통신 오류 등으로 실행 결과가 불확실하거나 시설 구성이 바뀐 작업은 자동 재시도하지 않아요.</div>';
$('fantasy-membership').closest('.setting-row').before(retryRow);
bindHelpPopover($('retry-interrupted-help'),$('retry-interrupted-popover'));
$('settings-open').addEventListener('click',()=>{
  $('retry-interrupted').checked=state.preferences.retryInterrupted===true;settingsBaseline=settingsValue();updateSaveButtons();
});
const dataSection=document.createElement('section');dataSection.className='data-management';
dataSection.innerHTML='<h3>데이터 관리</h3><p class="muted">즐겨찾기와 작업 프리셋을 저장하거나 복원해요.</p><div class="run-actions"><button type="button" id="data-export">내보내기</button><button type="button" id="data-import">불러오기</button></div>';
$('apply-settings').parentElement.before(dataSection);
$('data-export').onclick=()=>perform(async()=>{if(!(await guardPreset()))return;if(await api('export-data'))toast('즐겨찾기와 작업 프리셋을 내보냈어요.');});
$('data-import').onclick=()=>perform(async()=>{
  if(!(await guardPreset()))return;
  const imported=await api('import-data');if(imported){activePreset=null;presetDraft=null;presetBaseline=null;selected=null;listSignature='';detailSignature='';render();if(imported.migrationNotice)showMigrationNotice(imported.migrationNotice);else toast('즐겨찾기와 작업 프리셋을 불러왔어요.');}
});
bindHelpPopover($('processing-refill-help'),$('processing-refill-note'));bindHelpPopover($('strict-order-help'),$('strict-order-note'));
$('apply-settings').onclick = () => perform(saveSettings);
const agentChoices=document.createElement('div');agentChoices.className='agent-choices';
agentChoices.innerHTML=['A','B'].map(id=>`<button type="button" data-agent-choice="${id}" aria-pressed="false"><img alt="소녀${id}" draggable="false"><span>소녀${id}</span></button>`).join('');
const agentSelectionRow=$('agent-character').parentElement;
agentSelectionRow.after(agentChoices);
$('agent-character').hidden=true;agentChoices.before($('agent-character'));agentSelectionRow.remove();
function refreshAgentChoices(){
  if(state)render();
  for(const button of agentChoices.querySelectorAll('[data-agent-choice]')){
    const id=button.dataset.agentChoice,active=$('agent-character').value===id;
    button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
    button.querySelector('img').src=`assets/characters/${id==='B'?'archer':'healer'}/${active?'07':'02'}.png`;
  }
}
for(const button of agentChoices.querySelectorAll('button'))button.onclick=()=>{
  $('agent-character').value=button.dataset.agentChoice;$('agent-character').dispatchEvent(new Event('change',{bubbles:true}));
};
$('agent-character').addEventListener('change',refreshAgentChoices);
$('settings').addEventListener('close',()=>{if(state)render();});
$('settings-open').addEventListener('click',refreshAgentChoices);
const aboutDialog=document.createElement('dialog');aboutDialog.id='about';aboutDialog.setAttribute('aria-label','모비노트 정보');
aboutDialog.innerHTML='<div class="about-layout"><section class="about-copy"><button type="button" id="about-close" aria-label="닫기">×</button><small>ABOUT MOBINOTE</small><h2 id="about-version">MobiNote</h2><p id="about-db-date"></p><p>제작 ㅣ Troll_Kim</p><div class="about-rights"><p>© 2026 Troll_Kim<br>소스코드 · MIT License</p><p>마비노기 모바일 관련 상표·게임 자료의 권리는 각 권리자에게 있습니다.</p><p>음원에는 별도 권리가 적용됩니다.</p><p>실행 환경: .NET Framework · WebView2<br>구성요소 고지는 LICENSE와<br>THIRD_PARTY_NOTICES.md를 확인해 주세요.</p></div></section><img class="about-art" data-src="assets/about-embrace.png" alt="소녀A와 소녀B의 즐거운 포옹"></div>';
aboutDialog.querySelector('#about-close').remove();document.body.append(aboutDialog);
aboutDialog.addEventListener('click',event=>{
  const rect=aboutDialog.getBoundingClientRect();
  if(event.target===aboutDialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))aboutDialog.close();
});
const brandPortrait=document.querySelector('.brand img'),aboutButton=document.createElement('button');
aboutButton.type='button';aboutButton.className='brand-portrait';aboutButton.title='모비노트 정보';aboutButton.setAttribute('aria-label','모비노트 저작권 정보');
brandPortrait.replaceWith(aboutButton);aboutButton.append(brandPortrait);aboutButton.onclick=()=>{
  const image=aboutDialog.querySelector('.about-art');if(!image.hasAttribute('src'))image.src=image.dataset.src;
  aboutDialog.showModal();
};
document.addEventListener('input',updateSaveButtons);document.addEventListener('change',updateSaveButtons);
window.mobi.onCloseRequest(() => perform(async () => {
  if(navigating || decision)return;navigating=true;try {
    if($('picker').open){await closePicker();if($('picker').open)return;}
    if($('settings').open){await closeSettings();if($('settings').open)return;}
    if(!(await guardPreset()))return;await api('close-app');
  } finally {navigating=false;}
}));

document.addEventListener('click', e => { if (e.target.matches('input[type=number]')) e.target.select(); });
let agentBootstrap=null,agentFrameReady=false,pendingAgentResult=null;
function relayAgent(message){if(agentFrameReady)$('agent-frame').contentWindow?.postMessage(message,'*');}
function initializeAgent(){
  const frame=$('agent-frame');
  if(!frame.hasAttribute('src')||!frame.contentWindow?.location.pathname.endsWith('/progress.html'))return;
  agentFrameReady=true;
  if(agentBootstrap){
    relayAgent({type:'agent-init',data:{...agentBootstrap,state}});
    if(pendingAgentResult){relayAgent({type:'agent-result',result:pendingAgentResult});pendingAgentResult=null;}
  }
}
function showInternalAgent(visible){
  const dialog=$('work-agent'),frame=$('agent-frame');
  if(visible){if(!frame.hasAttribute('src'))frame.src='progress.html?embedded=1';if(!dialog.open)dialog.showModal();}
  else if(dialog.open)dialog.close();
}
$('agent-frame').addEventListener('load',initializeAgent);
$('work-agent').oncancel=e=>{e.preventDefault();perform(()=>api('hide-progress'));};
window.mobi.onAgentVisible(showInternalAgent);
window.mobi.onResult(result=>{if(state?.preferences.agentSeparate===false){if(agentFrameReady)relayAgent({type:'agent-result',result});else pendingAgentResult=result;}});
window.addEventListener('message',async event=>{
  if(event.source!==$('agent-frame').contentWindow||event.data?.type!=='agent-call')return;
  const {command,id,args=[]}=event.data;if(!['bootstrap','stop','hide-progress'].includes(command))return;
  try{const data=await api(command,...args);relayAgent({type:'agent-response',id,data:command==='bootstrap'?{state:data.state,smoke:data.smoke}:data});}
  catch(error){relayAgent({type:'agent-response',id,error:error.message});}
});
window.mobi.subscribe(next => { state = next;render();relayAgent({type:'agent-state',state:next}); });
api('bootstrap').then(data => {
  state=data.state;setCatalog(data.catalog);cliPath=data.cliPath;agentBootstrap={state:data.state,smoke:data.smoke};
  const info=data.appInfo||{};document.title=`모비노트 ${info.version||''}`;$('about-version').textContent=`MobiNote v.${info.version||'—'}`;$('about-db-date').textContent=`DB날짜 : ${info.dbDate||'—'}`;
  renderFilters();render();initializeAgent();if(data.migrationNotice)showMigrationNotice(data.migrationNotice);if(data.agentVisible)showInternalAgent(true);
}).catch(toast);

// Display-only countdown: game polling and completion decisions retain server values.
setInterval(()=>{if(state && tab==='facility' && selected){const r=current();if(r){refreshFacilityStatus(r,state.works.filter(w=>r.id==='all'||w.FacilityName===r.name));applyFills();}}},1000);

$('processing-refill').oninput=$('strict-order').onchange=updateSaveButtons;

function showMigrationNotice(message){
 let dialog=$('migration-notice');if(!dialog){dialog=document.createElement('dialog');dialog.id='migration-notice';dialog.innerHTML='<h2>이전 반복 작업 제외 안내</h2><p></p><div class="dialog-actions"><button class="primary">확인</button></div>';document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();}
 dialog.querySelector('p').textContent=message;if(!dialog.open)dialog.showModal();
}
