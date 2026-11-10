// All the places Dipper gets product data from, in order of reliability.
//  1. The store page itself (works for Amazon; Target via its price service)
//  2. Official / paid-free APIs that switch on with a key: SerpApi (Walmart, Home Depot, eBay), Best Buy API
//  3. ShopSavvy (free): store-specific current offers + price history, matched by ASIN / model / name
//  4. The matching Amazon page (found via ShopSavvy's ASIN) for the photo and name

import { callTool } from './shopsavvy.js';
import { fetchText } from './fetchPage.js';
import { extract } from './extract.js';
import { canonicalize } from './stores.js';

export const STORE_DOMAINS = {
  amazon: 'amazon.com',
  walmart: 'walmart.com',
  target: 'target.com',
  homedepot: 'homedepot.com',
  bestbuy: 'bestbuy.com',
  lowes: 'lowes.com',
  costco: 'costco.com',
  ebay: 'ebay.com',
};
const STORE_LABELS = {
  amazon: /^amazon/i,
  walmart: /^walmart/i,
  target: /^target/i,
  homedepot: /home ?depot/i,
  bestbuy: /best ?buy/i,
  lowes: /lowe'?s/i,
  costco: /costco/i,
  ebay: /^ebay/i,
};

// ---------- helpers ----------

export function storeItemId(product) {
  const u = product.url;
  const m =
    product.store === 'amazon' ? u.match(/\/dp\/([A-Z0-9]{10})/i)
    : product.store === 'walmart' ? u.match(/\/ip\/(?:[^/]+\/)?(\d+)/)
    : product.store === 'homedepot' ? u.match(/\/p\/(?:[^/]+\/)?(\d{9})/)
    : product.store === 'bestbuy' ? u.match(/skuId=(\d+)/) || u.match(/\/(\d{7,8})(?:\.p)?/)
    : product.store === 'ebay' ? u.match(/\/itm\/(\d+)/)
    : product.store === 'target' ? u.match(/A-(\d+)/)
    : null;
  return m ? m[1] : null;
}

// Words from the link itself, e.g. ".../DEWALT-20V-MAX-...-DCK240C2/204373168" → name + model guess.
export function slugHints(url) {
  let path = '';
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {}
  const parts = path.split('/').filter((p) => /[a-z]/i.test(p) && p.length > 12 && /-/.test(p));
  const slug = parts.sort((a, b) => b.length - a.length)[0] || '';
  const words = slug.replace(/\.product\.\d+\.html$/, '').replace(/[-_]+/g, ' ').trim();
  const tokens = words.split(/\s+/);
  // Prefer hyphenated models straight from the slug, e.g. "WH-1000XM5", "DCK240C2"
  const raw = slug.match(/\b[A-Z]{1,5}-?\d{2,}[A-Z0-9]*(?:-[A-Z0-9]*\d[A-Z0-9]*)?\b/gi) || [];
  const okModel = (t) => (t.match(/[A-Z]/gi) || []).length >= 2 && (t.match(/\d/g) || []).length >= 2 && t.replace(/-/g, '').length >= 5 && !/^\d+(in|qt|v|oz|lb|ft|gal|pc|piece|w|ah|mah)$/i.test(t);
  const fromRaw = [...raw].reverse().find(okModel);
  const model = fromRaw || [...tokens].reverse().find(okModel);
  return { words: words.slice(0, 120), model: model || null };
}

function money(s) {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0.5 && n < 200000 ? Math.round(n * 100) / 100 : null;
}

// ---------- ShopSavvy ----------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'with', 'for', 'in', 'of', 'a', 'to', 'new', 'black', 'white', 'pack', 'set']);

// Only accept a match when it's clearly the same product (model number or most name words agree).
function looksSame(found, reference, model) {
  const ft = norm(`${found.title} ${found.model || ''}`);
  const squash = (s) => norm(s).replace(/ /g, '');
  if (model) {
    const m = squash(model);
    if (squash(found.model).includes(m) || squash(found.title).includes(m)) return true;
    // a different model number in the found title means a different product
    if (found.model && squash(found.model) && !m.includes(squash(found.model))) return false;
  }
  const words = norm(reference).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return true;
  const hit = words.filter((w) => ft.includes(w)).length;
  return hit / words.length >= 0.6;
}

