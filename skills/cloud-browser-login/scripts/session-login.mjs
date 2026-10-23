// Log into a site by loading its saved localStorage (and optional cookies) from environment variables.
// Usage: node session-login.mjs <SESSION_VAR> <url-to-open> [profile-dir]
//   <SESSION_VAR>  name of an env var holding JSON.stringify(localStorage) from the user's browser
//   <SESSION_VAR minus _SESSION>_COOKIES (optional) holds a cookie-export JSON array for the same domain,
//   or a one-line "name=value; name2=value2" (e.g. LINKEDIN_COOKIES="li_at=AQEDA...")
// Prints the page URL and text, saves login-check.png. Never prints the secret.
import { execSync } from 'node:child_process';

const [varName, url, profile = './cloud-browser-profile'] = process.argv.slice(2);
if (!varName || !url) { console.error('usage: node session-login.mjs <SESSION_VAR> <url> [profile-dir]'); process.exit(2); }
// Sites like LinkedIn keep the login only in cookies, so <SITE>_COOKIES alone is enough.
const cookieVar = varName.replace(/_SESSION$/, '_COOKIES');
if (!process.env[varName] && !process.env[cookieVar]) { console.error(`neither ${varName} nor ${cookieVar} is set in this environment`); process.exit(1); }

const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(`${root}/playwright/index.mjs`);
const chrome = execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | sort -V | tail -1').toString().trim();

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: chrome,
  headless: true,
  viewport: { width: 1440, height: 900 },
  proxy: { server: process.env.HTTPS_PROXY },
});

if (process.env[cookieVar]) {
  // Either a cookie-export JSON array, or a short one-line "name=value; name2=value2"
  // (full exports are often too big for an environment variable; the login cookie alone is enough).
  let text = process.env[cookieVar].trim();
  const domain = '.' + new URL(url).hostname.replace(/^www\./, '');
  // A bare value with no "=" is taken as LinkedIn's li_at (users often paste only the value).
  if (!text.startsWith('[') && !text.includes('=')) {
    if (!/linkedin\.com$/.test(new URL(url).hostname)) { console.error(`${cookieVar} has no name=value pairs`); process.exit(1); }
    text = 'li_at=' + text;
  }
  const raw = text.startsWith('[') ? JSON.parse(text) : text.split(/;\s*/).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain, path: '/', secure: true };
  });
  await ctx.addCookies(raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
    secure: !!c.secure, httpOnly: !!c.httpOnly,
    sameSite: ({ no_restriction: 'None', lax: 'Lax', strict: 'Strict' })[c.sameSite] || 'Lax',
    ...(c.expirationDate ? { expires: Math.floor(c.expirationDate) } : {}),
  })));
  console.log(`cookies loaded from ${cookieVar}: ${raw.length}`);
}

const page = await ctx.newPage();
if (process.env[varName]) {
  await page.goto(new URL(url).origin + '/', { waitUntil: 'domcontentloaded' });
  const n = await page.evaluate(s => {
    const o = JSON.parse(s);
    for (const [k, v] of Object.entries(o)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    return Object.keys(o).length;
  }, process.env[varName]);
  console.log(`localStorage keys loaded from ${varName}: ${n}`);
}

// domcontentloaded plus a pause: heavy sites (LinkedIn) never reach networkidle.
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('nav:', e.message.split('\n')[0]));
await page.waitForTimeout(4000);
await page.waitForTimeout(2500);
console.log('url:', page.url());
console.log((await page.innerText('body')).slice(0, 2000));
await page.screenshot({ path: 'login-check.png' });
console.log('screenshot: login-check.png');
await ctx.close();
