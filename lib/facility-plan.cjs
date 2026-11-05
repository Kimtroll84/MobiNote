// Shared planning for new facility jobs. Legacy cycle jobs keep their saved semantics.
'use strict';
function frequencies(job){const n={};for(const id of job.pattern)n[id]=(n[id]||0)+1;return n;}
function registered(job,id){return job.productRegistered?.[id]||0;}
function round(job){const f=frequencies(job);return Math.min(...Object.keys(f).map(id=>Math.floor(registered(job,id)/f[id])));}
function facilities(job,db){return [...new Set(job.pattern.map(id=>db.materials.find(r=>r.id===id).facility))];}
function candidates(job,db){
 const lap=round(job);if(job.repeatCount&&lap>=job.repeatCount)return [];
 const f=frequencies(job);return [...new Set(job.pattern)].filter(id=>registered(job,id)<(lap+1)*f[id]).map(id=>db.materials.find(r=>r.id===id));
}
function remaining(job,id){return job.repeatCount?Math.max(0,job.repeatCount*frequencies(job)[id]-registered(job,id)):Infinity;}
function window(job,facility,rounds,db){const f=frequencies(job),end=Math.min(job.repeatCount||Infinity,round(job)+rounds);return Object.keys(f).map(id=>({recipe:db.materials.find(r=>r.id===id),batches:Math.max(0,end*f[id]-registered(job,id))})).filter(r=>r.recipe.facility===facility&&r.batches>0);}
function duration(recipe,db){const times=db.materials.filter(r=>r.name===recipe.name).map(r=>r.durationSeconds).filter(n=>n>0);return times.length?Math.min(...times):Infinity;}
function order(recipes,stock,gatherables,db,strict=false){
 if(strict)return recipes;
 return [...recipes].sort((a,b)=>{
  const ready=r=>r.ingredients.every(i=>(stock[i.name]||0)>=i.required);
  return Number(ready(b))-Number(ready(a))||duration(a,db)-duration(b,db);
 });
}
module.exports={frequencies,registered,round,facilities,candidates,remaining,window,duration,order};