function parseLookup(text) {
  if (!text || /No product found/i.test(text)) return null;
  const get = (label) => (text.match(new RegExp(`- ${label}:\\s*(.+)`)) || [])[1]?.trim() || null;
  const title = (text.match(/\*\*([^*\n]{6,})\*\*\s*\n\s*\n\s*\*\*Details/) || [])[1]?.replace(/\.\.\.$/, '').trim() || null;
  return {
    title,
    brand: get('Brand'),
    model: get('Model') || get('MPN'),
    barcode: get('Barcode'),
    asin: get('Amazon ASIN'),
    ssid: get('ShopSavvy ID'),
  };
}

export async function ssFind(product, knownTitle) {
  let hints = slugHints(product.url);
  try {
    if (product.hint) hints = JSON.parse(product.hint);
  } catch {}
  const tries = [];
  if (product.store === 'amazon') tries.push(storeItemId(product));
  if (hints.model) tries.push(hints.model);
  tries.push(product.url);
  if (knownTitle) tries.push(knownTitle.slice(0, 100));
  else if (hints.words && hints.words.split(' ').length >= 3) tries.push(hints.words);
  const reference = knownTitle || hints.words || '';
  for (const id of [...new Set(tries.filter(Boolean))].slice(0, 3)) {
    try {
      const r = await callTool('product_lookup', { identifier: id });
      const p = parseLookup(r.text);
      if (p && looksSame(p, reference, hints.model)) return { ...p, matchedBy: id };
    } catch {}
  }
  return null;
}

function parseOffers(text) {
  const offers = [];
  for (const block of String(text || '').split(/\*\*Offer \d+:\*\*/).slice(1)) {
    const price = money((block.match(/- Price:\s*([^\n]+)/) || [])[1]);
    if (price == null) continue;
    offers.push({
      price,
      inStock: !/Availability:\s*out/i.test(block),
      used: /Condition:\s*(used|refurb)/i.test(block),
      seller: (block.match(/- Seller:\s*([^\n]+)/) || [])[1]?.trim() || null,
      at: (block.match(/Last checked:\s*([0-9T:.\-Z]+)/) || [])[1] || null,
    });
  }
  return offers;
}

// Today's price at this store according to ShopSavvy (store's own listing first, newest check).
export async function ssStorePrice(identifier, store) {
  const r = await callTool('product_offers_retailer', { identifier, retailer: STORE_DOMAINS[store] });
  const offers = parseOffers(r.text).filter((o) => !o.used);
  if (!offers.length) return null;
  offers.sort((a, b) => (a.seller ? 1 : 0) - (b.seller ? 1 : 0) || String(b.at).localeCompare(String(a.at)));
  const best = offers[0];
  const ageDays = best.at ? (Date.now() - new Date(best.at).getTime()) / 864e5 : 999;
  return { price: best.price, checkedAt: best.at, ageDays };
}

function parseHistory(text, store) {
  const points = [];
  const sections = String(text || '').split(/\n### /).slice(1);
  for (const sec of sections) {
    const name = sec.split('\n')[0].trim();
    if (!STORE_LABELS[store].test(name)) continue;
    for (const m of sec.matchAll(/- (\d{1,2})\/(\d{1,2})\/(\d{4}):\s*\$([\d,]+\.?\d*)/g)) {
      const price = money(m[4]);
      if (price == null) continue;
      points.push({ price, seen_at: new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12)).toISOString(), source: 'shopsavvy' });
    }
  }
  return points;
}

