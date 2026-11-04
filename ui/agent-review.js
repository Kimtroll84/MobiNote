'use strict';
const names=['기본','대기','재료 부족','생각·의문','열심히 작업','울먹임','기쁨','확인 요청 / 자신감','짜증·공격 중단'];
for(const id of ['A','B']){
 const sheet=document.createElement('div');sheet.className='sheet';
 const title=document.createElement('h3');title.textContent=AgentDialogue.name(id)+(id==='A'?' · 차분하고 이지적인 안내':' · 장난스럽고 활발한 동료');sheet.append(title);
 const faces=document.createElement('div');faces.className='faces';
 names.forEach((name,index)=>{const face=document.createElement('div');face.className='face';const img=document.createElement('img');img.src=`assets/characters/${id==='A'?'healer':'archer'}/${String(index+1).padStart(2,'0')}.png`;img.alt=name;const label=document.createElement('small');label.textContent=`${String(index+1).padStart(2,'0')} · ${name}`;face.append(img,label);faces.append(face);});sheet.append(faces);document.getElementById('portrait-sheets').append(sheet);
}
const scenarios=[
 ['작업 준비',{type:'idle'}],['시작 전 확인',{type:'checking',text:'작업을 시작하기 전에 게임 상태를 확인하고 있어요.'}],
 ['지역 이동',{type:'loading'}],['정보 재확인',{type:'retry-read'}],['다른 행동 종료 대기',{type:'busy'}],['채집 종료 확인',{type:'stop-wait'}],
 ['제작 중단 요청',{type:'stopping',text:'제작을 멈추고 있어요.'}],['중단 요청 거부',{type:'stopping',text:'중단 요청을 처리하지 못했어요. 게임 창을 확인해 주세요. 중단 버튼을 다시 눌러 주세요.'}],
 ['게임 창이 열려 있음',{type:'ui-blocked',blockerKind:'unknown_modal'}],['AI 커넥터 이용 확인',{type:'ui-blocked',blockerKind:'continuous_run_limit'}],
 ['대기줄 재료 확인',{type:'preparing'}],['일반 채집 / 낚시',{type:'gather',item:'농어',gathered:2,gatherTarget:6}],
 ['무한 채집',{type:'gather',item:'철 광석',gathered:35,gatherTarget:null}],['달걀 이스터에그',{type:'gather',item:'달걀',gathered:14,gatherTarget:30,roosterHits:3}],
 ['대기줄 부족 재료 채집',{type:'shortage',item:'밀',source:'대기줄 재료 준비',gathered:12,gatherTarget:40}],
 ['개별 생산 부족 재료 채집',{type:'shortage',item:'농어',source:'농어 매운탕',gathered:2,gatherTarget:6}],
 ['공격 후 재시도',{type:'gather',item:'달걀',retrying:true,gathered:14,gatherTarget:30,roosterHits:4}],
 ['부족 재료 채집 중 공격',{type:'shortage',item:'달걀',source:'사과 수플레',retrying:true,gathered:1,gatherTarget:4,roosterHits:1}],
 ['아이템 제작',{type:'craft',item:'사과 수플레'}],['가공 등록',{type:'register',item:'강철괴'}],['가공품 수령',{type:'collect',item:'밀가루'}],
 ['가공 완료 대기',{type:'waiting',details:[{name:'밀가루',completed:3,target:20}]}],
 ['이전 가공품 정리',{type:'waiting',details:[{name:'밀가루',completed:0,target:20,registered:4,existingWorks:3}]}],
 ['무한 SET 대기',{type:'waiting',details:[{name:'금속 가공 시설',completed:31,target:null}]}],['직접 준비 재료 대기',{type:'shortage-wait'}],
 ['사용자 중단',{type:'stopped',results:[{name:'못',kind:'제작',count:2}]}],
 ['채집이 게임 창에 막혀 중단',{type:'error',errorCode:'blocked',errorCommand:'execute_gathering'}],
 ['제작·가공이 게임 창에 막혀 중단',{type:'error',errorCode:'blocked',errorCommand:'execute_crafting'}],
 ['일반 오류',{type:'error',text:'재료가 부족해요. 게임 상태를 확인해 주세요.'}],
 ['전체 완료',{type:'done',completed:3,total:3,skipped:0,text:'대기줄의 작업을 모두 마쳤어요.',results:[{name:'못',kind:'제작',count:10},{name:'밀가루',kind:'가공 수령',count:20}]}],
 ['일부 작업 건너뜀',{type:'done',completed:2,total:3,skipped:1}],
 ['확인 필요한 시설 보류 후 종료',{type:'done',held:1,completed:2,total:3,text:'확인이 필요한 시설 1개 작업을 보류하고 나머지 작업을 마쳤어요.'}]
];
for(const [label,stage]of scenarios){
 const row=document.createElement('article');row.className='scenario';const title=document.createElement('h3');title.textContent=label;row.append(title);const pair=document.createElement('div');pair.className='pair';
 for(const id of ['A','B']){const text=AgentDialogue.copy(stage,id),card=document.createElement('div');card.className='card '+id.toLowerCase();const img=document.createElement('img');img.src=AgentDialogue.portrait(id,text.image);img.alt=text.image;const voice=document.createElement('div');voice.className='voice';const name=document.createElement('small');name.textContent=AgentDialogue.name(id)+' · '+text.phase;const message=document.createElement('strong');message.textContent=text.message;const detail=document.createElement('p');detail.textContent=text.detail;voice.append(name,message,detail);card.append(img,voice);pair.append(card);}row.append(pair);document.getElementById('dialogue-list').append(row);
}
