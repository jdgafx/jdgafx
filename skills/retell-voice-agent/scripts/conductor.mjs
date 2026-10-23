#!/usr/bin/env node
/**
 * conductor.mjs — drive Retell's Conductor over CDP from a logged-in Chrome.
 *
 * Conductor is dashboard-only (zero API), so the ONLY way to automate it is a real browser.
 * Every quirk below cost a debugging cycle to find; they are handled here so you never repeat them.
 *
 *   node conductor.mjs status                 # is it busy / are changes pending / quota
 *   node conductor.mjs open <agent_id>        # navigate to an agent and open the Conductor panel
 *   node conductor.mjs send <file.txt>        # send a prompt (waits until the input is free)
 *   node conductor.mjs wait [timeoutSec]      # block until it stops generating
 *   node conductor.mjs read [chars]           # print the latest response
 *   node conductor.mjs pending                # list proposed changes awaiting accept/reject
 *   node conductor.mjs accept                 # Accept all + Submit
 *   node conductor.mjs reject                 # Reject all
 *   node conductor.mjs shot <out.png>         # screenshot
 *   node conductor.mjs reload                 # discard stale tab state (do this before editing!)
 *
 * Env: CDP_URL (default http://127.0.0.1:9222)
 *
 * Quirks handled:
 *  - The composer input is DISABLED both while generating AND while changes await accept/reject.
 *  - Clicks on the input are intercepted by an overlay div -> focus() + insertText() instead.
 *  - Accepting is TWO steps: "Accept all" then "Submit". Accept alone does not commit.
 *  - A stale tab autosaves and can clobber API changes -> `reload` before any UI edit.
 */

// Playwright resolves from THIS script's directory, which (as a global skill) has no
// node_modules. Resolve it from the working project instead, or from PLAYWRIGHT_PATH.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const loadChromium = async () => {
  try {
    return (await import('playwright')).chromium;
  } catch {}
  for (const base of [process.env.PLAYWRIGHT_PATH, process.cwd()].filter(Boolean)) {
    try {
      const req = createRequire(pathToFileURL(`${base}/package.json`));
      const mod = await import(pathToFileURL(req.resolve('playwright')).href);
      return (mod.default ?? mod).chromium;
    } catch {}
  }
  console.error(
    'playwright not found.\n' +
    'Run this from a project that has it installed, or set PLAYWRIGHT_PATH to such a project,\n' +
    'or install it globally:  npm i -g playwright');
  process.exit(2);
};
const chromium = await loadChromium();

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const [, , cmd, arg] = process.argv;

const connect = async () => {
  let b;
  try {
    b = await chromium.connectOverCDP(CDP, { timeout: 10000 });
  } catch {
    console.error(`Cannot reach Chrome at ${CDP}.\nLaunch it with a persistent profile and log into Retell once by hand, e.g.:\n` +
      `  chrome --user-data-dir=$HOME/.chrome-cdp --remote-debugging-port=9222 --remote-allow-origins='*' https://dashboard.retellai.com/`);
    process.exit(2);
  }
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('retellai.com'));
  if (!page) {
    console.error('No retellai.com tab open. Run: conductor.mjs open <agent_id>  (or open the dashboard by hand)');
    await b.close();
    process.exit(2);
  }
  return { b, page };
};

const pendingCount = async (page) =>
  page.locator('button').filter({ hasText: /^(Accept all|Reject all)$/ }).count();

/**
 * Busy = the composer input is disabled for a reason OTHER than pending changes.
 *
 * Do NOT scrape the transcript for "Running tests"/"Thinking" — those strings persist in the
 * conversation history forever, so tail-matching reports BUSY permanently once any simulation
 * has run. The input's disabled attribute is the only authoritative signal; it goes disabled
 * both while generating and while changes await accept/reject, so subtract the latter.
 */
const isBusy = async (page) => {
  const ta = page.locator('textarea[placeholder*="Conductor"]');
  if (!(await ta.count())) return false;
  const disabled = await ta.first().isDisabled();
  if (!disabled) return false;
  return (await pendingCount(page)) === 0;
};

const waitIdle = async (page, timeoutSec = 600) => {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (!(await isBusy(page))) return true;
    await page.waitForTimeout(5000);
  }
  return false;
};

const readLatest = async (page, chars = 6000) => {
  const t = await page.evaluate(() => {
    const ta = document.querySelector('textarea[placeholder*="Conductor"]');
    let el = ta ? ta.closest('div') : null;
    for (let i = 0; i < 14 && el; i++) {
      if ((el.innerText || '').length > 1500) break;
      el = el.parentElement;
    }
    return el ? el.innerText : document.body.innerText;
  });
  return t.slice(-chars);
};