export async function ssHistory(identifier, store, years = 2) {
  const out = [];
  const day = (d) => d.toISOString().slice(0, 10);
  for (let i = 0; i < years; i++) {
    const end = new Date(Date.now() - i * 365 * 864e5);
    const start = new Date(end.getTime() - 365 * 864e5);
    try {
      const r = await callTool('product_price_history', { identifier, start_date: day(start), end_date: day(end), retailer: STORE_DOMAINS[store] });
      out.push(...parseHistory(r.text, store));
    } catch {}
  }
  // one point per day (lowest), so repeated rows don't skew the chart
  const byDay = new Map();
  for (const p of out) {
    const k = p.seen_at.slice(0, 10);
    if (!byDay.has(k) || byDay.get(k).price > p.price) byDay.set(k, p);
  }
  return [...byDay.values()];
}

// ---------- Amazon page as a photo / name source ----------

export async function amazonCard(asin) {
  if (!asin) return null;
  const r = await fetchText(`https://www.amazon.com/dp/${asin}`, { timeout: 15000 });
  if (!r.text) return null;
  const x = extract(r.text, 'amazon');
  return x.blocked ? null : x;
}

// ---------- Keyed sources (switch on when the key is added in Vercel) ----------

function deepFind(obj, test, depth = 0) {
  if (obj == null || depth > 8) return undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepFind(v, test, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const r = test(k, v);
      if (r !== undefined) return r;
    }
    for (const v of Object.values(obj)) {
      const r = deepFind(v, test, depth + 1);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

const SERP_ENGINES = { walmart: 'walmart_product', homedepot: 'home_depot_product', ebay: 'ebay_product' };

export async function serpApiProduct(db, product) {
  const key = process.env.SERPAPI_KEY;
  const engine = SERP_ENGINES[product.store];
  const id = storeItemId(product);
  if (!key || !engine || !id) return null;

  // Stay inside the free 250/month: count lookups per month.
  const month = new Date().toISOString().slice(0, 7);
  const cap = Number(process.env.SERPAPI_MONTHLY_LIMIT || 240);
  if (db) {
    const { data } = await db.from('app_config').select('value').eq('key', `serpapi_${month}`).maybeSingle();
    const used = Number(data?.value || 0);
    if (used >= cap) return { error: 'SerpApi monthly limit reached' };
    await db.from('app_config').upsert({ key: `serpapi_${month}`, value: String(used + 1) });
  }

  const r = await fetchText(`https://serpapi.com/search.json?engine=${engine}&product_id=${id}&api_key=${key}`, { timeout: 30000, headers: { accept: 'application/json' } });
  let j;
  try {
    j = JSON.parse(r.text);
  } catch {
    return null;
  }
  if (j.error) return { error: `SerpApi: ${j.error}` };
  const root = j.product_result || j.product_results || j;
  const price = deepFind(root, (k, v) => {
    if (['extracted_price', 'current_price', 'extracted_value'].includes(k) && typeof v === 'number') return v;
    if (k === 'price' && typeof v === 'number') return v;
    return undefined;
  });
  const title = deepFind(root, (k, v) => (k === 'title' && typeof v === 'string' ? v : undefined));
  const image = deepFind(root, (k, v) => (typeof v === 'string' && /^https:\/\/\S+\.(jpe?g|png|webp)/i.test(v) ? v : undefined));
  return { price: price ?? null, title: title || null, image: image || null };
}

export async function bestBuyApi(product) {
  const key = process.env.BESTBUY_API_KEY;
  const sku = storeItemId(product);
  if (!key || product.store !== 'bestbuy' || !sku) return null;
  const r = await fetchText(`https://api.bestbuy.com/v1/products(sku=${sku})?apiKey=${key}&show=sku,name,salePrice,regularPrice,image,largeFrontImage&format=json`, {
    timeout: 15000,
    headers: { accept: 'application/json' },
  });
  try {
    const p = JSON.parse(r.text).products?.[0];
    if (!p) return null;
    return { price: p.salePrice ?? p.regularPrice ?? null, title: p.name || null, image: p.largeFrontImage || p.image || null };
  } catch {
    return null;
  }
}

export { canonicalize };
