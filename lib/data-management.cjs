'use strict';
const M=require('./model.cjs');
function exportData(preferences,db=M.catalog){
 return {format:'MobiNote-user-data',version:1,exportedAt:new Date().toISOString(),favorites:[...preferences.favorites],presets:preferences.presets.map(p=>M.presetConfig(p,db))};
}
function importData(input,db=M.catalog){
 if(input?.format!=='MobiNote-user-data'||input.version!==1||!Array.isArray(input.favorites)||!Array.isArray(input.presets))throw new Error('모비노트에서 내보낸 데이터 파일을 선택해 주세요.');
 const keys=new Set([...db.gather,...db.crafts,...db.materials].map(r=>r.kind+':'+(r.kind==='materials'?r.id:r.name)));
 const favorites=[...new Set(input.favorites.map(key=>{
  if(typeof key!=='string')throw new Error('즐겨찾기 형식이 올바르지 않아요.');
  const mapped=key.startsWith('materials:')?'materials:'+M.canonicalMaterialId(key.slice(10),db):key;
  if(!keys.has(mapped))throw new Error('현재 목록에 없는 즐겨찾기 품목이 있어요. 앱 버전을 확인해 주세요.');return mapped;
 }))];
 const ids=new Set();const presets=input.presets.map(p=>{
  if(typeof p?.id!=='string'||!p.id||ids.has(p.id))throw new Error('프리셋 식별자가 없거나 중복되어 있어요.');ids.add(p.id);
  return M.presetConfig(p,db);
 });
 return {favorites,presets};
}
module.exports={exportData,importData};