const { b, page } = await connect();
await page.bringToFront().catch(() => {});

try {
  if (cmd === 'status') {
    const busy = await isBusy(page);
    const pend = await pendingCount(page);
    const ta = page.locator('textarea[placeholder*="Conductor"]');
    const present = await ta.count();
    console.log(`url      : ${page.url()}`);
    console.log(`panel    : ${present ? 'open' : 'CLOSED (run: conductor.mjs open <agent_id>)'}`);
    console.log(`state    : ${busy ? 'BUSY (generating)' : 'idle'}`);
    console.log(`pending  : ${pend ? 'CHANGES AWAITING accept/reject — input stays disabled until resolved' : 'none'}`);
    if (present) console.log(`input    : ${(await ta.first().isDisabled()) ? 'disabled' : 'ready'}`);
  } else if (cmd === 'open') {
    if (!arg) throw new Error('usage: conductor.mjs open <agent_id>');
    await page.goto(`https://dashboard.retellai.com/agents/${arg}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    if (!(await page.locator('textarea[placeholder*="Conductor"]').count())) {
      await page.locator('button').filter({ hasText: /^Conductor$/ }).first().click({ force: true });
      await page.waitForTimeout(3000);
    }
    console.log(`opened ${arg}; panel ${(await page.locator('textarea[placeholder*="Conductor"]').count()) ? 'open' : 'NOT open'}`);
  } else if (cmd === 'send') {
    if (!arg) throw new Error('usage: conductor.mjs send <file.txt>');
    const fs = await import('node:fs/promises');
    const text = (await fs.readFile(arg, 'utf8')).trim();
    if (await pendingCount(page)) {
      console.error('Changes are pending — accept or reject them first (input is disabled until then).');
      process.exit(1);
    }
    if (await isBusy(page)) { console.log('busy; waiting...'); await waitIdle(page); }
    const box = page.locator('textarea[placeholder*="Conductor"]').last();
    // click() is intercepted by an overlay; focus + insertText is the reliable path
    await box.focus();
    await page.waitForTimeout(400);
    await page.keyboard.insertText(text);
    await page.waitForTimeout(1000);
    const len = (await box.inputValue()).length;
    if (len < 50) { console.error(`fill failed (${len} chars) — is the input disabled?`); process.exit(1); }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    console.log(`sent ${len} chars${(await box.inputValue()).length === 0 ? '' : ' (WARNING: box not cleared)'}`);
  } else if (cmd === 'wait') {
    const ok = await waitIdle(page, arg ? Number(arg) : 600);
    console.log(ok ? 'idle' : 'TIMEOUT — still generating');
    process.exit(ok ? 0 : 1);
  } else if (cmd === 'read') {
    console.log(await readLatest(page, arg ? Number(arg) : 6000));
  } else if (cmd === 'pending') {
    const n = await pendingCount(page);
    if (!n) { console.log('no pending changes'); }
    else {
      const t = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((e) => /^Accept all$/.test(e.innerText.trim()));
        let el = btn?.closest('div');
        for (let i = 0; i < 8 && el; i++) { if ((el.innerText || '').length > 200) break; el = el.parentElement; }
        return el ? el.innerText : '';
      });
      console.log(t.slice(0, 3000));
    }
  } else if (cmd === 'accept') {
    if (!(await pendingCount(page))) { console.log('nothing pending'); }
    else {
      await page.locator('button').filter({ hasText: /^Accept all$/ }).first().click({ force: true });
      await page.waitForTimeout(2500);
      const sub = page.locator('button').filter({ hasText: /^Submit$/ });
      if (await sub.count()) { await sub.first().click({ force: true }); console.log('accepted + submitted'); }
      else console.log('accepted (no Submit button appeared — verify via API)');
      await page.waitForTimeout(5000);
    }
  } else if (cmd === 'reject') {
    if (!(await pendingCount(page))) console.log('nothing pending');
    else {
      await page.locator('button').filter({ hasText: /^Reject all$/ }).first().click({ force: true });
      await page.waitForTimeout(3000);
      console.log('rejected');
    }
  } else if (cmd === 'shot') {
    await page.screenshot({ path: arg || 'conductor.png' });
    console.log(`saved ${arg || 'conductor.png'}`);
  } else if (cmd === 'reload') {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    console.log('reloaded — stale client state discarded');
  } else {
    console.error('usage: conductor.mjs status|open|send|wait|read|pending|accept|reject|shot|reload');
    process.exit(2);
  }
} finally {
  await b.close();
}
