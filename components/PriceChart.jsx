'use client';
import { useMemo, useRef, useState } from 'react';
import { money, shortDate } from '@/lib/client';

const W = 720, H = 260, PAD_L = 4, PAD_R = 4, TOP = 18, BOTTOM = 34;

// Step chart: a price holds until it changes, like a price tag.
export default function PriceChart({ points, current, target, from }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    const now = Date.now();
    const pts = points.map((p) => ({ t: new Date(p.seen_at).getTime(), v: Number(p.price), src: p.source })).filter((p) => p.t >= from).sort((a, b) => a.t - b.t);
    // carry the last known price from before the window into its start
    const before = points.map((p) => ({ t: new Date(p.seen_at).getTime(), v: Number(p.price) })).filter((p) => p.t < from).sort((a, b) => b.t - a.t)[0];
    if (before) pts.unshift({ t: from, v: before.v, src: 'carry' });
    if (current != null) pts.push({ t: now, v: Number(current), src: 'now' });
    if (pts.length < 2) return null;
    const t0 = pts[0].t, t1 = now;
    const vals = pts.map((p) => p.v).concat(target != null ? [Number(target)] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padv = (hi - lo) * 0.12 || hi * 0.08 || 1;
    lo = Math.max(0, lo - padv);
    hi = hi + padv;
    const x = (t) => PAD_L + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD_L - PAD_R);
    const y = (v) => TOP + (1 - (v - lo) / (hi - lo)) * (H - TOP - BOTTOM);
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`;
    const area = `${d} V${H - BOTTOM} H${x(pts[0].t).toFixed(1)} Z`;
    const ticks = [lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.8];
    return { pts, x, y, d, area, ticks, t0, t1, lo, hi };
  }, [points, current, target, from]);

  if (!model) {
    return (
      <div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#5C5C66', textAlign: 'center', padding: 20 }}>
        Not enough prices in this range yet. Try a longer range, or check back after the next price check.
      </div>
    );
  }

  const { pts, x, y, d, area, ticks, t0, t1 } = model;
  const down = pts[pts.length - 1].v <= pts[0].v;
  const color = down ? '#08814A' : '#B93A22';

  function onMove(e) {
    const box = ref.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const t = t0 + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (t1 - t0);
    let cur = pts[0];
    for (const p of pts) if (p.t <= t) cur = p;
    setHover({ t: Math.min(Math.max(t, t0), t1), v: cur.v, left: (x(Math.min(Math.max(t, t0), t1)) / W) * 100 });
  }

  return (
    <div className="chart-wrap">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Price history from ${shortDate(t0)} to today`}
        style={{ display: 'block', touchAction: 'pan-y' }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="fillG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.16" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="#EEEEF2" />
            <text x={W - 4} y={y(v) - 6} textAnchor="end" fontSize="11" fill="#5C5C66" fontFamily="Inter, sans-serif">{money(v)}</text>
          </g>
        ))}
        {target != null && (
          <g>
            <line x1="0" x2={W} y1={y(Number(target))} y2={y(Number(target))} stroke="#2B59FF" strokeWidth="1.5" strokeDasharray="6 6" />
            <text x="6" y={y(Number(target)) - 7} fontSize="12" fontWeight="600" fill="#2B59FF" fontFamily="Inter, sans-serif">Your alert · {money(target)}</text>
          </g>
        )}
        <path d={area} fill="url(#fillG)" />
        <path d={d} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        {pts.filter((p) => p.src === 'archive' || p.src === 'live').length < 60 &&
          pts.filter((p) => p.src === 'archive' || p.src === 'live').map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.v)} r="2.6" fill={color} opacity="0.55" />)}
        <circle cx={x(pts[pts.length - 1].t)} cy={y(pts[pts.length - 1].v)} r="6" fill={color} stroke="#fff" strokeWidth="3" />
        {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={TOP - 8} y2={H - BOTTOM} stroke="#0B0B0F" strokeOpacity="0.25" />}
        <text x="4" y={H - 10} fontSize="12" fill="#5C5C66" fontFamily="Inter, sans-serif">{shortDate(t0)}</text>
        <text x={W - 4} y={H - 10} textAnchor="end" fontSize="12" fill="#5C5C66" fontFamily="Inter, sans-serif">Today</text>
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: `${Math.min(Math.max(hover.left, 9), 91)}%` }}>
          {money(hover.v)}
          <small>{shortDate(hover.t)}</small>
        </div>
      )}
    </div>
  );
}
