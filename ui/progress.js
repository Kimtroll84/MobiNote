'use strict';
const $ = id => document.getElementById(id), agentApi=window.agentApi||window.mobi;
let mood = '', state, testMode = false, terminalLock = null, historyTimer;
const bubble=document.querySelector('.bubble'),speechHistory=new AgentSpeechHistory();
let confirmationAlerted=false,traceFrame=null,traceStageType='idle';
const agentTrace=new AgentTraceRecorder(events=>agentApi.call('agent-trace',events));
agentTrace.setEnabled(false);
function traceSnapshot(){return {stageType:traceStageType,voice:state?.preferences?.agentCharacter||'A',phase:$('phase').textContent,message:bubble.querySelector('strong').textContent,detail:bubble.querySelector('p').textContent,previous:$('speech-history').hidden?'':$('speech-history').textContent,portrait:$('portrait').getAttribute('src'),portraitReady:$('portrait').complete&&$('portrait').naturalWidth>0,summary:$('summary').textContent,running:!!state?.running,documentVisibility:document.visibilityState};}
function traceDisplay(){if(!state?.preferences?.agentTraceEnabled)return;agentTrace.record('agent-update',traceSnapshot());if(traceFrame==null)traceFrame=requestAnimationFrame(()=>{traceFrame=null;agentTrace.record('agent-frame',traceSnapshot());});}
$('portrait').addEventListener('load',()=>{agentTrace.record('agent-portrait-ready',{portrait:$('portrait').getAttribute('src')});traceDisplay();});
document.addEventListener('visibilitychange',()=>{agentTrace.record('agent-document-visibility',{visibility:document.visibilityState});traceDisplay();agentTrace.flush();});
window.addEventListener('pagehide',()=>{agentTrace.record('agent-pagehide',{},false);agentTrace.flush();});

function fitBubble(){
  const available=$('messages').clientHeight,natural=bubble.querySelector('.bubble-copy').scrollHeight+26;
  if(available<=0)return;
  bubble.style.height=Math.min(available,Math.max(52,natural))+'px';
}
function renderSpeech(stage,text,voice){
  const now=performance.now(),history=speechHistory.update(stage,text,voice,now),previous=$('speech-history');
  previous.textContent=history.previous;previous.hidden=!history.previous;
  if(bubble.querySelector('strong').textContent!==text.message)bubble.querySelector('.bubble-scroll').scrollTop=0;
  bubble.querySelector('strong').textContent=text.message;bubble.querySelector('p').textContent=text.detail;bubble.querySelector('p').hidden=!text.detail;
  const counterType=['retry-read','loading'].includes(stage.type)&&stage.resumeType?stage.resumeType:stage.type;
  bubble.querySelector('p').classList.toggle('counter',['gather','shortage','stop-wait'].includes(counterType)&&stage.gathered!=null);
  clearTimeout(historyTimer);
  if(history.expiresAt)historyTimer=setTimeout(()=>{
    speechHistory.expire(performance.now());previous.textContent=speechHistory.previous;previous.hidden=!speechHistory.previous;fitBubble();traceDisplay();
  },Math.max(1,history.expiresAt-now+1));
  fitBubble();
}
function update(next) {
  if(next.running&&!state?.running)speechHistory.reset();
  state = next;agentTrace.setEnabled(state.preferences?.agentTraceEnabled===true);
  if (state.running) terminalLock = null;
  else if (state.terminal && !terminalLock) terminalLock = structuredClone(state.terminal);
  const stage=terminalLock||state.stage;traceStageType=stage.type;const text = AgentDialogue.copy(stage,state.preferences?.agentCharacter);$('phase').textContent = text.phase;
  const confirming=state.running&&stage.type==='ui-blocked'&&stage.blockerKind==='continuous_run_limit';
  if(confirming&&!confirmationAlerted&&!testMode){const sound=$('error-sound');sound.currentTime=0;sound.play().catch(()=>{});}
  confirmationAlerted=confirming;
  const portrait=AgentDialogue.portrait(state.preferences?.agentCharacter,text.image);
  if (mood !== portrait) { mood = portrait;$('portrait').src = portrait; }
  renderSpeech(stage,text,state.preferences?.agentCharacter||'A');
  $('stop').textContent = state.running ? '중단' : '닫기';$('summary').textContent = terminalLock ? `완료 ${terminalLock.completed} / ${terminalLock.total}` : state.immediate ? `완료 ${state.immediate.completed} / ${state.immediate.total}` : `완료 ${state.queue.filter(t => t.status === 'done').length} / ${state.queue.length}`;traceDisplay();
}
$('stop').onclick = () => agentApi.call(state?.running ? 'stop' : 'hide-progress');
window.addEventListener('resize',fitBubble);
new ResizeObserver(fitBubble).observe($('messages'));
agentApi.subscribe(update);
agentApi.onResult(result => { if (testMode) return;const sound = result.type === 'done' ? $('complete-sound') : result.type === 'error' ? $('error-sound') : null;if (sound) { sound.currentTime = 0;sound.play().catch(() => {}); } });
agentApi.call('bootstrap').then(data => { testMode = data.smoke;update(data.state);const main=document.querySelector('main');main.tabIndex=-1;main.focus({preventScroll:true}); });
