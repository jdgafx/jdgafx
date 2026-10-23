// Read Retell support reply from PME Gmail via CDP (port from chrome-cdp list)
// PLAYWRIGHT_DIR = any project with playwright in node_modules (default: current directory)
const { chromium } = await import(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/node_modules/playwright/index.mjs`);

const PORT = process.env.CDP_PORT || '9222';
const QUERY = process.env.GMAIL_QUERY || 'from:retellai.com';

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
  await page.goto(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(QUERY)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);

  // thread rows
  const rows = await page.$$eval('tr.zA', trs => trs.slice(0, 10).map(tr => ({
    from: tr.querySelector('.yX .yW span')?.getAttribute('email') || tr.querySelector('.yX')?.textContent?.trim(),
    subj: tr.querySelector('.y6 span span')?.textContent?.trim() || tr.querySelector('.y6')?.textContent?.trim(),
    date: tr.querySelector('.xW span')?.getAttribute('title') || tr.querySelector('.xW')?.textContent?.trim(),
  })));
  console.log('THREADS:', JSON.stringify(rows, null, 1));

  if (rows.length) {
    await page.click('tr.zA'); // open newest
    await page.waitForTimeout(4000);
    const bodies = await page.$$eval('div.a3s', ds => ds.map(d => d.innerText));
    console.log('=== MESSAGES (' + bodies.length + ') ===');
    for (const b of bodies) console.log('--- MSG ---\n' + b.slice(0, 6000));
  }
} finally {
  await page.close();
  browser.close();
}
