---
name: pme-cdp
description: Use when a task needs the PME identity's logged-in browser session (chris@primemarketingexperts.com) — Gmail, Fireflies, Netlify, Google Drive/Chat, Retell dashboard. Reads/drives the ALREADY-RUNNING pme chrome-cdp instance via Playwright connectOverCDP. Never launch a fresh browser for PME-authed sites.
---

# PME CDP — drive the live PME browser session

The PME Chrome identity (`chris@primemarketingexperts.com`) runs as a persistent
chrome-cdp instance holding real logins: PME Gmail, Fireflies, Netlify, Drive,
Retell dashboard. Connect to IT — a fresh Playwright/Chromium gets bot-blocked
and is logged out.

**Retell = PME, always.** All Retell work (dashboard, QA cohorts, billing,
support email threads) lives in the PME account and this browser identity —
never look for Retell state in cng or any other identity.

## Rules

1. **Port is a registry value, not a constant.** Resolve every session:
   ```bash
   chrome-cdp list          # IDENTITY / PORT / STATE / ACCOUNT — single source of truth
   ```
   Take the `pme` row's PORT. If STATE is stopped: `chrome-cdp pme` starts it
   (user may need to be present for any expired logins).
2. **Confirm the identity before driving it**:
   ```bash
   curl -s http://127.0.0.1:<PORT>/json/list   # tab titles/URLs prove which account is live
   ```
3. **Playwright LIBRARY, not Playwright MCP tools.** MCP browser tools spawn an
   isolated unauthenticated browser. Use `connectOverCDP` from any local
   node_modules that has playwright (find one:
   `ls <repo>/node_modules/playwright`) and point `PLAYWRIGHT_DIR` at it.
4. **Sensitive data**: extract the facts you need; never persist full mailbox
   dumps or bodies with client data outside the task's deliverable.
5. Close pages you opened; `browser.close()` on a CDP connection only detaches,
   it does not kill the user's Chrome — still call it to free the socket.

## Canonical script pattern (validated 2026-08-04, Gmail read)

```js
// run: node script.mjs   (CDP_PORT from chrome-cdp list)
const { chromium } = await import(`${process.env.PLAYWRIGHT_DIR}/node_modules/playwright/index.mjs`);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CDP_PORT}`);
const ctx = browser.contexts()[0];          // the real profile context w/ cookies
const page = await ctx.newPage();
await page.goto('https://mail.google.com/mail/u/0/#search/' +
  encodeURIComponent('from:retellai.com'), { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);            // Gmail is an SPA; selectors below
// thread rows:   tr.zA   (from: .yX .yW span[email], subj: .y6 span span, date: .xW span[title])
// open thread:   page.click('tr.zA')
// message bodies: div.a3s (innerText, one per message in thread)
await page.close(); browser.close();
```

Working reference script (this exact pattern, ran clean):
`~/.claude/skills/pme-cdp/references/read-gmail.mjs`

## Gotchas

- Gmail search URL form `#search/<urlencoded query>` accepts full Gmail query
  syntax (`from:`, `newer_than:`, quoted phrases).
- ESM import of playwright from a script OUTSIDE a project dir fails module
  resolution — import by absolute path to `playwright/index.mjs` (as above).
- The `cng` identity (port differs — check registry) is the personal account
  (a personal Gmail); PME mail is NOT there. Wrong identity reads as
  "no results", not an error — verify identity first (rule 2).
- Raw-CDP (websocket + Runtime.evaluate) fallback recipe lives in the Hermes
  skill `~/hermes-local/.hermes/skills/software-development/cdp-running-browser/SKILL.md`
  — use it if Playwright attach stalls (seen once on port 9223).

## Running on Claude, Codex and ChatGPT

Tool-neutral, but machine-specific: it needs a Chrome already running with remote debugging (the `chrome-cdp` helper) and logged into the right account. "Playwright MCP tools" means any browser tool that launches its own fresh browser, in Claude, Codex or ChatGPT alike: don't use those, attach over CDP instead. Set `PLAYWRIGHT_DIR` to a project that has Playwright installed.
