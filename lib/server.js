import { createClient } from '@supabase/supabase-js';
import * as webpushNS from 'web-push';
const webpush = webpushNS.default || webpushNS;
import { extract } from './extract.js';
import { fetchText } from './fetchPage.js';
import { findOldPrices } from './history.js';
import { targetPrice } from './target.js';
import { ssFind, ssStorePrice, ssHistory, amazonCard, serpApiProduct, bestBuyApi } from './sources.js';
import { canonicalize } from './stores.js';
import { STORE_NAMES, storeLabel } from './stores.js';
import { sendPriceEmail } from './email.js';

export function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

export function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl() || !key) throw new Error('Database is not connected yet.');
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function userFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error) return null;
  return data.user;
}

// ---------- Live price check ----------

export async function checkLivePrice(product, db) {
  const name = storeLabel(product);
  let x = { price: null, title: null, image: null };
  let error = null;

  // 1) The store page itself
  const r = await fetchText(product.url, { timeout: 15000 });
  if (r.text) {
    x = extract(r.text, product.store);
    if (product.store === 'target' && x.price == null) {
      const t = await targetPrice(product.url, r.text).catch(() => null);
      if (t) x = { ...x, price: t.price ?? x.price, title: x.title || t.title, image: x.image || t.image, blocked: false };
    }
    if (x.blocked) error = `${name} blocked the check`;
  } else error = `Could not reach ${name}`;
  if (x.price != null) return { ...x, source: 'store' };
  if (product.store === 'other') {
    // Backup for other websites: ShopSavvy's record of this site's price
    if (/error page|just a moment|robot or human|access denied/i.test(x.title || '')) x.title = null;
    try {
      const f = await ssFind(product, x.title);
      if (f) {
        const o = await ssStorePrice(f.ssid, name);
        if (!x.title) x.title = f.title;
        if (o && o.ageDays <= 3) return { ...x, price: o.price, source: 'shopsavvy' };
      }
    } catch {}
    return { ...x, price: null, error: error || `Couldn't find a price on ${name}` };
  }
  // A blocked or error page's title/photo isn't the product's.
  if (/error page|robot or human|access denied|page not found|something went wrong/i.test(x.title || '')) x.title = null;
  if (x.blocked) x.image = null;

  // 2) Keyed sources (only active once their key is added in Vercel)
  try {
    const k = (await serpApiProduct(db, product)) || (await bestBuyApi(product));
    if (k && k.price != null) return { price: k.price, title: k.title || x.title, image: k.image || x.image, source: 'api' };
    if (k?.title && !x.title) x.title = k.title;
    if (k?.image && !x.image) x.image = k.image;
  } catch {}

  // 3) ShopSavvy: this store's current offer
  try {
    let ss = product.ss_id ? { ssid: product.ss_id, asin: product.asin } : await ssFind(product, product.title || x.title);
    if (ss) {
      if (!product.ss_id && db) await db.from('products').update({ ss_id: ss.ssid, asin: ss.asin || null }).eq('id', product.id);
      product.ss_id = ss.ssid;
      product.asin = ss.asin || product.asin;
      if (!x.title && ss.title) x.title = ss.title;
      const o = await ssStorePrice(ss.ssid, product.store);
      // 4) Photo + name from the matching Amazon page when the store hid them
      if ((!x.image || !x.title) && product.asin && product.store !== 'amazon') {
        const a = await amazonCard(product.asin).catch(() => null);
        if (a) { x.image = x.image || a.image; x.title = x.title || a.title; }
      }
      if (o && o.ageDays <= 10) return { ...x, price: o.price, source: 'shopsavvy' };
      if (o) error = `Latest ${name} price we could find is ${Math.round(o.ageDays)} days old`;
    }
  } catch {}

  return { ...x, price: null, error: error || 'Price not found' };
}

export async function refreshProduct(db, product) {
  const x = await checkLivePrice(product, db);
  return recordResult(db, product, x);
}

// Saves one price check result (from Vercel or from the browser checker on GitHub).
export async function recordResult(db, product, x) {
  const now = new Date().toISOString();
  const patch = { last_checked: now };
  if (x.title && !product.title) patch.title = x.title;
  if (x.image && !product.image) patch.image = x.image;

  if (x.error && x.price == null) {
    patch.last_error = x.error;
    await db.from('products').update(patch).eq('id', product.id);
    return { product: { ...product, ...patch }, price: null };
  }

  patch.current_price = x.price;
  patch.last_error = null;
  if (x.source) patch.price_source = x.source;
  await db.from('products').update(patch).eq('id', product.id);

  // Save a point when the price changed, or once a day so the graph stays continuous.
  const { data: last } = await db
    .from('prices')
    .select('price, seen_at')
    .eq('product_id', product.id)
    .eq('source', 'live')
    .order('seen_at', { ascending: false })
    .limit(1);
  const prev = last?.[0];
  const stale = !prev || Date.now() - new Date(prev.seen_at).getTime() > 20 * 3600e3;
  if (!prev || Number(prev.price) !== x.price || stale) {
    await db.from('prices').insert({ product_id: product.id, price: x.price, seen_at: now, source: 'live' });
  }
  const updated = { ...product, ...patch };
  await sendAlerts(db, updated, x.price, prev ? Number(prev.price) : null);
  return { product: updated, price: x.price };
}

