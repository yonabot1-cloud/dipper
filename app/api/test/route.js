// Temporary diagnostics: checks one product link without saving anything.
import { canonicalize } from '@/lib/stores';
import { fetchText } from '@/lib/fetchPage';
import { extract } from '@/lib/extract';
import { findOldPrices } from '@/lib/history';
import { targetPrice } from '@/lib/target';
import { checkLivePrice } from '@/lib/server';
import { ssHistory, ssFind, slugHints, ssStorePrice } from '@/lib/sources';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const u = new URL(req.url).searchParams.get('url');
  const c = canonicalize(u || '');
  if (!c) return Response.json({ error: 'not a supported product link' }, { status: 400 });
  const t0 = Date.now();
  const via = new URL(req.url).searchParams.get('via');
  if (via) {
    let target = c.url;
    let opts = { timeout: 60000 };
    if (via === 'jina') { target = 'https://r.jina.ai/' + c.url; opts.headers = { 'x-return-format': 'html', 'x-timeout': '40', accept: 'text/html' }; }
    if (via === 'jina-md') { target = 'https://r.jina.ai/' + c.url; opts.headers = { 'x-timeout': '40' }; }
    if (via === 'spn') { target = 'https://web.archive.org/save/' + c.url; }
    const r = await fetchText(target, opts);
    const x = extract(r.text || '', c.store);
    const md = via === 'jina-md' ? (r.text || '').slice(0, 1500) : undefined;
    return Response.json({ via, status: r.status, bytes: (r.text || '').length, finalUrl: (r.finalUrl || '').slice(0, 120), blocked: x.blocked, price: x.price, title: x.title, hasImage: !!x.image, md, err: r.error, ms: Date.now() - t0 });
  }
  if (new URL(req.url).searchParams.get('find')) {
    const product = { id: 0, url: c.url, store: c.store, hint: JSON.stringify(slugHints(u)) };
    let found = null, err = null, offer = null;
    try { found = await ssFind(product, null); if (found) offer = await ssStorePrice(found.ssid, c.store); } catch (e) { err = String(e.message || e); }
    return Response.json({ hints: slugHints(c.url), url: c.url, found, offer, err });
  }
  if (new URL(req.url).searchParams.get('full')) {
    const product = { id: 0, url: c.url, store: c.store, hint: JSON.stringify(slugHints(u)) };
    const live = await checkLivePrice(product, null);
    let hist = [];
    if (product.ss_id && new URL(req.url).searchParams.get('history') !== '0') hist = await ssHistory(product.ss_id, c.store, 2);
    hist.sort((a, b) => a.seen_at.localeCompare(b.seen_at));
    const vals = hist.map((p) => p.price);
    return Response.json({ store: c.store, price: live.price, source: live.source, error: live.error, title: live.title, hasImage: !!live.image, ss: product.ss_id || null, asin: product.asin || null, ssHistory: { count: hist.length, from: hist[0]?.seen_at?.slice(0, 10), low: vals.length ? Math.min(...vals) : null, high: vals.length ? Math.max(...vals) : null }, ms: Date.now() - t0 });
  }
  const r = await fetchText(c.url);
  const live = extract(r.text || '', c.store);
  if (c.store === 'target' && live.price == null) { const t = await targetPrice(c.url, r.text); if (t) Object.assign(live, { price: t.price, title: live.title || t.title, image: live.image || t.image, via: 'redsky' }); }
  const t1 = Date.now();
  const sp = new URL(req.url).searchParams;
  if (sp.get('debug')) {
    const html = r.text || '';
    const keys = (sp.get('keys') || 'a-offscreen,priceToPay,corePrice,priceAmount,current_retail,apiKey,price').split(',');
    const snips = {};
    for (const k of keys) {
      const out = []; let i = -1;
      while ((i = html.indexOf(k, i + 1)) !== -1 && out.length < 4) out.push(html.slice(Math.max(0, i - 120), i + 220));
      snips[k] = out;
    }
    let cc = null;
    if (sp.get('cc')) {
      const ci = await fetchText('https://index.commoncrawl.org/collinfo.json', { timeout: 15000 });
      let first = null;
      try { const list = JSON.parse(ci.text); first = list[0]; const q = await fetchText(first['cdx-api'] + '?url=' + encodeURIComponent(c.candidates[0]) + '&output=json', { timeout: 20000 }); cc = { infoStatus: ci.status, first: first.id, qStatus: q.status, q: (q.text || q.error || '').slice(0, 400) }; } catch (e) { cc = { infoStatus: ci.status, err: String(e), body: (ci.text || ci.error || '').slice(0, 200) }; }
    }
    return Response.json({ status: r.status, bytes: html.length, snips, cc });
  }
  const wantHistory = new URL(req.url).searchParams.get('history') !== '0';
  let history = null;
  if (wantHistory) {
    const h = await findOldPrices({ store: c.store, candidates: c.candidates, budgetMs: 200000 });
    const pts = h.points.sort((a, b) => a.seen_at.localeCompare(b.seen_at));
    history = { note: h.note, count: pts.length, first: pts[0], last: pts[pts.length - 1], low: Math.min(...pts.map((p) => p.price)), high: Math.max(...pts.map((p) => p.price)), title: h.title };
  }
  return Response.json({
    store: c.store,
    url: c.url,
    live: { status: r.status, bytes: (r.text || '').length, blocked: live.blocked, price: live.price, title: live.title, image: live.image, ms: t1 - t0, err: r.error },
    history,
    ms: Date.now() - t0,
  });
}
