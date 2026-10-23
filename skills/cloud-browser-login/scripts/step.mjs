// Replay a list of actions on a page in one run (for wizards that restart on reload), then report.
// Usage: node step.mjs <url> '<json actions>' [profile-dir]
//   actions: {"fill":[selector,text]} {"click":selector} {"press":[selector,key]} {"wait":ms}
//   each action may also carry "wait": ms to pause after it (default 1500)
// Uses the profile left by session-login.mjs, so run that first. Prints visible text,
// form inputs, and saves step.png.
import { execSync } from 'node:child_process';

const [url, actionsJson = '[]', profile = './cloud-browser-profile'] = process.argv.slice(2);
if (!url) { console.error("usage: node step.mjs <url> '<json actions>' [profile-dir]"); process.exit(2); }
const actions = JSON.parse(actionsJson);

const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(`${root}/playwright/index.mjs`);
const chrome = execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | sort -V | tail -1').toString().trim();

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: chrome,
  headless: true,
  viewport: { width: 1440, height: 900 },
  proxy: { server: process.env.HTTPS_PROXY },
});
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(2500);

for (const [i, a] of actions.entries()) {
  try {
    if (a.fill) await p.locator(a.fill[0]).first().fill(a.fill[1]);
    if (a.click) await p.locator(a.click).first().click();
    if (a.press) await p.locator(a.press[0]).first().press(a.press[1]);
  } catch (e) {
    console.log(`action ${i} failed: ${JSON.stringify(a)}: ${e.message.split('\n')[0]}`);
    break;
  }
  await p.waitForTimeout(a.wait ?? 1500);
}
await p.waitForTimeout(2000);

console.log('url:', p.url());
console.log((await p.innerText('body')).slice(0, 3000));
console.log('--- inputs:');
for (const el of await p.locator('input, textarea, select').all()) {
  console.log(await el.evaluate(e => `${e.tagName} type=${e.type} name=${e.name} placeholder="${e.placeholder}" value="${e.type === 'password' ? '***' : e.value}"`));
}
await p.screenshot({ path: 'step.png' });
console.log('screenshot: step.png');
await ctx.close();
