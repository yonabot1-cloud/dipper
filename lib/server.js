import { createClient } from '@supabase/supabase-js';
import * as webpushNS from 'web-push';
const webpush = webpushNS.default || webpushNS;
import { extract } from './extract.js';
import { fetchText } from './fetchPage.js';
import { findOldPrices } from './history.js';
import { canonicalize } from './stores.js';
import { STORE_NAMES } from './stores.js';

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

export async function checkLivePrice(product) {
  const r = await fetchText(product.url, { timeout: 15000 });
  if (!r.text) return { error: `Could not reach ${STORE_NAMES[product.store]} (${r.error || r.status})` };
  const x = extract(r.text, product.store);
  if (x.blocked) return { error: `${STORE_NAMES[product.store]} asked for a robot check`, ...x };
  if (x.price == null) return { error: 'Price not found on page', ...x };
  return x;
}

export async function refreshProduct(db, product) {
  const now = new Date().toISOString();
  const x = await checkLivePrice(product);
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
  if (!c) {
    await db.from('products').update({ backfilled_at: new Date().toISOString(), backfill_note: 'unrecognized url' }).eq('id', product.id);
    return 0;
  }
  const res = await findOldPrices({ store: product.store, candidates: c.candidates, budgetMs });
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
  const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const name = (product.title || 'Your item').slice(0, 60);

  for (const w of watches) {
    const target = w.target_price != null ? Number(w.target_price) : null;
    const lastSent = w.last_notified_price != null ? Number(w.last_notified_price) : null;
    let message = null;

    if (target != null && price <= target && (lastSent == null || price < lastSent)) {
      message = { title: `It dipped under ${money(target)}`, body: `${name} is ${money(price)} at ${STORE_NAMES[product.store]}.` };
    } else if (w.any_drop && prevPrice != null && price < prevPrice - 0.004 && (lastSent == null || price < lastSent)) {
      message = { title: `Price drop: ${money(prevPrice)} → ${money(price)}`, body: `${name} at ${STORE_NAMES[product.store]}.` };
    }

    if (message) {
      if (!keys) {
        keys = await vapid(db);
        webpush.setVapidDetails(site || 'mailto:alerts@example.com', keys.publicKey, keys.privateKey);
      }
      const { data: subs } = await db.from('push_subs').select('*').eq('user_id', w.user_id);
      for (const s of subs || []) {
        try {
          await webpush.sendNotification(s.sub, JSON.stringify({ ...message, url: `/item/${product.id}` }));
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) await db.from('push_subs').delete().eq('id', s.id);
        }
      }
      await db.from('watches').update({ last_notified_price: price }).eq('id', w.id);
    } else if (target != null && price > target && lastSent != null) {
      // Back above the target: re-arm so the next dip notifies again.
      await db.from('watches').update({ last_notified_price: null }).eq('id', w.id);
    }
  }
}
