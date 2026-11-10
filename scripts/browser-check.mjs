// Runs on GitHub Actions: opens store pages in real Chrome and sends prices to Dipper.
import { chromium } from 'playwright';
import { extract } from '../lib/extract.js';

const SITE = process.env.SITE_URL || 'https://dipper-alpha.vercel.app';

async function oidcToken() {
  const url = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=dipper-price-checker`;
  const r = await fetch(url, { headers: { authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  return (await r.json()).value;
}

const TEST = (process.env.TEST_URLS || '').trim();
const token = TEST ? null : await oidcToken();
const auth = { authorization: `Bearer ${token}` };
const storeOf = (u) => (u.match(/(amazon|walmart|target|homedepot|bestbuy|lowes|costco|ebay)\./) || [])[1];
const jobs = TEST
  ? TEST.split(/\s+/).map((url, i) => ({ id: i, url, store: storeOf(url) }))
  : (await (await fetch(`${SITE}/api/browser/jobs`, { headers: auth })).json()).jobs || [];
console.log(`${jobs.length} item(s) to check`);
if (!jobs.length) process.exit(0);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  locale: 'en-US',
  timezoneId: 'America/New_York',
  viewport: { width: 1366, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));

const results = [];
for (const job of jobs) {
  const page = await context.newPage();
  let row = { id: job.id };
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500 + Math.random() * 2000);
    let x = extract(await page.content(), job.store);
    if (x.price == null && !x.blocked) {
      await page.waitForTimeout(4000);
      x = extract(await page.content(), job.store);
    }
    row = { id: job.id, price: x.price, title: x.title, image: x.image, error: x.blocked ? 'robot check' : x.price == null ? 'price not found' : null };
  } catch (e) {
    row.error = String(e.message || e).slice(0, 120);
  }
  console.log(`${job.store.padEnd(10)} ${String(row.price ?? '-').padStart(9)}  ${row.error || 'ok'}  ${(row.title || '').slice(0, 60)}`);
  results.push(row);
  await page.close();
  await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
}
await browser.close();
if (TEST) process.exit(0);

const res = await fetch(`${SITE}/api/browser/results`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ results }),
});
console.log('saved:', await res.text());
