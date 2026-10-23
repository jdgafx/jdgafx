#!/usr/bin/env node
// Dialora session-API bridge: rides the logged-in Chrome (chrome-cdp) session so cookie-authed
// dashboard endpoints work headlessly. Usage:
//   dialora-api.mjs GET  /agents?page=1&limit=50
//   dialora-api.mjs GET  /agents/<id>
//   dialora-api.mjs PUT  /agents/<id> body.json
//   dialora-api.mjs POST /knowledges body.json
//   dialora-api.mjs DELETE /knowledges/<id>
// Env: DIALORA_CDP (default http://127.0.0.1:9223), DIALORA_API (default https://api.dialora.ai)
// Requires a Chrome tab with an app.dialora.ai page open in the target profile.
import fs from 'fs';
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
function resolvePlaywright() {
  const candidates = [
    'playwright', // local/npx resolution first
    process.env.PLAYWRIGHT_PATH && `${process.env.PLAYWRIGHT_PATH}/node_modules/playwright/index.mjs`,
    `${execSync('npm root -g').toString().trim()}/playwright/index.mjs`, // global install
  ].filter(Boolean);
  for (const c of candidates) { try { return require.resolve(c); } catch {} }
  console.error('playwright not found; npm i -g playwright or set PLAYWRIGHT_PATH'); process.exit(2);
}
const { chromium } = await import(resolvePlaywright());

const [method, path, bodyFile] = process.argv.slice(2);
if (!method || !path) { console.error('usage: dialora-api.mjs METHOD /path [body.json]'); process.exit(2); }
const CDP = process.env.DIALORA_CDP || 'http://127.0.0.1:9223';
const API = process.env.DIALORA_API || 'https://api.dialora.ai';
const body = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : undefined;

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap(c => c.pages()).find(p => /app\.dialora\.ai/.test(p.url()));
if (!page) { console.error('no app.dialora.ai tab open on ' + CDP); process.exit(3); }
const res = await page.evaluate(async ({ url, method, body }) => {
  const opts = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'content-type': 'application/json' }; opts.body = body; }
  const r = await fetch(url, opts);
  return { status: r.status, text: await r.text() };
}, { url: API + path, method: method.toUpperCase(), body });
console.error('HTTP ' + res.status);
console.log(res.text);
await browser.close();
process.exit(res.status < 400 ? 0 : 1);
