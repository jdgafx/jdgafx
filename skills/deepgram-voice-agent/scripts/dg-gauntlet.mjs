// Deepgram Voice Agent text-mode gauntlet — rule-matched caller.
//
// Usage:
//   DEEPGRAM_API_KEY=... DG_SETTINGS=/path/to/settings.json \
//     node dg-gauntlet.mjs <scenario.json> <transcript-out.json>
//
// The Settings file may contain {{PLACEHOLDER}} tokens (e.g. secret headers);
// each is resolved from the environment variable of the same name at load
// time so no secret ever lives in the committed Settings JSON.
//
// scenario.json:
//   { name, rules: [{re, say, once?=true, optional?}], fallback?, closing: [...] }
// After each completed agent turn, the agent's utterance is matched against the
// first unused rule (in order) and that rule's reply is injected via
// InjectUserMessage. Order-independent against LLM turn-order variance.
// When all required rules are used, closing lines run, then the run ends.
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync } from 'fs';

const KEY = process.env.DEEPGRAM_API_KEY;
if (!KEY) { console.error('DEEPGRAM_API_KEY missing'); process.exit(2); }
const SETTINGS_PATH = process.env.DG_SETTINGS;
if (!SETTINGS_PATH) { console.error('DG_SETTINGS missing (path to Settings JSON)'); process.exit(2); }

const [scenarioPath, outPath] = process.argv.slice(2);
if (!scenarioPath || !outPath) { console.error('usage: dg-gauntlet.mjs <scenario.json> <out.json>'); process.exit(2); }
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));

let raw = readFileSync(SETTINGS_PATH, 'utf8');
const missing = new Set();
raw = raw.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
  if (process.env[name]) return process.env[name];
  missing.add(name);
  return '';
});
if (missing.size) { console.error('Missing env for placeholders:', [...missing].join(', ')); process.exit(2); }
const settings = JSON.parse(raw);
// Text mode still requires audio config; TTS audio frames are discarded.
settings.audio = {
  input: { encoding: 'linear16', sample_rate: 16000 },
  output: { encoding: 'linear16', sample_rate: 16000, container: 'none' },
};

const events = [];
let assistantBuf = [];
let functionPending = 0;
let closingIdx = 0;
let fallbacks = 0;
let done = false;
let idleTimer = null;

const ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
  headers: { Authorization: `Token ${KEY}` },
});

function log(ev) {
  events.push({ t: new Date().toISOString(), ...ev });
  const brief = ev.type === 'ConversationText'
    ? `${ev.role}: ${ev.content}`
    : ev.type + (ev.functions ? ' ' + JSON.stringify(ev.functions.map(f => ({ name: f.name, client_side: f.client_side, args: f.arguments }))) : (ev.description ? ' ' + ev.description : ''));
  console.log('<<', brief);
}

function finish(code, reason) {
  if (done) return;
  done = true;
  writeFileSync(outPath, JSON.stringify({ scenario: scenario.name, reason, events }, null, 2));
  console.log(`DONE (${reason}) — ${events.length} events -> ${outPath}`);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(code), 500);
}

function armIdle(ms, reason) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => finish(
    closingIdx >= (scenario.closing?.length ?? 0) && scenario.rules.every(r => r.used || r.optional) ? 0 : 1,
    reason ?? 'idle'), ms);
}

function inject(content) {
  console.log('>> user:', content);
  events.push({ t: new Date().toISOString(), type: 'InjectUserMessage', content });
  ws.send(JSON.stringify({ type: 'InjectUserMessage', content }));
  armIdle(60000, 'agent-silent');
}

function decide() {
  const text = assistantBuf.join(' ');
  assistantBuf = [];
  let say = null;
  for (const r of scenario.rules) {
    if (r.used && r.once !== false) continue;
    if (new RegExp(r.re, 'i').test(text)) { say = r.say; r.used = true; break; }
  }
  if (!say) {
    const coreDone = scenario.rules.every(r => r.used || r.optional || r.once === false);
    if (coreDone) {
      if (closingIdx < (scenario.closing?.length ?? 0)) say = scenario.closing[closingIdx++];
      else { armIdle(15000, 'complete-idle'); return; }
    } else {
      fallbacks++;
      if (fallbacks > 2) return finish(1, 'no-rule-matched: ' + text.slice(0, 140));
      say = scenario.fallback ?? 'Sorry, could you say that again?';
    }
  }
  setTimeout(() => inject(say), 800);
}

let keepAlive = null;
ws.on('open', () => {
  ws.send(JSON.stringify(settings));
  // Text mode sends no audio frames; Deepgram closes silent sockets.
  // The message type is KeepAlive (NOT AgentKeepAlive), every <=8s.
  keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
  }, 5000);
});
ws.on('message', (data, isBinary) => {
  if (isBinary) return;
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  log(msg);
  switch (msg.type) {
    case 'SettingsApplied':
      armIdle(30000, 'no-greeting');
      break;
    case 'ConversationText':
      if (msg.role === 'assistant') assistantBuf.push(msg.content);
      break;
    case 'FunctionCallRequest':
      functionPending += msg.functions?.length ?? 1;
      armIdle(60000, 'function-hung');
      break;
    case 'FunctionCallResponse':
      // Server-side execution finished — the next AgentAudioDone is a real
      // turn end (the post-function reply), not pre-call filler.
      functionPending = 0;
      armIdle(60000, 'post-function-silent');
      break;
    case 'AgentAudioDone':
      if (functionPending > 0) { functionPending = 0; armIdle(60000, 'post-function-silent'); break; }
      decide();
      break;
    case 'Error':
      finish(1, 'server-error');
      break;
  }
});
ws.on('unexpected-response', (_r, res) => { console.log('HTTP', res.statusCode); finish(1, 'http-' + res.statusCode); });
ws.on('error', (e) => console.log('ERR', e.message));
ws.on('close', () => { clearInterval(keepAlive); finish(done ? 0 : 1, 'socket-closed'); });
setTimeout(() => finish(1, 'hard-timeout'), 8 * 60 * 1000);
