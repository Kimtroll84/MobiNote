'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const READ = new Set(['status', 'capabilities', 'get_gatherable_items', 'get_craftable_items', 'get_alterable_items', 'get_altering_works', 'get_items', 'get_my_info', 'get_activity', 'get_currencies']);
const ACTION = new Set(['execute_gathering', 'execute_crafting', 'execute_altering', 'complete_altering_work', 'stop_action']);
const messages = { overweight: '가방 공간이 부족해요.', inventory_full: '가방 공간이 부족해요.', not_enough_currency: '정령의 날개가 부족해요.', not_enough_ingredient: '재료가 부족해요.', blocked: '게임 화면의 확인 창을 처리해 주세요.', disconnected: '게임 연결이 끊겼어요.', game_off: '게임 접속을 확인해 주세요.', queue_full: '가공 시설의 슬롯이 가득 찼어요.', requires_user_interaction: '이 가공은 게임 화면에서 직접 등록해 주세요.' };
Object.assign(messages, {
  expired: '게임 요청이 만료됐어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  disabled: '현재 게임에서 이 명령을 사용할 수 없어요.',
  command_in_progress: '앞선 게임 요청이 끝나기를 기다리고 있어요.',
  rate_limited: '게임에서 안내한 대기 시간이 지난 뒤 다시 요청할게요.',
  connection_lost: '게임과의 연결이 일시적으로 끊겼어요.',
  not_in_game: '캐릭터로 게임에 접속한 뒤 다시 시도해 주세요.',
  option_off: '게임의 AI 커넥터 설정을 켜 주세요.',
  ingredient_locked: '필요한 재료가 잠겨 있어요. 게임에서 잠금을 해제해 주세요.',
  insufficient_transfer_cost: '창고 재료를 가져올 비용이 부족해요.',
  required_consumable_missing: '채집에 필요한 소모품이 부족해요.',
  tool_missing: '채집 도구가 없어요. 도구와 내구도를 확인해 주세요.',
  tool_broken: '채집 도구의 내구도가 부족해요. 게임에서 수리해 주세요.',
  cost_payment_failed: '정령의 날개 비용을 지불하지 못했어요.',
  unknown_command: '현재 게임에서 지원하지 않는 명령이에요. 연결을 다시 확인해 주세요.'
});
function errorMessage(code, message = '') {
  if (/loading/i.test(code + ' ' + message)) return '게임을 불러오는 중이에요. 로딩이 끝난 뒤 다시 시도해 주세요.';
  if (messages[code]) return messages[code];
  if (/only available while in.game|not.in.game/i.test(message + ' ' + code)) return '캐릭터로 게임에 접속한 뒤 다시 시도해 주세요.';
  if (message && /[가-힣]/.test(message)) return message;
  return '게임 요청을 처리하지 못했어요. 게임 상태를 확인한 뒤 다시 시도해 주세요.';
}
function decode(text, exitCode = 0) {
  let result;try { result = JSON.parse(text.replace(/^\uFEFF/, '').trim()); } catch { const error=new Error(/loading|only available while in.game/i.test(text) ? errorMessage('', text) : 'CLI 응답을 읽을 수 없어요.');if(/loading/i.test(text))error.code='loading';throw error; }
  let body = result && typeof result === 'object' && 'body' in result ? result.body : result;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  if (exitCode || ['error', 'rejected', 'invalid_body', 'expired', 'disabled'].includes(result?.status) || body?.error) {
    const code = body?.error || body?.reason || result?.status || 'cli_error';const e = new Error(errorMessage(code, body?.message));e.code = /loading/i.test(code+' '+(body?.message||''))?'loading':code;e.body = body;e.responseStatus=result?.status;throw e;
  }
  return body;
}
class Transport {
  constructor(file) { this.file = file;this.readTail = Promise.resolve(); }
  setPath(file) { if (!file || !/MabinogiMobile_CLI\.exe$/i.test(file) || !fs.existsSync(file)) throw new Error('공식 CLI 파일을 선택해 주세요.');this.file = file; }
  read(command, body) {
    if (!READ.has(command)) return Promise.reject(new Error('읽기 명령이 아닙니다.'));
    const pending = this.readTail.catch(() => {}).then(() => this.request(command, body));this.readTail = pending;return pending;
  }
  action(command, body) { if (!ACTION.has(command)) throw new Error('지원하지 않는 실행 명령입니다.');return this.request(command, body); }
  request(command, body) {
    if (!this.file) return Promise.reject(new Error('설정에서 공식 CLI 파일을 선택해 주세요.'));
    const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const args = [command];if (text !== null) args.push('base64:' + Buffer.from(text, 'utf8').toString('base64'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let data = '', finished = false;
      const finish = (err, value) => { if (finished) return;finished = true;clearTimeout(timer);if(err)err.command=command;err ? reject(err) : resolve(value); };
      const timer = setTimeout(() => { child.kill();const e = new Error('게임 응답 시간이 초과됐어요.');e.code = 'timeout';finish(e); }, ACTION.has(command) && command !== 'stop_action' ? 600000 : 15000);
      child.stdout.setEncoding('utf8');child.stdout.on('data', chunk => { data += chunk;if (data.length > 16000000) { child.kill();finish(new Error('CLI 응답이 너무 큽니다.')); } });
      child.on('error', e => finish(e));child.on('close', code => {
        if(command==='execute_crafting')this.onResponse?.({command,request:body,exitCode:code,rawResponse:data});
        try { finish(null, decode(data, code)); } catch (e) { finish(e); }
      });
    });
  }
}
module.exports = { Transport, decode, errorMessage, READ, ACTION };
