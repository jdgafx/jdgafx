// Open the Deepgram playground in the persistent chrome-cdp browser,
// prepopulated from a Settings JSON — no manual pasting.
//
// Usage:
//   node dg-playground-open.mjs /path/SETTINGS.production.json [--identity cng] [--port 9223]
//
// How it works: a full prompt in the URL 400s (request-line limit), and
// localStorage writes get clobbered by the app's own unload save — so the
// script loads a SHORT url carrying models + greeting, then sets the prompt
// with a React-safe value write on the LLM tab's largest textarea and
// verifies the box holds the prompt byte-for-byte before declaring ready.
//
// Playground scope (verified 2026-07-29): greeting, prompt, listen model,
// Deepgram Aura speak model, think provider/model. It has NO custom functions
// (only two built-in examples), so booking/guide/lead flows are hallucinated
// theater here — the model SAYS it acted, nothing real happens. Full-stack
// tests = dg-gauntlet.mjs against the real Settings + endpoints.
//
// Playwright is resolved from PLAYWRIGHT_DIR (any project with playwright
// installed) so this script needs no local node_modules.
import { readFileSync } from 'fs';
import { homedir } from 'os';

const args = process.argv.slice(2);
const settingsPath = args.find((a) => !a.startsWith('--'));
if (!settingsPath) { console.error('usage: dg-playground-open.mjs <settings.json> [--identity cng] [--port N]'); process.exit(2); }
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const raw = readFileSync(settingsPath, 'utf8').replace(/\{\{[A-Z0-9_]+\}\}/g, '');
const agent = JSON.parse(raw).agent;

let port = flag('port', null);
const identity = flag('identity', 'cng');
if (!port) {
  const reg = JSON.parse(readFileSync(`${homedir()}/.config/chrome-cdp/identities.json`, 'utf8'));
  port = reg[identity]?.port ?? reg.identities?.[identity]?.port;
  if (!port) { console.error(`identity '${identity}' not in chrome-cdp registry; pass --port`); process.exit(2); }
}

const speak = agent.speak?.provider ?? {};
let speakModel = speak.model;
if (speak.type !== 'deepgram') {
  speakModel = 'aura-2-electra-en';
  console.error(`NOTE: playground only supports Deepgram Aura voices; ${speak.type} ignored, using ${speakModel}`);
}
const listen = agent.listen?.provider ?? {};
const think = agent.think?.provider ?? {};
const prompt = agent.think?.prompt ?? '';
const greeting = agent.greeting ?? '';

const shortUrl = 'https://playground.deepgram.com/?' + new URLSearchParams({
  endpoint: 'agent',
  language: agent.language ?? 'en',
  speakModel,
  listenVersion: listen.version ?? 'v2',
  listenModel: listen.model ?? 'flux-general-en',
  customWelcomeMessage: greeting,
  llmProviderType: think.type ?? 'anthropic',
  llmModelName: think.model ?? '',
}).toString().replace(/\+/g, '%20'); // the app leaves '+' undecoded in text fields

const pwDir = process.env.PLAYWRIGHT_DIR ?? process.cwd(); // a project with playwright in node_modules
const { chromium } = await import(`${pwDir}/node_modules/playwright/index.mjs`);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctx = browser.contexts()[0];
const existing = ctx.pages().find((p) => p.url().includes('playground.deepgram.com'));
const page = existing ?? await ctx.newPage();

await page.goto(shortUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// The prompt can't ride the URL (request-line limit -> 400) and localStorage
// gets clobbered by the app's own unload save — so fill the LLM tab's
// textarea directly and verify byte length.
const readPromptBox = async () => {
  await page.locator('button:text-is("LLM")').first().click().catch(() => {});
  await page.waitForTimeout(600);
  return page.evaluate(() =>
    [...document.querySelectorAll('textarea')].map((t) => t.value).sort((a, b) => b.length - a.length)[0] ?? '');
};

let boxVal = await readPromptBox();
if (boxVal !== prompt) {
  // React-safe set on the LARGEST textarea (the prompt box; others are keyterms etc).
  await page.evaluate((p) => {
    const tas = [...document.querySelectorAll('textarea')];
    const el = tas.sort((a, b) => b.value.length - a.value.length)[0];
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, p);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, prompt);
  await page.waitForTimeout(400);
  boxVal = await readPromptBox();
}
const ok = boxVal.length === prompt.length && boxVal.includes('slot_token');
console.log(`playground on ${identity}:${port} — think=${think.model} speak=${speakModel} promptBox=${boxVal.length}/${prompt.length} chars verified=${ok}`);
if (!ok) { console.error('PROMPT NOT APPLIED — inspect the tab before testing.'); process.exit(1); }
console.log('REMINDER: no functions in playground — booking/guide/log flows are theater here; use dg-gauntlet.mjs for full-stack.');
await browser.close();
