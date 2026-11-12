'use strict';
function objectForm(name){
  const text=String(name||'자원').trim(),last=text.replace(/[)\]〉》」』"'’”]+$/gu,'').at(-1)||'',code=last.codePointAt(0);
  const consonant=code>=0xAC00&&code<=0xD7A3?(code-0xAC00)%28!==0:/[013678]/.test(last)&&last.length===1;
  return text+(consonant?'을':'를');
}
// Fallback for detailed game explanations. Common causes have explicit A/B lines below.
function casualExplanation(value){
  return String(value||'').replace(/확인해 주세요\./g,'확인해 줘.').replace(/눌러 주세요\./g,'눌러 줘.').replace(/다시 시도해 주세요\./g,'다시 시도해 줘.').replace(/준비해 주세요\./g,'준비해 줘.').replace(/할게요/g,'할게').replace(/중이에요/g,'중이야').replace(/필요해요/g,'필요해').replace(/않았어요/g,'않았어').replace(/못했어요/g,'못했어').replace(/멈췄어요/g,'멈췄어').replace(/마쳤어요/g,'마쳤어').replace(/있어요/g,'있어').replace(/없어요/g,'없어').replace(/돼요/g,'돼').replace(/됐어요/g,'됐어').replace(/했어요/g,'했어').replace(/해요/g,'해').replace(/주세요/g,'줘');
}
function preparationSpeech(stage,b){
  const item=stage.item||'작업',n=stage.amount;
  const quantity=n==null?'':n===0?'':` ${Number(n).toLocaleString('ko-KR')}${stage.taskKind==='gather'?'개':'회'}`;
  if(stage.taskKind==='queue')return b?'대기줄 작업을 준비하고 있어!':'대기줄의 작업을 준비하고 있어요.';
  if(['cycle','register'].includes(stage.taskKind))return b?'선택한 가공품을 등록할 준비를 하고 있어!':'선택한 가공품을 등록할 준비를 하고 있어요.';
  if(stage.taskKind==='collect')return b?'시설에서 완성품을 챙길 준비를 하고 있어!':'시설의 완성품을 수령할 준비를 하고 있어요.';
  const action={gather:'채집',materials:'가공',craft:'제작'}[stage.taskKind];
  return action?(b?`${item}${quantity} ${action}을 준비하고 있어!`:`${item}${quantity} ${action}을 준비하고 있어요.`):null;
}
const errorLines={
  tool_missing:['채집 도구가 없거나 사용할 수 없어요. 도구와 내구도를 확인해 주세요.','채집 도구를 쓸 수 없어. 도구랑 내구도를 확인해 줘.'],
  tool_broken:['채집 도구를 수리한 뒤 다시 실행해 주세요.','채집 도구를 수리하고 다시 실행해 줘.'],
  required_consumable_missing:['채집에 필요한 소모품을 준비한 뒤 다시 실행해 주세요.','채집에 필요한 소모품을 챙기고 다시 실행해 줘.'],
  not_enough_currency:['정령의 날개가 부족해요. 날개를 준비한 뒤 다시 실행해 주세요.','정령의 날개가 부족해. 날개를 챙기고 다시 실행해 줘.'],
  not_enough_ingredient:['재료가 부족해 작업을 멈췄어요. 재료를 준비한 뒤 다시 실행해 주세요.','재료가 부족해서 멈췄어. 재료를 챙기고 다시 실행해 줘.'],
  ingredient_locked:['필요한 재료가 잠겨 있어요. 잠금을 해제한 뒤 다시 실행해 주세요.','필요한 재료가 잠겨 있어. 잠금을 풀고 다시 실행해 줘.'],
  insufficient_transfer_cost:['창고 재료를 가져올 비용이 부족해요. 비용을 준비한 뒤 다시 실행해 주세요.','창고 재료를 가져올 비용이 부족해. 비용을 준비하고 다시 실행해 줘.'],
  overweight:['가방 공간을 확보한 뒤 다시 실행해 주세요.','가방에 자리를 만들고 다시 실행해 줘.'],
  inventory_full:['가방 공간을 확보한 뒤 다시 실행해 주세요.','가방에 자리를 만들고 다시 실행해 줘.'],
  disconnected:['게임 연결이 끊겨 작업을 멈췄어요. 다시 연결한 뒤 실행해 주세요.','게임 연결이 끊겨서 멈췄어. 다시 연결하고 실행해 줘.'],
  connection_lost:['게임 연결이 끊겨 작업을 멈췄어요. 다시 연결한 뒤 실행해 주세요.','게임 연결이 끊겨서 멈췄어. 다시 연결하고 실행해 줘.'],
  game_off:['게임에 접속하고 연결한 뒤 다시 실행해 주세요.','게임에 접속해서 연결하고 다시 실행해 줘.'],
  not_in_game:['캐릭터로 게임에 접속한 뒤 다시 실행해 주세요.','캐릭터로 게임에 접속하고 다시 실행해 줘.'],
  option_off:['게임 설정에서 AI 커넥터를 켠 뒤 연결해 주세요.','게임 설정에서 AI 커넥터를 켜고 연결해 줘.'],
  timeout:['게임 응답을 확인하지 못해 작업을 멈췄어요. 게임의 작업 현황을 확인해 주세요.','게임 응답을 확인하지 못해서 멈췄어. 게임의 작업 현황을 확인해 줘.'],
  action_interrupted:['게임에서 작업이 중단됐어요. 작업 상태를 확인한 뒤 다시 실행해 주세요.','게임에서 작업이 중단됐어. 작업 상태를 확인하고 다시 실행해 줘.'],
  requires_user_interaction:['이 가공은 게임 화면에서 직접 등록해 주세요.','이 가공은 게임 화면에서 직접 등록해 줘.']
};
function stageDetail(stage,b){
  const lines=[];
  if(stage.details?.length){
    for(const x of stage.details){
      const registered=x.registered==null?'':`등록 ${x.registered}${x.target==null?'':` / ${x.target}`}회`;
      const received=`수령 ${x.completed||0}회`;
      lines.push([x.name,registered,received,x.existingWorks>0?`기존 가공 ${x.existingWorks}건 대기`:''].filter(Boolean).join(' · '));
    }
  }
  if(['gather','shortage','stop-wait'].includes(stage.type)&&stage.gathered!=null){
    const unit=stage.fish?'마리':'개';
    let count=`${Number(stage.gathered).toLocaleString('ko-KR')} / ${stage.gatherTarget==null?'∞':Number(stage.gatherTarget).toLocaleString('ko-KR')}${unit}${stage.fishing?'':' 채집'}`;
    if(['달걀','황금 달걀'].includes(stage.item))count+=` (수탉에게 맞은 횟수 ${Number(stage.roosterHits||0).toLocaleString('ko-KR')}회)`;
    return count;
  }
  if(['done','stopped','error'].includes(stage.type)){
    if(stage.type==='done')lines.push(`완료 ${stage.completed||0}개 작업${stage.skipped?` · 건너뜀 ${stage.skipped}개`:''}${stage.held?` · 보류 ${stage.held}개`:''}`);
    for(const r of stage.results||[])lines.push(`${r.name} · ${r.kind} ${r.count}${r.unit||'회'}`);
    for(const n of stage.notices||[])lines.push(`${n.name} · ${n.status==='held'?'보류':n.status==='skipped'?'건너뜀':'수량 조정'} · ${b?casualExplanation(n.reason):n.reason}`);
    if(stage.processingContinues)lines.push(b?'시설에 등록된 가공은 계속 진행돼.':'시설에 등록된 가공은 계속 진행돼요.');
  }
  return lines.join('\n');
}
const AgentDialogue={
  name(id){return id==='B'?'소녀B':'소녀A';},
  portrait(id,mood){
    const numbers={normal:'01',waiting:'02',shortage:'03',thoughtful:'13',questioning:'04',working:'05',crying:'06',happy:'07',asking:id==='B'?'10':'08',annoyed:'09',confident:id==='B'?'08':'10',bored:'11',embarrassed:'12'};
    return 'assets/characters/'+(id==='B'?'archer':'healer')+'/'+(numbers[mood]||'01')+'.png';
  },
  copy(stage,id='A'){
    const b=id==='B',say=(a,casual)=>b?casual:a,item=stage.item||'자원';
    // Loading/short read retries keep the actual job's text, counters and portrait.
    if(['loading','retry-read'].includes(stage.type)&&!['disconnected','connection_lost','game_off'].includes(stage.retryCode)&&stage.resumeType&&!['loading','retry-read','ui-blocked'].includes(stage.resumeType)){
      const continuing=this.copy({...stage,type:stage.resumeType,resumeType:undefined},id);
      return {...continuing,phase:stage.type==='loading'?'지역 이동 중':'정보 확인 중'};
    }
    const types={
      idle:['준비',say('필요한 작업을 담아 주세요.','오늘은 뭘 해 볼까? 할 일을 담아 줘!'),'normal'],
      checking:['작업 준비',preparationSpeech(stage,b)||say('작업에 필요한 정보를 확인하고 있어요.','작업에 필요한 정보를 확인하고 있어!'),'normal'],
      preparing:['재료 확인',say('다음 작업에 필요한 재료를 확인하고 있어요.','다음 작업에 필요한 재료를 확인하고 있어!'),'normal'],
      loading:['지역 이동 중',say('지역을 이동하고 있어요. 도착하면 이어갈게요.','지역 이동 중이야. 도착하면 이어갈게!'),'normal'],
      'retry-read':['정보 확인 중',say('게임 연결과 정보를 다시 확인하고 있어요.','게임 연결과 정보를 다시 확인하고 있어.'),'thoughtful'],
      busy:['행동 종료 대기',say('진행 중인 행동이 끝나면 이어갈게요.','지금 하는 행동이 끝나면 이어갈게.'),'normal'],
      'action-retry':['작업 재시도',say('작업이 잠깐 끊겼어요. 다시 이어갈게요.','작업이 잠깐 끊겼네. 다시 이어갈게!'),'thoughtful'],
      gather:['자원 채집',say(`${objectForm(item)} 모으고 있어요.`,`${objectForm(item)} 모으는 중! 내게 맡겨!`),'working'],
      shortage:['부족 재료 채집',say(`${stage.source==='대기줄 재료 준비'?'다음 작업':stage.source||'가공'}에 쓸 ${objectForm(item)} 모으고 있어요.`,`${item}은 내가 챙길게!`),'confident'],
      'stop-wait':['채집 마무리',say('채집을 마무리하고 있어요.','채집을 마무리하고 있어!'),'working'],
      stopping:['작업 중단 중',say('작업을 멈추고 있어요.','작업을 멈추고 있어.'),'thoughtful'],
      'ui-blocked':['게임 확인 대기',say('게임에 열린 창을 확인해 주세요. 진행할 수 있게 되면 이어갈게요.','게임에 열린 창을 확인해 줘. 진행할 수 있게 되면 이어갈게.'),'asking'],
      craft:['아이템 제작',say(`${objectForm(item)} 만들고 있어요.`,`${objectForm(item)} 만들고 있어. 차근차근 해 볼게!`),'working'],
      register:['가공 등록',say(`${objectForm(item)} 가공 시설에 등록하러 갈게요.`,`${objectForm(item)} 가공 시설에 맡기러 갈게!`),'working'],
      collect:['가공품 수령',say('시설의 완성품을 수령하고 있어요.','시설의 완성품을 챙기고 있어!'),'working'],
      waiting:['가공 완료 대기',say('가공품이 완성될 때까지… 잠시 눈을 붙이고 있을게요.','가공품이 다 되면 깨워 줘… 쿨…'),'waiting'],
      'shortage-wait':['재료 확인 대기',say('직접 준비할 재료가 부족해 추가 등록을 멈췄어요. 등록된 가공을 확인하고 있어요.','직접 준비할 재료가 부족해서 추가 등록을 멈췄어. 등록된 가공을 확인하고 있어.'),'embarrassed'],
      stopped:['작업 중단',say('요청하신 대로 작업을 멈췄어요.','오케이, 멈췄어! 잠깐 쉬어 가자.'),'happy'],
      error:['작업 확인 필요',say('작업을 계속하기 어려워 멈췄어요. 게임 상태를 확인해 주세요.','작업이 막혔어. 게임 상태를 확인해 줘.'),'crying'],
      done:['작업 완료',say('요청하신 작업을 마쳤어요.','다 끝냈어! 결과도 확인해 봐.'),'happy']
    };
    let [phase,message,image]=types[stage.type]||types.checking;
    if(stage.type==='idle'&&stage.text)message=b?casualExplanation(stage.text):stage.text;
    if(['gather','shortage'].includes(stage.type)&&stage.fishing){
      phase=stage.fishingStarted?'낚시':'낚시 준비';image=stage.fishingStarted?'bored':'normal';
      message=stage.fishingStarted?say(`${objectForm(item)} 낚고 있어요.`,`${item} 낚는 중! 언제 물려나?`):say(`${objectForm(item)} 낚으러 가고 있어요.`,`${objectForm(item)} 낚으러 가고 있어!`);
    }
    if(['gather','shortage'].includes(stage.type)&&stage.retrying){
      message=say('공격 때문에 잠깐 멈췄어요. 다시 채집할게요.','앗, 맞았잖아! 다시 모을게!');image='annoyed';
    }
    if(stage.type==='stop-wait'&&stage.stopReason==='quantity'){
      image='happy';
      message=stage.fishing?say(`${objectForm(item)} 다 잡았어요. 낚시를 마무리하고 있어요.`,`${objectForm(item)} 다 잡았어!`):say('목표 수량을 모았어요. 채집을 마무리하고 있어요.','목표만큼 다 모았어! 채집을 마무리할게.');
    }
    if(stage.type==='stopping'&&stage.stopRetry)message=say('아직 작업이 멈추지 않아 다시 중단을 요청하고 있어요.','아직 멈추지 않아서 다시 중단을 요청하고 있어.');
    const blocker=stage.blockerKind||stage.errorKind||(stage.type==='stopping'&&/게임 창/.test(stage.text||'')?'unknown_modal':null);
    if(stage.type==='ui-blocked'||['stopping','stop-wait'].includes(stage.type)&&blocker){
      image='asking';
      if(blocker==='continuous_run_limit'){
        phase='AI 커넥터 이용 확인';message=say('게임에서 AI 커넥터 이용 확인을 눌러 주세요. 확인 후 작업을 이어갈게요.','게임에서 AI 커넥터 이용 확인을 눌러 줘. 확인하면 이어갈게!');
      }
      if(['stopping','stop-wait'].includes(stage.type))message=blocker==='continuous_run_limit'?say('게임에서 AI 커넥터 이용 확인을 눌러 주세요. 확인 후 중단을 마무리할게요.','게임에서 AI 커넥터 이용 확인을 눌러 줘. 확인하면 중단을 마무리할게.'):say('게임 창을 확인해 주세요. 진행할 수 있게 되면 중단을 마무리할게요.','게임 창을 확인해 줘. 진행할 수 있게 되면 중단을 마무리할게.');
    }
    if(['collect','register'].includes(stage.type)&&stage.reregister){
      phase='수령·재등록';message=say('완성품을 받고 다음 가공을 등록하고 있어요.','완성품 챙기고 다음 가공도 맡길게!');
    }
    if(stage.type==='waiting'&&stage.details?.length&&stage.details.every(x=>x.existingWorks>0&&!x.registered))message=say('시설에 빈자리가 생기기를 기다리고 있어요.','시설에 빈자리가 생기면 이어갈게… 잠깐 쉬고 있을게.');
    if(stage.type==='error'){
      if(stage.errorCode==='blocked'){
        image='asking';message=stage.errorKind==='continuous_run_limit'?say('게임에서 AI 커넥터 이용 확인을 누른 뒤 작업을 다시 실행해 주세요.','게임에서 AI 커넥터 이용 확인을 누르고 작업을 다시 실행해 줘.'):say('게임에 열린 창을 확인한 뒤 작업을 다시 실행해 주세요.','게임에 열린 창을 확인하고 작업을 다시 실행해 줘.');
      }else if(errorLines[stage.errorCode]){
        message=errorLines[stage.errorCode][b?1:0];
        image=['tool_missing','tool_broken','required_consumable_missing','not_enough_currency','not_enough_ingredient','ingredient_locked','insufficient_transfer_cost','overweight','inventory_full'].includes(stage.errorCode)?'embarrassed':['game_off','not_in_game','option_off','requires_user_interaction'].includes(stage.errorCode)?'asking':'thoughtful';
      }
      else if(stage.text)message=b?casualExplanation(stage.text):stage.text;
    }
    if(stage.type==='done'){
      const progressed=stage.completed>0||(stage.results||[]).some(r=>r.count>0);
      if(stage.held){image='asking';message=say('확인이 필요한 가공 시설이 있어요. 처리 결과를 확인해 주세요.','확인이 필요한 가공 시설이 있어. 처리 결과를 확인해 줘.');}
      else if(stage.skipped&&!progressed){image='asking';message=say('이번에는 진행한 작업이 없어요. 건너뛴 이유를 확인해 주세요.','이번엔 진행한 작업이 없어. 건너뛴 이유를 확인해 줘.');}
      else if(stage.skipped)message=say('진행할 수 있는 작업을 마쳤어요. 건너뛴 작업도 확인해 주세요.','할 수 있는 작업은 마쳤어! 건너뛴 것도 확인해 줘.');
      else if(stage.results?.some(r=>r.kind==='가공 등록')&&stage.results.every(r=>['가공 등록','가공 수령','채집'].includes(r.kind)))message=say('가공 등록을 마쳤어요.','가공 등록을 마쳤어!');
    }
    return {phase,message,image,detail:stageDetail(stage,b),key:[stage.type,item,stage.source||''].join(':')};
  }
};
globalThis.AgentDialogue=AgentDialogue;
