import { admin, refreshProduct, backfillProduct } from '@/lib/server';
import { pool } from '@/lib/fetchPage';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const CHECK_EVERY_HOURS = 6;

// Called every 30 minutes by a free GitHub Actions schedule.
// It only does work that is due, so calling it extra times is harmless.
export async function GET() {
  const started = Date.now();
  const db = admin();

  // Simple lock so two runs don't overlap.
  const { data: lock } = await db.from('app_config').select('value').eq('key', 'worker_lock').maybeSingle();
  if (lock?.value && Date.now() - Number(lock.value) < 4.5 * 60e3) {
    return Response.json({ skipped: 'already running' });
  }
  await db.from('app_config').upsert({ key: 'worker_lock', value: String(Date.now()) });

  const report = { refreshed: 0, failed: 0, backfilled: 0 };
  try {
    // 1) Old prices for items that don't have them yet
    const { data: needBackfill } = await db
      .from('products')
      .select('*')
      .is('backfilled_at', null)
      .order('created_at', { ascending: true })
      .limit(2);
    for (const p of needBackfill || []) {
      if (Date.now() - started > 120e3) break;
      await backfillProduct(db, p, 100000);
      report.backfilled++;
    }

    // 2) Today's price for items not checked in the last few hours (only items someone watches)
    const cutoff = new Date(Date.now() - CHECK_EVERY_HOURS * 3600e3).toISOString();
    const { data: due } = await db
      .from('products')
      .select('*, watches!inner(id)')
      .or(`last_checked.is.null,last_checked.lt.${cutoff}`)
      .order('last_checked', { ascending: true, nullsFirst: true })
      .limit(80);
    const unique = [...new Map((due || []).map((p) => [p.id, p])).values()].map(({ watches, ...p }) => p);
    await pool(unique, 4, async (p) => {
      if (Date.now() - started > 250e3) return;
      const r = await refreshProduct(db, p);
      if (r.price != null) report.refreshed++;
      else report.failed++;
      await new Promise((res) => setTimeout(res, 400 + Math.random() * 800));
    });
  } finally {
    await db.from('app_config').upsert({ key: 'worker_lock', value: '0' });
  }
  return Response.json({ ...report, seconds: Math.round((Date.now() - started) / 1000) });
}
