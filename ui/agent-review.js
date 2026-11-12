'use strict';
const assetBase=document.documentElement.dataset.assetBase||'';
const names=['기본','대기','재료 부족','생각·의문','열심히 작업','울먹임','기쁨','확인 요청 / 자신감','짜증·공격 중단','자신감 / 확인 요청','지루함·낚시','난처함·머쓱함','집중·원인 확인'];
for(const id of ['A','B']){
 const sheet=document.createElement('div');sheet.className='sheet';
 const title=document.createElement('h3');title.textContent=AgentDialogue.name(id)+(id==='A'?' · 차분하고 이지적인 안내':' · 장난스럽고 활발한 동료');sheet.append(title);
 const faces=document.createElement('div');faces.className='faces';
 names.forEach((name,index)=>{if(index===7)name=id==='A'?'확인 요청':'자신감';if(index===9)name=id==='A'?'차분한 자신감':'확인 요청';const face=document.createElement('div');face.className='face';const img=document.createElement('img');img.src=assetBase+`assets/characters/${id==='A'?'healer':'archer'}/${String(index+1).padStart(2,'0')}.png`;img.alt=name;const label=document.createElement('small');label.textContent=`${String(index+1).padStart(2,'0')} · ${name}`;face.append(img,label);faces.append(face);});sheet.append(faces);document.getElementById('portrait-sheets').append(sheet);
}
const scenarios=[
 ['실행 전 대기',{type:'idle'}],
 ['게임 연결 대기',{type:'idle',text:'게임 연결을 기다리고 있어요.'}],
 ['게임 연결 완료',{type:'idle',text:'게임에 연결됐어요. 작업을 시작할 수 있어요.'}],
 ['대기줄 진행 횟수 리셋',{type:'idle',text:'진행 횟수를 초기화했어요. 다시 시작할 수 있어요.'}],
 ['대기줄 작업 준비',{type:'checking',taskKind:'queue'}],
 ['채집 준비',{type:'checking',taskKind:'gather',item:'철 광석',amount:100}],
 ['제작 준비',{type:'checking',taskKind:'craft',item:'못',amount:5}],
 ['자원 가공 준비',{type:'checking',taskKind:'materials',item:'마요네즈',amount:1}],
 ['시설 등록 준비',{type:'checking',taskKind:'cycle',item:'전체 가공 시설'}],
 ['수령 준비',{type:'checking',taskKind:'collect'}],
 ['재료 확인',{type:'preparing'}],
 ['일반 채집',{type:'gather',item:'철 광석',gathered:35,gatherTarget:100}],
 ['무한 채집',{type:'gather',item:'철 광석',gathered:135,gatherTarget:null}],
 ['대기줄 부족 재료 채집',{type:'shortage',item:'밀',source:'대기줄 재료 준비',gathered:12,gatherTarget:40}],
 ['가공 재료 채집',{type:'shortage',item:'달걀',source:'마요네즈',gathered:4,gatherTarget:9,roosterHits:0}],
 ['낚시하러 이동',{type:'gather',item:'농어',fishing:true,fish:true,fishingStarted:false,gathered:0,gatherTarget:1}],
 ['낚시 중',{type:'gather',item:'농어',fishing:true,fish:true,fishingStarted:true,gathered:0,gatherTarget:1}],
 ['제작 재료 낚시',{type:'shortage',item:'농어',source:'농어 매운탕',fishing:true,fish:true,fishingStarted:true,gathered:2,gatherTarget:6}],
 ['낚시로 얻는 기타 품목',{type:'gather',item:'메아리 고둥',fishing:true,fish:false,fishingStarted:true,gathered:1,gatherTarget:3}],
 ['공격으로 채집 중단',{type:'gather',item:'달걀',retrying:true,gathered:14,gatherTarget:30,roosterHits:4}],
 ['재료 채집 중 공격',{type:'shortage',item:'달걀',source:'사과 수플레',retrying:true,gathered:1,gatherTarget:4,roosterHits:1}],
 ['채집 목표 달성',{type:'stop-wait',stopReason:'quantity',item:'철 광석',gathered:100,gatherTarget:100}],
 ['낚시 목표 달성',{type:'stop-wait',stopReason:'quantity',item:'농어',fishing:true,fish:true,gathered:3,gatherTarget:3}],
 ['목표 달성 후 중단 재시도',{type:'stop-wait',stopReason:'quantity',item:'농어',fishing:true,fish:true,gathered:3,gatherTarget:3,stopRetry:true,text:'중단을 요청했어요.'}],
 ['채집 도중 지역 이동',{type:'loading',resumeType:'shortage',item:'달걀',source:'마요네즈',gathered:4,gatherTarget:9,roosterHits:0}],
 ['지역 이동 단독 안내',{type:'loading'}],
 ['게임 정보 재조회',{type:'retry-read',resumeType:'gather',item:'철 광석',gathered:35,gatherTarget:100}],
 ['게임 연결 복구 중',{type:'retry-read',resumeType:'gather',retryCode:'connection_lost',item:'철 광석'}],
 ['다른 행동 종료 대기',{type:'busy'}],
 ['중단된 행동 자동 재시도',{type:'action-retry',item:'달걀'}],
 ['게임 창 때문에 대기',{type:'ui-blocked',blockerKind:'unknown_modal'}],
 ['AI 커넥터 이용 확인',{type:'ui-blocked',blockerKind:'continuous_run_limit'}],
 ['아이템 반복 제작',{type:'craft',item:'탁월한 회복 물약'}],
 ['가공 시설 이동·등록',{type:'register',item:'특수강괴'}],
 ['완성품만 수령',{type:'collect',item:'밀가루'}],
 ['수령 후 재등록 · 수령 단계',{type:'collect',item:'마요네즈',reregister:true}],
 ['수령 후 재등록 · 등록 단계',{type:'register',item:'마요네즈',reregister:true}],
 ['다음 가공 등록 대기',{type:'waiting',details:[{name:'마요네즈',registered:7,completed:3,target:14}]}],
 ['기존 가공으로 빈 슬롯 대기',{type:'waiting',details:[{name:'목재',registered:0,completed:0,target:1,existingWorks:7}]}],
 ['무한 반복 가공 대기',{type:'waiting',details:[{name:'금속 가공 시설',registered:35,completed:28,target:null}]}],
 ['직접 준비 재료 부족으로 추가 등록 중단',{type:'shortage-wait',details:[{name:'마요네즈',registered:7,completed:3,target:14,blocked:true}]}],
 ['사용자 중단 처리 중',{type:'stopping'}],
 ['중단 요청 재시도',{type:'stopping',stopRetry:true}],
 ['열린 창으로 중단 확인 대기',{type:'stopping',stopRetry:true,blockerKind:'unknown_modal'}],
 ['이용 확인으로 중단 확인 대기',{type:'stopping',stopRetry:true,blockerKind:'continuous_run_limit'}],
 ['사용자 중단 완료',{type:'stopped',results:[{name:'못',kind:'제작',count:2}]}],
 ['사용자 중단 후 시설 작업 남음',{type:'stopped',processingContinues:true,results:[{name:'목재',kind:'가공 등록',count:2}]}],
 ['채집 완료 보고',{type:'done',completed:1,total:1,results:[{name:'농어',kind:'채집',count:3,unit:'마리'}]}],
 ['가공 등록 완료 보고',{type:'done',completed:1,total:1,processingContinues:true,results:[{name:'목재',kind:'가공 등록',count:7}]}],
 ['일괄 수령 완료 보고',{type:'done',completed:1,total:1,results:[{name:'목재',kind:'가공 수령',count:7}]}],
 ['제작 완료 보고',{type:'done',completed:1,total:1,results:[{name:'못',kind:'제작',count:5}]}],
 ['전체 작업 건너뜀',{type:'done',completed:0,skipped:1,notices:[{name:'마요네즈',status:'skipped',reason:'식용유가 부족해요.'}]}],
 ['일부 작업 건너뜀',{type:'done',completed:1,skipped:1,results:[{name:'못',kind:'제작',count:5}],notices:[{name:'상급 통나무+',status:'skipped',reason:'채집 도구가 없어요.'}]}],
 ['재료에 맞춰 횟수 조정',{type:'done',completed:1,results:[{name:'못',kind:'제작',count:2}],notices:[{name:'못',status:'done',reason:'재료에 맞춰 2회 제작했어요.'}]}],
 ['일부 시설 보류',{type:'done',completed:1,held:1,results:[{name:'못',kind:'제작',count:5}],notices:[{name:'금속 가공 시설',status:'held',reason:'수령 결과를 확인하지 못했어요. 게임의 시설 현황을 확인해 주세요.'}]}],
 ['게임 창으로 오류 종료',{type:'error',errorCode:'blocked',errorKind:'unknown_modal'}],
 ['이용 확인으로 오류 종료',{type:'error',errorCode:'blocked',errorKind:'continuous_run_limit'}],
 ['구체적인 원인을 확인하지 못한 오류',{type:'error',text:'게임 요청을 처리하지 못했어요. 게임 상태를 확인한 뒤 다시 시도해 주세요.'}]
];
for(const [code,label] of Object.entries({tool_missing:'채집 도구 없음',tool_broken:'도구 내구도 부족',required_consumable_missing:'채집 소모품 부족',not_enough_currency:'날개 부족',not_enough_ingredient:'재료 부족',ingredient_locked:'잠긴 재료',insufficient_transfer_cost:'창고 이동 비용 부족',overweight:'가방 공간 부족',disconnected:'연결 끊김',game_off:'게임 접속 필요',option_off:'AI 커넥터 설정 꺼짐',timeout:'실행 응답 확인 실패',action_interrupted:'게임에서 행동 중단',requires_user_interaction:'게임에서 직접 등록 필요'}))scenarios.push([label,{type:'error',errorCode:code}]);
for(const [label,stage]of scenarios){
 const row=document.createElement('article');row.className='scenario';const title=document.createElement('h3');title.textContent=label;row.append(title);const pair=document.createElement('div');pair.className='pair';
 for(const id of ['A','B']){const text=AgentDialogue.copy(stage,id),card=document.createElement('div');card.className='card '+id.toLowerCase();const img=document.createElement('img');img.src=assetBase+AgentDialogue.portrait(id,text.image);img.alt=text.image;const voice=document.createElement('div');voice.className='voice';const name=document.createElement('small');name.textContent=AgentDialogue.name(id)+' · '+text.phase;const message=document.createElement('strong');message.textContent=text.message;const detail=document.createElement('p');detail.textContent=text.detail;voice.append(name,message,detail);card.append(img,voice);pair.append(card);}row.append(pair);document.getElementById('dialogue-list').append(row);
}
