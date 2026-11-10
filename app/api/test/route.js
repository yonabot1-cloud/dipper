// Temporary diagnostics: checks one product link without saving anything.
import { canonicalize } from '@/lib/stores';
import { fetchText } from '@/lib/fetchPage';
import { extract } from '@/lib/extract';
import { findOldPrices } from '@/lib/history';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const u = new URL(req.url).searchParams.get('url');
  const c = canonicalize(u || '');
  if (!c) return Response.json({ error: 'not a supported product link' }, { status: 400 });
  const t0 = Date.now();
  const r = await fetchText(c.url);
  const live = extract(r.text || '', c.store);
  const t1 = Date.now();
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
