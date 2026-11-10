'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb, api, money, STORE_NAMES, verdict, sparkPoints } from '@/lib/client';
import TopBar from './TopBar';
import { ProductImage, TrashIcon, BellIcon, Toast, Foot } from './Bits';

const FILTERS = ['all', 'amazon', 'walmart', 'target', 'homedepot', 'costco'];

export default function Watchlist({ session }) {
  const [rows, setRows] = useState(null);
  const [spark, setSpark] = useState({});
  const [filter, setFilter] = useState('all');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef();

  const showToast = useCallback((t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4200);
  }, []);

  const load = useCallback(async () => {
    const client = sb();
    const { data, error } = await client
      .from('watches')
      .select('id, target_price, any_drop, added_price, created_at, product:products(*)')
      .order('created_at', { ascending: false });
    if (error) return showToast(error.message);
    setRows(data || []);
    const ids = (data || []).map((w) => w.product?.id).filter(Boolean);
    if (ids.length) {
      const since = new Date(Date.now() - 730 * 864e5).toISOString();
      const { data: pts } = await client.from('prices').select('product_id, price, seen_at').in('product_id', ids).gte('seen_at', since).order('seen_at').limit(20000);
      const by = {};
      for (const p of pts || []) (by[p.product_id] ||= []).push(p);
      setSpark(by);
    }
  }, [showToast]);

  useEffect(() => {
    load();
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load]);

  // Keep refreshing while new items are still pulling their history.
  useEffect(() => {
    if (!rows) return;
    const pending = rows.some((w) => w.product && (!w.product.backfilled_at || w.product.current_price == null) && Date.now() - new Date(w.created_at).getTime() < 6 * 60e3);
    if (!pending) return;
    const t = setTimeout(load, 6000);
    return () => clearTimeout(t);
  }, [rows, load]);

  // Links shared to Dipper from another app (Android share sheet)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const shared = q.get('url') || q.get('text');
    if (shared) {
      history.replaceState(null, '', '/');
      add(shared);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(value) {
    const url = (value ?? link).trim();
    if (!url) return setNote({ err: true, text: 'Paste a product link first.' });
    setBusy(true);
    setNote({ text: 'Reading the store page…' });
    try {
      const r = await api('/api/track', { url });
      setLink('');
      setNote({ ok: true, text: r.already ? 'That one is already on your list.' : 'Added. Pulling up to two years of price history — it fills in over the next minute or two.' });
      await load();
    } catch (e) {
      setNote({ err: true, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(w) {
    const prev = rows;
    setRows(rows.filter((x) => x.id !== w.id));
    const { error } = await sb().from('watches').delete().eq('id', w.id);
    if (error) {
      setRows(prev);
      return showToast('Couldn’t delete — try again.');
    }
    showToast(`Deleted “${(w.product?.title || 'item').slice(0, 40)}”`);
  }

  const visible = useMemo(() => (rows || []).filter((w) => w.product && (filter === 'all' || w.product.store === filter)), [rows, filter]);
  const stores = useMemo(() => new Set((rows || []).map((w) => w.product?.store)), [rows]);
  const drops = (rows || []).filter((w) => w.product?.current_price != null && w.added_price != null && Number(w.product.current_price) < Number(w.added_price)).length;

  return (
    <>
      <TopBar session={session} onToast={showToast} />
      <main className="wrap">
        <section className="adder">
          <label htmlFor="add-link">Add a link</label>
          <form className="adder-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input
              id="add-link"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onPaste={(e) => {
                const t = e.clipboardData.getData('text');
                if (t && /^https?:\/\//.test(t.trim())) { e.preventDefault(); setLink(t.trim()); add(t.trim()); }
              }}
              placeholder="Paste any product link"
            />
            <button className="btn-mint" disabled={busy}>{busy ? 'Adding…' : 'Track it'}</button>
          </form>
          {note ? (
            <div className={`adder-note ${note.ok ? 'ok' : note.err ? 'err' : ''}`}>{note.text}</div>
          ) : (
            <div className="adder-note">We grab the photo, name and price automatically, plus up to two years of old prices.</div>
          )}
          <div className="store-strip">
            {Object.values(STORE_NAMES).map((n) => <span key={n}>{n}</span>)}
          </div>
        </section>

        <section className="list-head">
          <div>
            <p className="eyebrow">Your watchlist</p>
            <h1 className="big-title">
              {rows == null ? 'Loading…' : rows.length === 0 ? 'Nothing tracked yet.' : <>{rows.length} {rows.length === 1 ? 'item' : 'items'}.{drops > 0 && <> <em>{drops} got cheaper.</em></>}</>}
            </h1>
          </div>
          {rows && rows.length > 0 && (
            <nav className="chips" aria-label="Filter by store">
              {FILTERS.filter((f) => f === 'all' || stores.has(f)).map((f) => (
                <button key={f} type="button" className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : STORE_NAMES[f]}
                </button>
              ))}
            </nav>
          )}
        </section>

        {rows == null ? (
          <section className="grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</section>
        ) : rows.length === 0 ? (
          <section className="empty">
            <h2>Paste your first link.</h2>
            <p>Copy a product link from any of the stores above and paste it in the box. On your phone, use the store app’s Share button → Copy link.</p>
          </section>
        ) : (
          <section className="grid">
            {visible.map((w) => (
              <Card key={w.id} w={w} points={spark[w.product.id] || []} onDelete={() => remove(w)} />
            ))}
          </section>
        )}
        <Foot />
      </main>
      <Toast text={toast} />
    </>
  );
}

function Card({ w, points, onDelete }) {
  const p = w.product;
  const cur = p.current_price != null ? Number(p.current_price) : null;
  const added = w.added_price != null ? Number(w.added_price) : null;
  const v = verdict(points, cur);
  const recent = points.filter((x) => new Date(x.seen_at) > new Date(Date.now() - 90 * 864e5));
  const line = sparkPoints(recent.length >= 2 ? recent : points);
  let dir = 'flat', deltaText = 'No change yet';
  if (cur != null && added != null && Math.abs(cur - added) >= 0.01) {
    const diff = cur - added;
    dir = diff < 0 ? 'down' : 'up';
    deltaText = `${diff < 0 ? '▼' : '▲'} ${money(Math.abs(diff))} · ${Math.round((Math.abs(diff) / added) * 100)}%`;
  }
  if (cur == null) deltaText = p.last_error ? 'Retrying soon' : 'Checking…';
  const color = dir === 'down' ? '#08814A' : dir === 'up' ? '#B93A22' : '#4A4A55';
  const histYears = points.length ? (Date.now() - new Date(points[0].seen_at).getTime()) / (365 * 864e5) : 0;
  const sub = !p.backfilled_at ? 'Finding old prices…' : histYears >= 0.9 ? `History back to ${new Date(points[0].seen_at).getFullYear()}` : points.length ? `History since ${new Date(points[0].seen_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : 'Tracking from today';

  return (
    <article className="card">
      <a className="card-link" href={`/item/${p.id}`}>
        <div className="thumb">
          <ProductImage src={p.image} alt="" />
          <span className="store-tag">{STORE_NAMES[p.store]}</span>
          <span className={`verdict v-${v.key}`}>{v.label}</span>
        </div>
        <div className="card-body">
          <span className="m-meta">{STORE_NAMES[p.store]} · <span className={`verdict v-${v.key}`}>{v.label}</span></span>
          <div className="card-name">{p.title || 'Getting the name…'}</div>
          <div className="card-sub">{sub}</div>
          <div className="card-price-row" style={{ marginTop: 10 }}>
            <div>
              <div className="price-big">{money(cur)}</div>
              <span className={`delta d-${dir}`}>{deltaText}</span>
            </div>
            {line && (
              <svg width="108" height="44" viewBox="0 0 108 44" fill="none" aria-hidden="true">
                <polyline points={line} stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            )}
          </div>
        </div>
      </a>
      <div className="card-foot">
        <span className="alert-line">
          <BellIcon size={15} color="#5C5C66" />
          {w.target_price != null ? `Alert under ${money(w.target_price)}` : w.any_drop ? 'Alert on any drop' : 'No alert set'}
        </span>
        <button type="button" className="btn-del" onClick={onDelete} aria-label={`Delete ${p.title || 'item'}`}>
          <TrashIcon /> <span>Delete</span>
        </button>
      </div>
    </article>
  );
}
