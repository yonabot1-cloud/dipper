'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { sb, useSession, money, shortDate, STORE_NAMES, storeLabel, summarize, verdict } from '@/lib/client';
import TopBar from '@/components/TopBar';
import AuthScreen from '@/components/AuthScreen';
import PriceChart from '@/components/PriceChart';
import { ProductImage, Toast, Splash, BellIcon, Foot } from '@/components/Bits';

const RANGES = [
  { key: '30D', days: 30 },
  { key: '90D', days: 90 },
  { key: '1Y', days: 365 },
  { key: '2Y', days: 730 },
  { key: 'All', days: 3650 },
];

export default function ItemPage() {
  const { loading, session } = useSession();
  if (loading) return <Splash />;
  if (!session) return <AuthScreen />;
  return <Item session={session} />;
}

function Item({ session }) {
  const { id } = useParams();
  const router = useRouter();
  const [product, setProduct] = useState(null);
  const [watch, setWatch] = useState(null);
  const [points, setPoints] = useState([]);
  const [range, setRange] = useState('2Y');
  const [target, setTarget] = useState('');
  const [anyDrop, setAnyDrop] = useState(false);
  const [notifyPush, setNotifyPush] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [toast, setToast] = useState('');
  const [missing, setMissing] = useState(false);
  const timer = useRef();

  const showToast = useCallback((t) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  const load = useCallback(async () => {
    const client = sb();
    const [{ data: p }, { data: w }, { data: pts }] = await Promise.all([
      client.from('products').select('*').eq('id', id).maybeSingle(),
      client.from('watches').select('*').eq('product_id', id).maybeSingle(),
      client.from('prices').select('price, seen_at, source').eq('product_id', id).order('seen_at').limit(10000),
    ]);
    if (!p) return setMissing(true);
    setProduct(p);
    setPoints(pts || []);
    setWatch(w);
    if (w) {
      setTarget((t) => (t === '' && w.target_price != null ? String(Number(w.target_price)) : t));
      setAnyDrop(!!w.any_drop);
      setNotifyPush(w.notify_push !== false);
      setNotifyEmail(!!w.notify_email);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (product && !product.backfilled_at) {
      const t = setTimeout(load, 6000);
      return () => clearTimeout(t);
    }
  }, [product, load]);

  const cur = product?.current_price != null ? Number(product.current_price) : null;
  const days = RANGES.find((r) => r.key === range).days;
  const from = Date.now() - days * 864e5;
  const inRange = useMemo(() => points.filter((p) => new Date(p.seen_at).getTime() >= from), [points, from]);
  const s = summarize(inRange, cur);
  const all2y = useMemo(() => points.filter((p) => new Date(p.seen_at).getTime() >= Date.now() - 730 * 864e5), [points]);
  const v = verdict(all2y, cur);
  const s2 = summarize(all2y, cur);
  const pctCheaper = useMemo(() => {
    if (cur == null || all2y.length < 3) return null;
    const higher = all2y.filter((p) => Number(p.price) > cur).length;
    return Math.round((higher / all2y.length) * 100);
  }, [all2y, cur]);

  const months = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const vals = points.filter((p) => { const t = new Date(p.seen_at); return t >= d && t < next; }).map((p) => Number(p.price));
      if (i === 0 && cur != null) vals.push(cur);
      out.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, current: i === 0 });
    }
    const have = out.filter((m) => m.avg != null);
    const lo = Math.min(...have.map((m) => m.avg)), hi = Math.max(...have.map((m) => m.avg));
    const cheapest = have.filter((m) => !m.current).sort((a, b) => a.avg - b.avg)[0];
    return out.map((m) => ({
      ...m,
      h: m.avg == null ? 0 : 24 + ((m.avg - lo) / (hi - lo || 1)) * 110,
      color: m.current ? '#2B59FF' : m === cheapest ? '#08814A' : '#C9CBD6',
    }));
  }, [points, cur]);

  const changes = useMemo(() => {
    const out = [];
    let prev = null;
    for (const p of points) {
      const val = Number(p.price);
      if (prev == null || Math.abs(val - prev) >= 0.01) out.push({ at: p.seen_at, price: val, diff: prev == null ? null : val - prev, source: p.source });
      prev = val;
    }
    return out.reverse().slice(0, 14);
  }, [points]);

  async function saveAlert() {
    const t = target === '' ? null : Number(String(target).replace(/[^0-9.]/g, ''));
    if (t != null && (isNaN(t) || t <= 0)) return showToast('Enter a price like 99 or 149.99');
    const { error } = await sb().from('watches').update({ target_price: t, any_drop: anyDrop, notify_push: notifyPush, notify_email: notifyEmail, email: session.user.email, last_notified_price: null }).eq('id', watch.id);
    if (error) return showToast(error.message);
    if (!notifyPush && !notifyEmail) showToast('Saved — but phone and email are both off, so you won’t be notified.');
    else showToast(t != null ? `Saved. We’ll ${notifyEmail && notifyPush ? 'notify and email' : notifyEmail ? 'email' : 'notify'} you under ${money(t)}.` : 'Alert saved.');
    load();
  }

  function step(dir) {
    const base = target === '' ? Math.floor((cur ?? 100) * 0.9) : Number(target);
    const inc = base >= 100 ? 5 : 1;
    setTarget(String(Math.max(1, Math.round((base + dir * inc) * 100) / 100)));
  }

  async function del() {
    await sb().from('watches').delete().eq('id', watch.id);
    router.push('/');
  }

  if (missing) return <Splash text="This item isn’t on your list anymore." />;
  if (!product) return <Splash />;

  const added = watch?.added_price != null ? Number(watch.added_price) : null;
  const since = cur != null && added != null ? cur - added : null;

  return (
    <>
      <TopBar session={session} onToast={showToast} back />
      <main className="wrap">
        <div className="item-grid">
          <section className="item-main">
            <div className="item-hero">
              <div className="item-photo"><ProductImage src={product.image} alt={product.title} /></div>
              <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="pill-store" style={{ width: 'fit-content' }}>{storeLabel(product)}</span>
                <h1 className="item-title">{product.title || 'Getting the name…'}</h1>
                <a href={product.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500, fontSize: 14 }}>Open on {storeLabel(product)} ↗</a>
              </div>
            </div>

            <div className="panel">
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontWeight: 500, fontSize: 14, color: '#5C5C66' }}>
                    Price right now{product.last_checked ? ` · checked ${timeAgo(product.last_checked)}` : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span className="price-now">{money(cur)}</span>
                    {since != null && Math.abs(since) >= 0.01 && (
                      <span className={`delta ${since < 0 ? 'd-down' : 'd-up'}`} style={{ fontSize: 14 }}>
                        {since < 0 ? '▼' : '▲'} {money(Math.abs(since))} since you added it
                      </span>
                    )}
                  </div>
                  {product.last_error && cur == null && <span style={{ fontSize: 13, color: '#8A5300' }}>Couldn’t read today’s price yet — we’ll keep trying every few hours.</span>}
                </div>
                {product.store !== 'other' && <div className="seg" role="group" aria-label="Chart range">
                  {RANGES.map((r) => (
                    <button key={r.key} type="button" className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>{r.key}</button>
                  ))}
                </div>}
              </div>

              {product.store === 'other' ? (
                <p style={{ margin: 0, color: '#5C5C66', fontSize: 14, lineHeight: 1.5 }}>Dipper checks this page about every 10 minutes and alerts you when it drops. Price history and charts are for Amazon, Walmart, Target, Home Depot and Costco.</p>
              ) : (<>
              <PriceChart points={points} current={cur} target={watch?.target_price} from={from} />

              <div className="stats">
                <div className="stat"><span>Lowest</span><b style={{ color: '#08814A' }}>{s ? money(s.low) : '—'}</b><small>{s?.lowAt ? shortDate(s.lowAt) : ''}</small></div>
                <div className="stat"><span>Highest</span><b style={{ color: '#B93A22' }}>{s ? money(s.high) : '—'}</b><small>{s?.highAt ? shortDate(s.highAt) : ''}</small></div>
                <div className="stat"><span>Average</span><b>{s ? money(s.avg) : '—'}</b><small>{range === 'All' ? 'all time' : `last ${range}`}</small></div>
                <div className="stat"><span>Prices on record</span><b>{points.length}</b><small>{points[0] ? `since ${shortDate(points[0].seen_at)}` : 'starting today'}</small></div>
              </div>
              </>)}
              {product.store === 'other' ? null : !product.backfilled_at ? (
                <span style={{ fontSize: 13, color: '#5C5C66' }}>Looking up older prices… this page updates by itself.</span>
              ) : (
                <span style={{ fontSize: 12, color: '#5C5C66' }}>Older prices from the Internet Archive and <a href="https://shopsavvy.com" target="_blank" rel="noopener noreferrer">ShopSavvy</a>. New prices checked every few hours{product.price_source === 'shopsavvy' ? ' (today’s price via ShopSavvy)' : ''}.</span>
              )}
            </div>

            {product.store !== 'other' && <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div className="panel verdict-panel" style={{ flex: '1 1 260px', minWidth: 0 }}>
                <p className="eyebrow">Is this a good price?</p>
                <div className="verdict-big" style={{ color: v.key === 'wait' ? '#FFB547' : v.key === 'typical' ? '#FFFFFF' : '#3DDC97' }}>
                  {v.key === 'great' ? 'Yes — buy it.' : v.key === 'good' ? 'Pretty good.' : v.key === 'typical' ? 'It’s typical.' : v.key === 'wait' ? 'Wait if you can.' : 'Too soon to tell.'}
                </div>
                {v.pos != null && (
                  <>
                    <div className="meter"><b style={{ left: `${Math.min(Math.max(v.pos * 100, 2), 98)}%` }} /></div>
                    <div className="meter-labels"><span>{s2 ? money(s2.low) : ''}</span><span>Typical</span><span>{s2 ? money(s2.high) : ''}</span></div>
                  </>
                )}
                <span style={{ fontSize: 14, lineHeight: 1.5, color: '#D6D6DE' }}>
                  {pctCheaper != null
                    ? `Cheaper than ${pctCheaper}% of the prices we have from the last 2 years.`
                    : 'We need a few more prices before we can judge. Old prices are still loading or this item is new to the web archives.'}
                </span>
              </div>

              <div className="panel" style={{ flex: '2 1 360px', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <h2>Average price by month</h2>
                  <span style={{ fontWeight: 500, fontSize: 13, color: '#5C5C66' }}>Last 12 months</span>
                </div>
                <div className="bars">
                  {months.map((m, i) => (
                    <div className="bar-col" key={i} title={m.avg != null ? `${m.label}: ${money(m.avg)}` : `${m.label}: no data`}>
                      <i style={{ height: m.h || 4, background: m.avg == null ? '#EEEEF2' : m.color }} />
                      <span>{m.label[0]}</span>
                    </div>
                  ))}
                </div>
                <div className="legend">
                  <span><i style={{ background: '#08814A' }} />Cheapest month</span>
                  <span><i style={{ background: '#C9CBD6' }} />Other months</span>
                  <span><i style={{ background: '#2B59FF' }} />This month</span>
                </div>
              </div>
            </div>

            <div className="panel" style={{ gap: 0, paddingTop: 22, paddingBottom: 12 }}>
              <h2 style={{ marginBottom: 6 }}>Every change</h2>
              {changes.length === 0 && <p style={{ color: '#5C5C66', margin: '12px 0' }}>No changes recorded yet.</p>}
              {changes.map((c, i) => (
                <div className="log-row" key={i}>
                  <span style={{ color: '#5C5C66' }}>{shortDate(c.at)}{c.source === 'archive' ? ' · web archive' : c.source === 'shopsavvy' ? ' · ShopSavvy' : ''}</span>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {c.diff != null && <span className={`delta ${c.diff < 0 ? 'd-down' : 'd-up'}`} style={{ marginTop: 0 }}>{c.diff < 0 ? '▼' : '▲'} {money(Math.abs(c.diff))}</span>}
                    <b style={{ minWidth: 84, textAlign: 'right' }}>{money(c.price)}</b>
                  </span>
                </div>
              ))}
            </div>
            </>}
          </section>

          <aside className="item-side">
            <div className="panel alert-panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BellIcon color="#3DDC97" size={22} />
                <h2 style={{ fontSize: 21 }}>Ping me when it’s under</h2>
              </div>
              <div className="stepper">
                <button type="button" aria-label="Lower target" onClick={() => step(-1)}>−</button>
                <label className="sr-only" htmlFor="target">Target price</label>
                <input id="target" inputMode="decimal" value={target === '' ? '' : `$${target}`} placeholder="$—" onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))} />
                <button type="button" aria-label="Raise target" onClick={() => step(1)}>+</button>
              </div>
              <button type="button" className="toggle-row" aria-pressed={anyDrop} onClick={() => setAnyDrop(!anyDrop)}>
                <span>Also alert me on any price drop</span>
                <span className={`switch ${anyDrop ? 'on' : ''}`}><i /></span>
              </button>
              <button type="button" className="toggle-row" aria-pressed={notifyPush} onClick={() => setNotifyPush(!notifyPush)}>
                <span>Phone / computer notification</span>
                <span className={`switch ${notifyPush ? 'on' : ''}`}><i /></span>
              </button>
              <button type="button" className="toggle-row" aria-pressed={notifyEmail} onClick={() => setNotifyEmail(!notifyEmail)}>
                <span>Email me too <small style={{ color: '#8D8D99' }}>({session.user.email})</small></span>
                <span className={`switch ${notifyEmail ? 'on' : ''}`}><i /></span>
              </button>
              <button type="button" className="btn-mint" style={{ width: '100%' }} onClick={saveAlert}>Save alert</button>
              <span style={{ fontSize: 13, color: '#B9B9C4', lineHeight: 1.5 }}>Notifications arrive on every device where you tapped the bell at the top.{product.store === 'other' ? ' This site is checked about every 10 minutes.' : ''}</span>
            </div>
            {s2 && s2.count >= 3 && (
              <div className="tip">
                <b>Over the last 2 years</b>
                Lowest was {money(s2.low)}{s2.lowAt ? ` (${shortDate(s2.lowAt)})` : ''}, highest {money(s2.high)}. A target near {money(Math.round(s2.low * 1.03))} is realistic.
              </div>
            )}
            <button type="button" className="btn-del wide" onClick={del}>Delete this item</button>
          </aside>
        </div>
        <Foot />
      </main>
      <Toast text={toast} />
    </>
  );
}

function timeAgo(d) {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
