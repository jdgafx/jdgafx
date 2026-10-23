// Probe: does DEEPGRAM_API_KEY authenticate on the Voice Agent WebSocket?
// Sends minimal Settings, expects Welcome + SettingsApplied, then closes.
import { WebSocket } from 'ws';

const KEY = process.env.DEEPGRAM_API_KEY;
if (!KEY) { console.error('DEEPGRAM_API_KEY missing'); process.exit(2); }

const ws = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
  headers: { Authorization: `Token ${KEY}` },
});

const settings = {
  type: 'Settings',
  audio: {
    input: { encoding: 'linear16', sample_rate: 16000 },
    output: { encoding: 'linear16', sample_rate: 16000, container: 'none' },
  },
  agent: {
    language: 'en',
    listen: { provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' } },
    think: { provider: { type: 'anthropic', model: 'claude-sonnet-5', temperature: 0.2 }, prompt: 'You are a test agent. Reply with one short sentence.' },
    speak: { provider: { type: 'deepgram', model: 'aura-2-electra-en' } },
  },
};

const timer = setTimeout(() => { console.log('TIMEOUT no SettingsApplied'); process.exit(1); }, 15000);

ws.on('open', () => { console.log('OPEN'); ws.send(JSON.stringify(settings)); });
ws.on('message', (data, isBinary) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString());
  console.log('<<', JSON.stringify(msg));
  if (msg.type === 'SettingsApplied') { clearTimeout(timer); console.log('AUTH+SETTINGS OK'); ws.close(); process.exit(0); }
  if (msg.type === 'Error') { clearTimeout(timer); process.exit(1); }
});
ws.on('unexpected-response', (_req, res) => { console.log('HTTP', res.statusCode, res.statusMessage); process.exit(1); });
ws.on('error', (e) => { console.log('ERR', e.message); });
