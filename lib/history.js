// Finds old prices for a product from free public web archives:
//  - Internet Archive (Wayback Machine): saved copies of the product page over the years
//  - Common Crawl: a monthly public crawl of the web
// Each saved copy is read with the same price reader used for live pages.

import { gunzipSync } from 'node:zlib';
import { extract } from './extract.js';
import { fetchText, pool } from './fetchPage.js';

const ARCHIVE_UA = { 'user-agent': 'DipperPriceHistory/1.0 (+https://github.com/yonabot1-cloud/dipper)' };

function yyyymmdd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function tsToDate(ts) {
  return new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +(ts.slice(8, 10) || 12)));
}

// Keep at most one capture per ~2 weeks, newest first, up to `max`.
function spread(captures, max) {
  const sorted = [...captures].sort((a, b) => b.ts.localeCompare(a.ts));
  const out = [];
  let lastDay = null;
  for (const c of sorted) {
    const d = tsToDate(c.ts).getTime();
    if (lastDay == null || lastDay - d >= 13 * 864e5) {
      out.push(c);
      lastDay = d;
    }
    if (out.length >= max) break;
  }
  return out;
}

async function waybackCaptures(candidates, since) {
  const all = [];
  for (const c of candidates) {
    const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(c)}&output=json&from=${yyyymmdd(since)}&filter=statuscode:200&fl=timestamp,original&collapse=timestamp:8&limit=2000`;
    const r = await fetchText(q, { timeout: 20000, headers: ARCHIVE_UA });
    if (!r.ok) continue;
    try {
      const rows = JSON.parse(r.text || '[]');
      for (const row of rows.slice(1)) all.push({ ts: row[0], url: row[1], via: 'wayback' });
    } catch {}
  }
  return all;
}

let crawlListCache = null;
async function commonCrawlIndexes(since) {
  if (!crawlListCache) {
    const r = await fetchText('https://index.commoncrawl.org/collinfo.json', { timeout: 15000, headers: ARCHIVE_UA });
    try {
      crawlListCache = JSON.parse(r.text);
    } catch {
      crawlListCache = [];
    }
  }
  return crawlListCache.filter((c) => {
    const m = String(c.id).match(/CC-MAIN-(\d{4})-(\d{2})/);
    if (!m) return false;
    const approx = new Date(Date.UTC(+m[1], 0, 1 + (+m[2] - 1) * 7));
    return approx >= since;
  });
}

async function commonCrawlCaptures(candidates, since, deadline) {
  const idx = (await commonCrawlIndexes(since)).slice(0, 8);
  const jobs = [];
  for (const crawl of idx) for (const c of candidates) jobs.push({ crawl, c });
  const found = [];
  await pool(jobs, 4, async ({ crawl, c }) => {
    if (Date.now() > deadline) return;
    const r = await fetchText(`${crawl['cdx-api']}?url=${encodeURIComponent(c)}&output=json&filter=status:200`, {
      timeout: 25000,
      headers: ARCHIVE_UA,
    });
    if (!r.ok) return;
    for (const line of r.text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.filename && rec.offset && rec.length) {
          found.push({ ts: rec.timestamp, url: rec.url, via: 'commoncrawl', filename: rec.filename, offset: +rec.offset, length: +rec.length });
        }
      } catch {}
    }
  });
  return found;
}

async function readCommonCrawlRecord(cap) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://data.commoncrawl.org/${cap.filename}`, {
      headers: { ...ARCHIVE_UA, range: `bytes=${cap.offset}-${cap.offset + cap.length - 1}` },
      signal: ctrl.signal,
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const text = gunzipSync(buf).toString('utf8');
    // WARC headers, blank line, HTTP headers, blank line, body
    const parts = text.split('\r\n\r\n');
    return parts.slice(2).join('\r\n\r\n');
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function readWayback(cap) {
  const r = await fetchText(`https://web.archive.org/web/${cap.ts}id_/${cap.url}`, { timeout: 20000, headers: ARCHIVE_UA });
  return r.ok ? r.text : null;
}

// Returns { points: [{price, seen_at, source}], title, image, note }
export async function findOldPrices({ store, candidates, years = 2, budgetMs = 150000 }) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const since = new Date(Date.now() - years * 365 * 864e5);

  const [wb, cc] = await Promise.all([
    waybackCaptures(candidates, since).catch(() => []),
    commonCrawlCaptures(candidates, since, started + budgetMs * 0.4).catch(() => []),
  ]);

  const picks = [...spread(wb, 36), ...spread(cc, 16)];
  const points = [];
  let title = null;
  let image = null;

  await pool(picks, 3, async (cap) => {
    if (Date.now() > deadline) return;
    const html = cap.via === 'wayback' ? await readWayback(cap) : await readCommonCrawlRecord(cap);
    if (!html) return;
    const x = extract(html, store);
    if (x.title && !title) title = x.title;
    if (x.image && !image) image = x.image;
    if (x.price != null) {
      points.push({ price: x.price, seen_at: tsToDate(cap.ts).toISOString(), source: 'archive' });
    }
  });

  // Drop wild outliers (e.g. a misread accessory price): keep within 0.25x–4x of the median
  const sorted = points.map((p) => p.price).sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const clean = points.filter((p) => !med || (p.price >= med * 0.25 && p.price <= med * 4));

  const note = `archive: ${wb.length} wayback + ${cc.length} commoncrawl copies found, ${picks.length} read, ${clean.length} prices`;
  return { points: clean, title, image, note };
}
