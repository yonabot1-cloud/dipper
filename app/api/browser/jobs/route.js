import { admin } from '@/lib/server';
import { fromGitHubActions } from '@/lib/githubAuth';

export const dynamic = 'force-dynamic';

// Stores that block plain server requests are checked with a real browser on GitHub.
const BROWSER_STORES = ['walmart', 'homedepot', 'bestbuy', 'lowes', 'costco', 'ebay'];

export async function GET(req) {
  if (!(await fromGitHubActions(req))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const db = admin();
  const cutoff = new Date(Date.now() - 5.5 * 3600e3).toISOString();
  const { data } = await db
    .from('products')
    .select('id, url, store, last_error, last_browser_check, current_price, title, image, watches!inner(id)')
    .or(`last_browser_check.is.null,last_browser_check.lt.${cutoff}`)
    .order('last_browser_check', { ascending: true, nullsFirst: true })
    .limit(200);
  const jobs = [...new Map((data || []).map((p) => [p.id, p])).values()]
    .filter((p) => BROWSER_STORES.includes(p.store) || p.last_error || p.current_price == null)
    .slice(0, 60)
    .map(({ id, url, store }) => ({ id, url, store }));
  return Response.json({ jobs });
}
