// Bring up a site's login screen and report which ways in it offers. Logs into nothing.
// Usage: node probe-login.mjs <site-url> [out.png]
// Finds the "Sign in / Log in" link if the URL isn't already a login page, clicks it,
// then lists: SSO buttons (Google, LinkedIn, Apple, Microsoft, GitHub, Facebook),
// email/password fields, one-time-code wording, sign-up and reset links. Saves a screenshot
// to show the user.
import { execSync } from 'node:child_process';

const [site, out = 'login-screen.png'] = process.argv.slice(2);
if (!site) { console.error('usage: node probe-login.mjs <site-url> [out.png]'); process.exit(2); }

const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(`${root}/playwright/index.mjs`);
const chrome = execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | sort -V | tail -1').toString().trim();

const browser = await chromium.launch({ executablePath: chrome, proxy: { server: process.env.HTTPS_PROXY } });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(site, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('nav:', e.message.split('\n')[0]));

const hasPassword = async () => (await p.locator('input[type=password]').count()) > 0;
const loginLink = /^\s*(sign in|log ?in|login|sign on|my account)\s*$/i;
if (!(await hasPassword())) {
  // Some sites render "Sign in" as a plain div/span with a click handler, so fall back to visible text.
  const link = p.getByRole('link', { name: loginLink })
    .or(p.getByRole('button', { name: loginLink }))
    .or(p.getByText(loginLink))
    .filter({ visible: true }).first();
  if (await link.count()) {
    await link.click().catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);
  } else {
    console.log('no Sign in / Log in link found on the page');
  }
}

// Still not on a login screen: try the usual paths.
const onLogin = async () => (await hasPassword()) ||
  /(sign in|log in|welcome back)/i.test(await p.locator('h1, h2, h3').allInnerTexts().then(t => t.join(' ')).catch(() => ''));
if (!(await onLogin())) {
  for (const path of ['/login', '/signin', '/sign-in', '/auth/login', '/account/login', '/users/sign_in']) {
    const r = await p.goto(new URL(path, site).href, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
    if (r && r.ok() && !/not found|404/i.test(await p.title()) && (await onLogin())) break;
  }
}

const text = await p.innerText('body').catch(() => '');
const found = [];
for (const sso of ['Google', 'LinkedIn', 'Apple', 'Microsoft', 'GitHub', 'Facebook']) {
  if (new RegExp(`(continue|sign in|log in|sign up)[^\\n]{0,15}${sso}`, 'i').test(text)) found.push(`SSO: ${sso}`);
}
if (await p.locator('input[type=email], input[name*=email i], input[placeholder*=email i]').count()) found.push('email field');
if (await hasPassword()) found.push('password field');
if (/password instead/i.test(text)) found.push('password behind "use password instead"');
if (/(verification|one-time|magic link|we.ll (email|send) you a (code|link)|enter (the )?code)/i.test(text)) found.push('email code / magic link');
if (/(phone|mobile number)/i.test(text)) found.push('phone option');
if (/forgot (your )?password/i.test(text)) found.push('password reset link');

console.log('login page:', p.url());
console.log('ways in:', found.length ? found.join(', ') : '(none detected; look at the screenshot)');
console.log('--- page text:');
console.log(text.slice(0, 1200));
await p.screenshot({ path: out });
console.log('screenshot:', out);
await browser.close();
