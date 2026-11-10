import { admin, recordResult } from '@/lib/server';
import { fromGitHubActions } from '@/lib/githubAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req) {
  if (!(await fromGitHubActions(req))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { results = [] } = await req.json();
  const db = admin();
  let saved = 0;
  for (const r of results.slice(0, 100)) {
    const { data: product } = await db.from('products').select('*').eq('id', r.id).maybeSingle();
    if (!product) continue;
    await db.from('products').update({ last_browser_check: new Date().toISOString() }).eq('id', r.id);
    const x = { price: r.price ?? null, title: r.title || null, image: r.image || null, error: r.price == null ? r.error || 'Price not found' : null };
    // Only overwrite with a failure if we have nothing better.
    if (x.price == null && product.current_price != null && !product.last_error) continue;
    await recordResult(db, product, x);
    if (x.price != null) saved++;
  }
  return Response.json({ saved });
}
