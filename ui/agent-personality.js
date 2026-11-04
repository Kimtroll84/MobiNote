function objectForm(name){
  const text=String(name||'자원').trim(),last=text.replace(/[)\]〉》」』"'’”]+$/gu,'').at(-1)||'',code=last.codePointAt(0);
  const consonant=code>=0xAC00&&code<=0xD7A3?(code-0xAC00)%28!==0:/[013678]/.test(last)&&last.length===1;
  return text+(consonant?'을':'를');
}
function preparationSpeech(stage,casual=false){
  const kind=stage.taskKind,item=stage.item||'',amount=stage.amount;
  if(kind==='queue')return casual?'대기줄 작업을 준비하고 있어!':'대기줄의 작업을 준비하고 있어요.';
  const action={gather:'채집',craft:'제작',materials:'가공',cycle:'가공 SET',register:'가공 등록',collect:'완료품 수령'}[kind];
  if(!action)return null;
  const quantity=amount==null?'':kind==='gather'&&amount===0?' 무한':` ${Number(amount).toLocaleString('ko-KR')}${kind==='gather'?'개':'회'}`;
  return casual?`${item}${quantity} ${action}, 준비하고 있어!`:`${item}${quantity} ${action}을 준비하고 있어요.`;
}
function baseCopy(stage) {
  const item = stage.item || '', types = {
    idle: ['준비', '필요한 작업을 담아 주세요.', 'normal'],
    checking: ['작업 준비', preparationSpeech(stage)||stage.text || '작업에 필요한 정보를 확인하고 있어요.', 'thoughtful'],
    loading: ['지역 이동 대기', '지역을 이동하고 있어요. 로딩이 끝나면 이어서 할게요.', 'thoughtful'],
    'retry-read': ['정보 확인 대기', '게임 정보를 다시 확인하고 있어요. 잠시만 기다려 주세요.', 'thoughtful'],
    busy: ['행동 종료 대기', '진행 중인 행동이 끝나면 다음 작업을 이어갈게요.', 'thoughtful'],
    'action-retry': ['작업 재시도 대기', '게임에서 행동이 중단됐어요. 잠시 기다린 뒤 다시 시도할게요.', 'thoughtful'],
    'stop-wait': ['채집 마무리', stage.text||(stage.stopReason==='quantity'?'목표 수량을 모았어요. 채집을 마무리하고 있어요.':'채집을 마무리하고 있어요.'), 'thoughtful'],
    stopping: ['작업 중단 대기', stage.text || '중단을 요청했어요. 멈췄는지 확인하고 있어요.', 'thoughtful'],
    'ui-blocked': stage.blockerKind==='continuous_run_limit'?['AI 커넥터 이용 확인', 'AI 커넥터 이용 확인이 필요해요. 게임에서 확인 버튼을 눌러 주세요.', 'thoughtful']:['게임 창 확인 대기', '열려 있는 게임 창 때문에 작업을 잠시 기다리고 있어요. 인벤토리나 다른 창을 닫아 주세요.', 'thoughtful'],
    preparing: ['재료 준비', '생산 전에 대기줄에 필요한 재료를 먼저 준비하고 있어요.', 'thoughtful'],
    gather: ['자원 채집', `${objectForm(item)} 모으고 있어요.`, 'normal'],
    shortage: ['부족 재료 채집', stage.source === '대기줄 재료 준비' ? `대기줄 생산에 필요한 ${objectForm(item)} 먼저 모으고 있어요.` : `${stage.source || '생산 작업'}에 쓸 ${objectForm(item)} 모으고 있어요.`, 'shortage'],
    craft: ['아이템 제작', `${item} 아이템을 제작하고 있어요.`, 'normal'],
    register: ['가공 등록', `${item} 가공을 시설에 등록하고 있어요.`, 'normal'],
    collect: ['가공품 수령', '시설의 완성품을 수령하고 있어요.', 'normal'],
    waiting: ['가공 완료 대기', '가공품이 완성될 때까지… 잠시 눈을 붙이고 있을게요.', 'waiting'],
    'shortage-wait': ['재료 준비 대기', '직접 준비해야 하는 재료를 기다리고 있어요.', 'thoughtful'],
    stopped: ['작업 중단', '요청하신 대로 작업을 멈췄어요.', 'happy'],
    error: stage.errorCode==='blocked' ? ['게임 창 확인 필요', stage.errorCommand==='execute_gathering'?'열려 있는 게임 창 때문에 작업이 멈췄어요. 인벤토리나 다른 창을 닫은 뒤, 대기줄의 이어서 생산하기를 눌러 주세요.':'열려 있는 게임 창 때문에 작업이 멈췄어요. 인벤토리나 다른 창을 닫고 게임의 작업 현황을 확인해 주세요.', 'thoughtful'] : ['작업 확인 필요', stage.text || '작업을 계속하기 어려워 잠시 멈췄어요.', 'thoughtful'],
    done: ['작업 완료', stage.held?(stage.text||'확인이 필요한 시설은 보류하고 나머지 작업을 마쳤어요.'):stage.skipped?'가능한 작업을 마쳤어요. 건너뛴 작업이 있어요.':stage.text || '대기줄의 작업을 모두 마쳤어요.', 'normal']
  };
  const [phase, normalMessage, defaultImage] = types[stage.type] || types.checking;
  let image=defaultImage;
  if(['gather','craft','register','collect'].includes(stage.type))image='working';
  if(stage.type==='ui-blocked'||stage.type==='shortage-wait')image='asking';
  if(stage.type==='error')image=stage.errorCode==='blocked'?'asking':'crying';
  if(stage.type==='done')image=stage.held?'thoughtful':'happy';
  if(['gather','shortage'].includes(stage.type)&&stage.retrying)image='annoyed';
  const message=['gather','shortage'].includes(stage.type)&&stage.retrying?'공격 때문에 잠깐 멈췄어요. 다시 채집할게요.':normalMessage;
  let detail = stage.details?.slice(0, 2).map(x => {
    const progress=x.target==null?`${x.completed}회 수령`:`${x.completed}/${x.target}회 완료`;
    return x.existingWorks>0?`${x.name} · 기존 가공 ${x.existingWorks}건 정리 중 · 이번 작업 ${progress}${x.registered!=null?` · ${x.registered}회 등록됨`:''}`:`${x.name} · ${progress}`;
  }).join(' / ') || '';
  if(stage.type==='ui-blocked')detail='창을 닫으면 자동으로 다시 시도할게요.';
  if(stage.type==='error'&&stage.errorCode==='blocked'&&stage.errorCommand!=='execute_gathering')detail='실행 결과 확인이 필요한 작업은 게임 현황을 확인한 뒤 리셋해 주세요.';
  if (stage.type === 'shortage' && stage.remaining != null) detail = `${stage.remaining}개 추가 채집 중`;
  if(['gather','shortage','stop-wait'].includes(stage.type)&&stage.gathered!=null){
    detail=`${Number(stage.gathered).toLocaleString('ko-KR')} / ${stage.gatherTarget==null?'∞':Number(stage.gatherTarget).toLocaleString('ko-KR')}개 채집`;
    const egg=stage.item==='달걀'||stage.item==='황금 달걀';
    if(egg)detail+=` (수탉에게 맞은 횟수 ${Number(stage.roosterHits||0).toLocaleString('ko-KR')}회)`;
  }
  if (stage.type === 'done') detail = `완료 ${stage.completed}개 작업${stage.skipped ? ` · 건너뜀 ${stage.skipped}개` : ''}`;
  if(['done','stopped','error'].includes(stage.type)&&stage.results?.length){
    const summary=stage.type==='done'?`완료 ${stage.completed}개 작업${stage.skipped?` · 건너뜀 ${stage.skipped}개`:''}`:stage.skipped?`건너뜀 ${stage.skipped}개`:'';
    detail=[summary,...stage.results.map(r=>`${r.name} · ${r.kind} ${r.count}회`)].filter(Boolean).join('\n');
  }
  return { phase, message, image, detail, key: [stage.type, item, stage.source || '', stage.details?.map(x => x.name).join('|') || ''].join(':') };
}
'use strict';
// 기본 대사와 동일한 상태·수량을 사용하고 표현과 초상화만 바꾼다.
function casualExplanation(value) {
  return String(value||'').replace(/확인해 주세요\./g,'확인해 줘.').replace(/눌러 주세요\./g,'눌러 줘.').replace(/다시 시도해 주세요\./g,'다시 시도해 줘.').replace(/준비해 주세요\./g,'준비해 줘.').replace(/다시 눌러 주세요\./g,'다시 눌러 줘.').replace(/할게요/g,'할게').replace(/중이에요/g,'중이야').replace(/필요해요/g,'필요해').replace(/않았어요/g,'않았어').replace(/못했어요/g,'못했어').replace(/멈췄어요/g,'멈췄어').replace(/마쳤어요/g,'마쳤어').replace(/있어요/g,'있어').replace(/없어요/g,'없어').replace(/돼요/g,'돼').replace(/했어요/g,'했어').replace(/해요/g,'해').replace(/주세요/g,'줘');
}
const AgentDialogue={
  name(id){return id==='B'?'소녀B':'소녀A';},
  portrait(id,mood){const numbers={normal:'01',waiting:'02',shortage:'03',thoughtful:'04',working:'05',crying:'06',happy:'07',asking:id==='B'?'04':'08',annoyed:'09',confident:'08'};return 'assets/characters/'+(id==='B'?'archer':'healer')+'/'+(numbers[mood]||'01')+'.png';},
  copy(stage,id='A'){
    if(stage.type==='retry-read'&&stage.resumeType&&stage.resumeType!=='retry-read'){
      const continuing=this.copy({...stage,type:stage.resumeType,resumeType:undefined},id);
      return {...continuing,phase:'정보 확인 대기'};
    }
    const text=baseCopy(stage);if(id!=='B')return text;
    const item=stage.item||'',messages={
      idle:'자, 오늘은 뭘 해 볼까? 할 일을 담아 줘!',
      checking:preparationSpeech(stage,true)||'출발 전에 확인부터! 꼼꼼하게 보고 갈게.',
      loading:'지역 이동 중이야. 도착하면 바로 이어 갈게!',
      'retry-read':'어라, 정보가 늦네? 다시 확인하고 있어!',
      busy:'아직 하는 일이 남았네. 끝나면 내 차례야!',
      'action-retry':'앗, 행동이 끊겼네! 잠깐 기다렸다가 다시 해 볼게.',
      'stop-wait':stage.text?casualExplanation(stage.text):stage.stopReason==='quantity'?'목표만큼 다 모았어! 채집을 마무리할게.':'채집을 마무리하는 중이야!',
      stopping:stage.text?casualExplanation(stage.text):'중단을 요청했어. 멈췄는지 확인하고 있어!',
      'ui-blocked':stage.blockerKind==='continuous_run_limit'?'잠깐! 게임에서 AI 커넥터 확인 버튼 좀 눌러 줘. 누르면 다시 달릴게!':'게임 창이 길을 막고 있어! 인벤토리나 열린 창을 닫아 줘.',
      preparing:'생산 전에 재료부터 챙기자! 빠진 게 없는지 볼게.',
      gather:`${objectForm(item)} 모으는 중! 내 솜씨 좀 봐!`,
      shortage:stage.source==='대기줄 재료 준비'?`앗, 재료가 모자라네! ${objectForm(item)} 먼저 모아 올게.`:`${stage.source||'생산 작업'}에 쓸 ${objectForm(item)} 챙겨 올게!`,
      craft:`${item} 제작 중! 어떤 게 나올지 기대되지?`,
      register:`${item} 가공을 맡기는 중이야. 시설로 출발!`,
      collect:'시설의 완성품을 받고 있어!',
      waiting:'가공품이 다 되면 깨워 줘… 쿨…',
      'shortage-wait':'내가 직접 구할 수 없는 재료네. 준비되면 다시 해 보자!',
      stopped:'오케이, 멈췄어! 잠깐 쉬어 가자.',
      done:stage.held?'할 수 있는 일은 끝! 확인이 필요한 시설은 잠깐 남겨 뒀어.':stage.skipped?'할 수 있는 작업은 끝! 건너뛴 것도 아래에서 확인해 줘.':'짜잔, 다 끝냈어! 나 좀 잘했지?',
      error:stage.errorCode==='blocked'?'앗, 게임 창에 막혔어! 열린 창을 닫고 작업 상태를 확인해 줘.':'으앗, 작업이 막혔어. 이유를 같이 확인해 줘!'
    };
    text.message=messages[stage.type]||casualExplanation(text.message);
    if(['checking','stopping','error','done'].includes(stage.type)&&stage.text){
      const explanation=casualExplanation(stage.text);
      if(stage.type==='error')text.message=explanation;
      else if(stage.type==='checking'&&!stage.taskKind)text.message=explanation;
      else if(stage.type==='done'&&stage.held)text.message=explanation;
    }
    if(['gather','shortage'].includes(stage.type)&&stage.retrying)text.message='앗, 맞았잖아! 이 정도로 질 순 없지. 다시 모을게!';
    text.detail=casualExplanation(text.detail);
    if(['idle','checking','retry-read'].includes(stage.type))text.image='confident';
    return text;
  }
};
globalThis.AgentDialogue=AgentDialogue;
