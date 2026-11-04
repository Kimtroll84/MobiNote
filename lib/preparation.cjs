'use strict';
const M=require('./model.cjs');
function remainingOccurrences(job,id){
  if(!job.repeatCount)return Infinity;
  const next=job.nextIndex||0,frequency=job.pattern.filter(x=>x===id).length,laps=Math.floor(next/job.pattern.length),offset=next%job.pattern.length;
  return Math.max(0,(job.repeatCount-laps)*frequency-job.pattern.slice(0,offset).filter(x=>x===id).length);
}
function plan(tasks,stock,gatherables,db){
  const pool={...stock},reservations={};
  const add=(job,recipe,requested,automatic=true)=>{
    if(!(requested>0))return;
    const available=Object.fromEntries(Object.entries(pool).map(([name,count])=>[name,Math.max(0,count)]));
    const batches=M.capacity(recipe,available,automatic?gatherables:new Set(),requested).batches;
    if(!(batches>0))return;
    const line=reservations[job.id]||={};const allocation=line[recipe.id]||={};
    for(const ingredient of recipe.ingredients){const amount=ingredient.required*batches;allocation[ingredient.name]=(allocation[ingredient.name]||0)+amount;pool[ingredient.name]=(pool[ingredient.name]||0)-amount;}
  };
  // The first material preparation pass allocates SET requirements first.
  for(const job of tasks.filter(t=>t.kind==='cycle'&&!t.registrationStopped)){
    const refill=job.gatherBatches??10;
    for(const id of new Set(job.pattern)){
      const recipe=db.materials.find(r=>r.id===id),remaining=remainingOccurrences(job,id);
      add(job,recipe,Math.min(remaining,refill||999999),refill>0);
    }
  }
  for(const job of tasks.filter(t=>['craft','materials'].includes(t.kind))){
    const recipe=M.recipeFor(job,db),remaining=Math.max(0,job.count-(job.kind==='craft'?(job.completed||0):(job.registered||0)));
    add(job,recipe,remaining);
  }
  return reservations;
}
function totals(reservations){
  const result={};for(const line of Object.values(reservations))for(const ingredients of Object.values(line))for(const [name,count]of Object.entries(ingredients))result[name]=(result[name]||0)+count;return result;
}
module.exports={plan,totals,remainingOccurrences};
