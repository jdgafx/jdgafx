// Bisect the wrap-up think death: big prompt vs many functions.
// Usage: node dg-bisect.mjs fourfn|bigprompt|full
//   fourfn    = tiny prompt + all 4 production functions
//   bigprompt = full production prompt + ONLY log_lead
//   full      = production prompt + all 4 (control, expected to die)
import { WebSocket } from 'ws';
import { readFileSync } from 'fs';

const KEY = process.env.DEEPGRAM_API_KEY;
const variant = process.argv[2];
const bridgeToken = process.env.DIALORA_BRIDGE_TOKEN ?? '';
// DG_SETTINGS = path to your production Settings JSON (same file dg-gauntlet.mjs uses)
const prod = JSON.parse(readFileSync(process.env.DG_SETTINGS, 'utf8').replaceAll('{{DIALORA_BRIDGE_TOKEN}}', bridgeToken));

const TINY = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead with email test@example.com, first_name Test, briefing "test briefing", lead_tier warm-nurture, urgency_score 3, and say nothing in that turn. After the result, say a one-sentence goodbye.';
const TINY_LONG = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "Pre-approved up to $650,000 — searching 3 months — wants 4 bed in Beaverton with good schools and a big yard for the dog — not working with another realtor — very motivated, wants to move before the school year starts — asked about the asking price and monthly payments", lead_tier qualified-callback, urgency_score 4, routing_outcome callback committed, budget_range up to $650,000, pre_approved yes, has_other_realtor no, criteria 4 bed Beaverton good schools big yard, search_duration 3 months. After the result, say a one-sentence goodbye.';
const TINY_MID = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "Pre-approved up to $650,000 — searching 3 months — wants 4 bed in Beaverton — not working with another realtor", lead_tier qualified-callback, urgency_score 4, budget_range up to $650,000. After the result, say a one-sentence goodbye.';
const TINY_PLAIN = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "Pre-approved to 650k - searching 3 months - wants 4 bed in Beaverton - no other realtor", lead_tier qualified-callback, urgency_score 4, budget_range up to 650k. After the result, say a one-sentence goodbye.';
const TINY_SIX = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "test briefing", lead_tier warm-nurture, urgency_score 3. After the result, say a one-sentence goodbye.';
const TINY_SIXLONG = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "Pre-approved to 650k - searching 3 months - wants 4 bed in Beaverton with good schools and a big yard - no other realtor - very motivated buyer", lead_tier warm-nurture, urgency_score 3. After the result, say a one-sentence goodbye.';
const TINY_7DUR = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "test briefing", lead_tier warm-nurture, urgency_score 3, search_duration 3 months. After the result, say a one-sentence goodbye.';
const TINY_7BUD = 'You are Ava, a phone assistant. When the caller says they are done, call log_lead in a silent turn with ALL of these exact values: email test@example.com, first_name Test, last_name Gentile, briefing "test briefing", lead_tier warm-nurture, urgency_score 3, budget_range up to 650k. After the result, say a one-sentence goodbye.';
const allFns = prod.agent.think.functions;
const logOnly = allFns.filter((f) => f.name === 'log_lead');

const cfg = {
  fourfn: { prompt: TINY, functions: allFns },
  longargs: { prompt: TINY_LONG, functions: allFns },
  midargs: { prompt: TINY_MID, functions: allFns },
  plainargs: { prompt: TINY_PLAIN, functions: allFns },
  sixargs: { prompt: TINY_SIX, functions: allFns },
  sixlong: { prompt: TINY_SIXLONG, functions: allFns },
  sevendur: { prompt: TINY_7DUR, functions: allFns },
  sevenbud: { prompt: TINY_7BUD, functions: allFns },
  bigprompt: { prompt: prod.agent.think.prompt, functions: logOnly },
  full: { prompt: prod.agent.think.prompt, functions: allFns },
}[variant];
if (!cfg) { console.error('variant?'); process.exit(2); }

const settings = {
  type: 'Settings',
  audio: { input: { encoding: 'linear16', sample_rate: 16000 }, output: { encoding: 'linear16', sample_rate: 16000, container: 'none' } },
  agent: {
    language: 'en',
    greeting: 'Hello.',
    listen: { provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' } },
    speak: { provider: { type: 'deepgram', model: 'aura-2-electra-en' } },
    think: { provider: { type: 'anthropic', model: 'claude-sonnet-5' }, prompt: cfg.prompt, functions: cfg.functions },
  },
};

const opener = (variant !== 'bigprompt' && variant !== 'full')
  ? 'Hi. I am done now, thanks, that is everything.'
  : 'Hi, one quick thing — I am not pre-approved and I do not want the guide. My name is Test User, T E S T, my email is test@example.com and yes it is confirmed. That is everything from me, goodbye.';

const ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', { headers: { Authorization: `Token ${KEY}` } });
let sent = false;
const bail = setTimeout(() => { console.log(`RESULT ${variant}: TIMEOUT-NO-VERDICT`); process.exit(1); }, 90000);
setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'KeepAlive' })), 5000);
ws.on('message', (d, bin) => {
  if (bin) return;
  const m = JSON.parse(d.toString());
  if (m.type === 'SettingsApplied' && !sent) { sent = true; ws.send(JSON.stringify({ type: 'InjectUserMessage', content: opener })); }
  if (m.type === 'ConversationText') {
    console.log(`  ${m.role}: ${m.content}`);
    if (m.role === 'assistant' && /right\?|correct\?/i.test(m.content)) {
      setTimeout(() => ws.send(JSON.stringify({ type: 'InjectUserMessage', content: 'Yes, that is right, we are done, goodbye.' })), 800);
    }
  }
  if (m.type === 'FunctionCallRequest') console.log('  REQUEST', m.functions?.map(f => f.name).join(','));
  if (m.type === 'FunctionCallResponse') { clearTimeout(bail); console.log(`RESULT ${variant}: TOOL-ROUND-OK`); setTimeout(() => process.exit(0), 3000); }
  if (m.type === 'Warning') console.log('  Warning:', m.description);
  if (m.type === 'Error') { clearTimeout(bail); console.log(`RESULT ${variant}: THINK-FAILED`); process.exit(2); }
});
ws.on('open', () => ws.send(JSON.stringify(settings)));
ws.on('error', (e) => console.log('ERR', e.message));
