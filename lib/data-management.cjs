'use strict';
const M=require('./model.cjs');
function cleanLegacy(input){
 const removedIds=new Set();let removedTasks=0,removedPresets=0;
 const prune=tasks=>tasks.filter(t=>{if(t?.kind==='cycle'&&t.planMode!==true){removedTasks++;if(t.id)removedIds.add(t.id);return false;}return true;});
 const queue=prune(input.queue||[]),presets=[];
 for(const p of input.presets||[]){
  if(!Array.isArray(p.tasks)){presets.push(p);continue;}
  const tasks=prune(p.tasks);
  if(p.tasks.length&&tasks.length===0){removedPresets++;continue;}
  presets.push({...p,tasks});
 }
 const ledger=Object.fromEntries(Object.entries(input.ledger||{}).map(([facility,slots])=>[facility,slots.map(s=>removedIds.has(s.owner)?{...s,owner:null}:{...s})]));
 return {value:{...input,queue,presets,ledger},removedTasks,removedPresets};
}
function exclusionMessage(report){return report?.removedTasks?`이전 버전의 SET 작업 ${report.removedTasks}건과 빈 프리셋 ${report.removedPresets}개를 제외했어요. 새 가공 계획에서 다시 등록해 주세요.`:'';}
function exportData(preferences,db=M.catalog){
 return {format:'MobiNote-user-data',version:1,exportedAt:new Date().toISOString(),favorites:[...preferences.favorites],presets:cleanLegacy(preferences).value.presets.map(p=>M.presetConfig(p,db))};
}
function importData(input,db=M.catalog){
 if(input?.format!=='MobiNote-user-data'||input.version!==1||!Array.isArray(input.favorites)||!Array.isArray(input.presets))throw new Error('모비노트에서 내보낸 데이터 파일을 선택해 주세요.');
 const keys=new Set([...db.gather,...db.crafts,...db.materials].map(r=>r.kind+':'+(r.kind==='materials'?r.id:r.name)));
 const favorites=[...new Set(input.favorites.map(key=>{
  if(typeof key!=='string')throw new Error('즐겨찾기 형식이 올바르지 않아요.');
  const mapped=key.startsWith('materials:')?'materials:'+M.canonicalMaterialId(key.slice(10),db):key;
  if(!keys.has(mapped))throw new Error('현재 목록에 없는 즐겨찾기 품목이 있어요. 앱 버전을 확인해 주세요.');return mapped;
 }))];
 const ids=new Set();for(const p of input.presets){if(typeof p?.id!=='string'||!p.id||ids.has(p.id))throw new Error('프리셋 식별자가 없거나 중복되어 있어요.');ids.add(p.id);}ids.clear();
 const cleaned=cleanLegacy(input);const presets=cleaned.value.presets.map(p=>{
  if(typeof p?.id!=='string'||!p.id||ids.has(p.id))throw new Error('프리셋 식별자가 없거나 중복되어 있어요.');ids.add(p.id);
  return M.presetConfig(p,db);
 });
 return {favorites,presets,...(cleaned.removedTasks?{legacyExclusions:{removedTasks:cleaned.removedTasks,removedPresets:cleaned.removedPresets}}:{})};
}
module.exports={exportData,importData,cleanLegacy,exclusionMessage};
