import { after } from 'next/server';
import { admin, userFromRequest, refreshProduct, backfillProduct } from '@/lib/server';
import { canonicalize, findUrlInText, isShortLink } from '@/lib/stores';
import { resolveShortLink } from '@/lib/fetchPage';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const user = await userFromRequest(req);
  if (!user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let url = findUrlInText(body.url);
  if (!url) return Response.json({ error: 'Paste a product link that starts with https://' }, { status: 400 });
  if (isShortLink(url)) url = await resolveShortLink(url);

  const c = canonicalize(url);
  if (!c) {
    return Response.json(
      { error: "That doesn't look like a product page from Amazon, Walmart, Target, Home Depot, Best Buy, Lowe's, Costco or eBay." },
      { status: 400 }
    );
  }

  const db = admin();
  let { data: product } = await db.from('products').select('*').eq('url', c.url).maybeSingle();
  if (!product) {
    const ins = await db.from('products').insert({ url: c.url, store: c.store }).select('*').single();
    if (ins.error) {
      const again = await db.from('products').select('*').eq('url', c.url).single();
      product = again.data;
    } else product = ins.data;
  }

  // Check today's price right away if we haven't in the last hour.
  const fresh = product.last_checked && Date.now() - new Date(product.last_checked).getTime() < 3600e3;
  if (!fresh) {
    const r = await refreshProduct(db, product);
    product = r.product;
  }

  const { data: existing } = await db.from('watches').select('id').eq('user_id', user.id).eq('product_id', product.id).maybeSingle();
  if (!existing) {
    await db.from('watches').insert({ user_id: user.id, product_id: product.id, added_price: product.current_price });
  }

  // Look up 2 years of old prices in the background, after replying.
  if (!product.backfilled_at) {
    const p = product;
    after(async () => {
      try {
        await backfillProduct(db, p, 200000);
      } catch (e) {
        console.error('backfill failed', e);
      }
    });
  }

  return Response.json({ id: product.id, already: !!existing });
}
