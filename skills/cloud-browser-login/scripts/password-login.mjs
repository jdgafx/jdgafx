// Log into a site's own email + password form using environment secrets. Never prints them.
// Usage: node password-login.mjs <PREFIX> <login-url> [after-login-url] [profile-dir]
//   reads <PREFIX>_EMAIL and <PREFIX>_PASSWORD, e.g. TURNFEAT -> TURNFEAT_EMAIL / TURNFEAT_PASSWORD
// Handles one-page forms and two-step ones (email -> Next -> password, including
// "use password instead" links). Stops and says so if the site then asks for a code.
// Saves login-result.png. Reuses the profile, so later scripts stay logged in.
import { execSync } from 'node:child_process';

const [prefix, loginUrl, afterUrl, profile = './cloud-browser-profile'] = process.argv.slice(2);
if (!prefix || !loginUrl) { console.error('usage: node password-login.mjs <PREFIX> <login-url> [after-login-url] [profile-dir]'); process.exit(2); }
const email = process.env[`${prefix}_EMAIL`], password = process.env[`${prefix}_PASSWORD`];
if (!email || !password) { console.error(`${prefix}_EMAIL and ${prefix}_PASSWORD must both be set`); process.exit(1); }

const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(`${root}/playwright/index.mjs`);
const chrome = execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | sort -V | tail -1').toString().trim();

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: chrome, headless: true, viewport: { width: 1440, height: 900 },
  proxy: { server: process.env.HTTPS_PROXY },
});
const p = await ctx.newPage();
await p.goto(loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(1500);

const visible = sel => p.locator(sel).filter({ visible: true }).first();
const emailBox = visible('input[type=email], input[name*=email i], input[id*=email i], input[placeholder*=email i], input[autocomplete=username], input[name*=user i]');
const pwBox = visible('input[type=password]');
const submit = visible('button[type=submit], input[type=submit], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button:has-text("Continue"), button:has-text("Next")');

if (await emailBox.count()) await emailBox.fill(email);
else console.log('no email/username field found; check the screenshot');

if (!(await pwBox.count())) {
  // Two-step form: submit the email first, then look for the password (or a link to it).
  if (await submit.count()) await submit.click().catch(() => {});
  await p.waitForTimeout(2500);
  const instead = p.getByText(/password instead|use (a |your )?password/i).first();
  if (await instead.count()) { await instead.click().catch(() => {}); await p.waitForTimeout(2000); }
}
if (await pwBox.count()) {
  await pwBox.fill(password);
  await pwBox.press('Enter');
} else {
  console.log('no password field appeared');
}
await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(3000);

const text = await p.innerText('body').catch(() => '');
if (/(verification code|enter (the )?code|we sent|check your (email|inbox|phone)|two-factor|2fa|authenticator)/i.test(text)) {
  console.log('SITE IS ASKING FOR A CODE: read it from Gmail if it went there, otherwise ask the user for the newest one.');
}
if (/(incorrect|invalid|wrong) (email|password|credentials)/i.test(text)) console.log('SITE SAYS THE LOGIN WAS WRONG');
if (afterUrl) await p.goto(afterUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
console.log('url:', p.url());
console.log(text.slice(0, 800));
await p.screenshot({ path: 'login-result.png' });
console.log('screenshot: login-result.png');
await ctx.close();