// ---------- Old prices ----------

export async function backfillProduct(db, product, budgetMs = 150000) {
  const c = canonicalize(product.url);
  if (!c || product.store === 'other') {
    await db.from('products').update({ backfilled_at: new Date().toISOString(), backfill_note: 'unrecognized url' }).eq('id', product.id);
    return 0;
  }
  const [res, ssPoints] = await Promise.all([
    findOldPrices({ store: product.store, candidates: c.candidates, budgetMs }),
    (async () => {
      try {
        let id = product.ss_id;
        if (!id) {
          const f = await ssFind(product, product.title);
          if (f) {
            id = f.ssid;
            await db.from('products').update({ ss_id: f.ssid, asin: f.asin || null }).eq('id', product.id);
            if (!product.image && f.asin && product.store !== 'amazon') {
              const a = await amazonCard(f.asin).catch(() => null);
              if (a?.image) await db.from('products').update({ image: a.image, title: product.title || a.title }).eq('id', product.id);
            }
          }
        }
        return id ? await ssHistory(id, product.store, 2) : [];
      } catch {
        return [];
      }
    })(),
  ]);
  res.points.push(...ssPoints);
  res.note += `; shopsavvy: ${ssPoints.length} prices`;
  if (res.points.length) {
    await db.from('prices').upsert(
      res.points.map((p) => ({ ...p, product_id: product.id })),
      { onConflict: 'product_id,seen_at,source', ignoreDuplicates: true }
    );
  }
  const patch = { backfilled_at: new Date().toISOString(), backfill_note: res.note };
  if (!product.title && res.title) patch.title = res.title;
  if (!product.image && res.image) patch.image = res.image;
  // If the live check was blocked, show the most recent archived price until a live one comes in.
  if (product.current_price == null && res.points.length) {
    const latest = [...res.points].sort((a, b) => b.seen_at.localeCompare(a.seen_at))[0];
    patch.current_price = latest.price;
  }
  await db.from('products').update(patch).eq('id', product.id);
  return res.points.length;
}

// ---------- Notifications ----------

export async function vapid(db) {
  const { data } = await db.from('app_config').select('key,value').in('key', ['vapid_public', 'vapid_private']);
  let pub = data?.find((r) => r.key === 'vapid_public')?.value;
  let priv = data?.find((r) => r.key === 'vapid_private')?.value;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    await db.from('app_config').upsert(
      [
        { key: 'vapid_public', value: keys.publicKey },
        { key: 'vapid_private', value: keys.privateKey },
      ],
      { onConflict: 'key', ignoreDuplicates: true }
    );
    const again = await db.from('app_config').select('key,value').in('key', ['vapid_public', 'vapid_private']);
    pub = again.data?.find((r) => r.key === 'vapid_public')?.value;
    priv = again.data?.find((r) => r.key === 'vapid_private')?.value;
  }
  return { publicKey: pub, privateKey: priv };
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendAlerts(db, product, price, prevPrice) {
  const { data: watches } = await db.from('watches').select('*').eq('product_id', product.id);
  if (!watches?.length) return;
  let keys = null;
  const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://dipper-alpha.vercel.app');
  const name = (product.title || 'Your item').slice(0, 60);
  const store = storeLabel(product);

  for (const w of watches) {
    const target = w.target_price != null ? Number(w.target_price) : null;
    const lastSent = w.last_notified_price != null ? Number(w.last_notified_price) : null;
    let message = null;
    let hitTarget = false;

    if (target != null && price <= target && (lastSent == null || price < lastSent)) {
      message = { title: `It dipped under ${money(target)}`, body: `${name} is ${money(price)} at ${store}.` };
      hitTarget = true;
    } else if (w.any_drop && prevPrice != null && price < prevPrice - 0.004 && (lastSent == null || price < lastSent)) {
      message = { title: `Price drop: ${money(prevPrice)} → ${money(price)}`, body: `${name} at ${store}.` };
    }

    if (message) {
      if (w.notify_push !== false) {
        if (!keys) {
          keys = await vapid(db);
          webpush.setVapidDetails(site, keys.publicKey, keys.privateKey);
        }
        const { data: subs } = await db.from('push_subs').select('*').eq('user_id', w.user_id);
        for (const s of subs || []) {
          try {
            await webpush.sendNotification(s.sub, JSON.stringify({ ...message, url: `/item/${product.id}` }));
          } catch (err) {
            if (err?.statusCode === 404 || err?.statusCode === 410) await db.from('push_subs').delete().eq('id', s.id);
          }
        }
      }
      if (w.notify_email) {
        let to = w.email;
        if (!to) {
          const u = await db.auth.admin.getUserById(w.user_id).catch(() => null);
          to = u?.data?.user?.email;
        }
        await sendPriceEmail({
          to,
          title: product.title,
          store,
          price,
          previous: prevPrice,
          target: hitTarget ? target : null,
          image: product.image,
          itemUrl: `${site}/item/${product.id}`,
          storeUrl: product.url,
        }).catch((e) => console.error('email failed', e?.message));
      }
      await db.from('watches').update({ last_notified_price: price }).eq('id', w.id);
    } else if (target != null && price > target && lastSent != null) {
      // Back above the target: re-arm so the next dip notifies again.
      await db.from('watches').update({ last_notified_price: null }).eq('id', w.id);
    }
  }
}
