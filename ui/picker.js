'use strict';
const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,busy=false,baseData,pending=[],requestTail=Promise.resolve(),productKey='';
function render(next){
 if(next){baseData=next;data=structuredClone(next);for(const id of pending){const product=data.products.find(p=>p.id===id);if(!product)continue;data.free--;for(const i of product.ingredients)data.stock[i.name]=Math.max(0,(data.stock[i.name]||0)-i.required);}}
 if(!data)return;
 const select=$('facility');if(select.dataset.ready!=='yes'){select.innerHTML=data.facilities.map(f=>`<option value="${escape(f.name)}">${escape(f.name)}</option>`).join('');select.dataset.ready='yes';}select.value=data.facility;select.disabled=busy||data.running||pending.length>0;
 const key=JSON.stringify([data.facility,data.products.map(p=>p.id)]);
 if(key!==productKey){productKey=key;$('products').innerHTML=data.products.map(p=>`<button data-id="${escape(p.id)}"><span>${escape(p.name)}</span><small></small></button>`).join('');for(const b of $('products').querySelectorAll('[data-id]'))b.onclick=()=>request('select',b.dataset.id);}
 const gather=new Set(data.gatherables),stock=data.stock||{};
 for(const b of $('products').querySelectorAll('[data-id]')){const p=data.products.find(p=>p.id===b.dataset.id),missing=p.ingredients.some(i=>(stock[i.name]||0)<i.required),blocked=p.ingredients.some(i=>(stock[i.name]||0)<i.required&&!gather.has(i.name)),name=p.name.replace(/\([^)]*\)$/,'').trim();b.classList.toggle('unavailable',blocked);b.classList.toggle('needs-gather',missing&&!blocked);b.title=missing?'재료 부족':'1회 '+p.produced+'개';b.disabled=busy||data.running||data.free<=0||blocked;b.querySelector('small').textContent=Number(data.owned[name]||0).toLocaleString('ko-KR')+'개';}
}
function request(command,value){
 if(busy||!data||data.running)return Promise.resolve();
 if(command==='select'){const button=[...$('products').querySelectorAll('[data-id]')].find(b=>b.dataset.id===value);if(!button||button.disabled)return Promise.resolve();pending.push(value);render(baseData);}
 else {if(pending.length)return Promise.resolve();busy=true;render();}
 $('error').hidden=true;
 const operation=async()=>{try{const next=await MobiNative.call('picker-request',{command,value});if(command==='select')pending.shift();render(next);}catch(error){if(command==='select')pending.shift();render(baseData);$('error').textContent=error.message;$('error').hidden=false;}finally{if(command!=='select')busy=false;render();}};
 requestTail=requestTail.then(operation,operation);return requestTail;
}
$('facility').onchange=()=>request('facility',$('facility').value);
MobiNative.on('picker-state',next=>{if(!pending.length&&!busy)render(next);else if(next.running){data.running=true;render();}});
MobiNative.call('picker-request',{command:'bootstrap'}).then(render).catch(error=>{$('error').textContent=error.message;$('error').hidden=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')MobiNative.call('hide-picker');});
