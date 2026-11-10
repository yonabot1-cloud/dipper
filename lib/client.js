'use client';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

let _sb = null;
export function sb() {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  _sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return _sb;
}

export function useSession() {
  const [state, setState] = useState({ loading: true, session: null });
  useEffect(() => {
    const client = sb();
    if (!client) {
      setState({ loading: false, session: null, notReady: true });
      return;
    }
    client.auth.getSession().then(({ data }) => setState({ loading: false, session: data.session }));
    const { data: sub } = client.auth.onAuthStateChange((_e, session) => setState({ loading: false, session }));
    return () => sub.subscription.unsubscribe();
  }, []);
  return state;
}

export async function api(path, body) {
  const { data } = await sb().auth.getSession();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Try again.');
  return json;
}

export const STORE_NAMES = {
  amazon: 'Amazon',
  walmart: 'Walmart',
  target: 'Target',
  homedepot: 'Home Depot',
  costco: 'Costco',
};

export function money(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Price summary over a set of {price, seen_at} points.
export function summarize(points, current) {
  const vals = points.map((p) => Number(p.price)).filter((n) => !isNaN(n));
  if (current != null) vals.push(Number(current));
  if (!vals.length) return null;
  let low = Infinity, high = -Infinity, lowAt = null, highAt = null;
  for (const p of points) {
    const v = Number(p.price);
    if (v < low) { low = v; lowAt = p.seen_at; }
    if (v > high) { high = v; highAt = p.seen_at; }
  }
  if (current != null) {
    if (current < low) { low = current; lowAt = new Date().toISOString(); }
    if (current > high) { high = current; highAt = new Date().toISOString(); }
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const oldest = points.length ? points.reduce((a, b) => (a.seen_at < b.seen_at ? a : b)).seen_at : null;
  return { low, high, avg, lowAt, highAt, count: points.length, oldest };
}

export function verdict(points, current) {
  if (current == null) return { key: 'new', label: 'Checking…' };
  const s = summarize(points, current);
  if (!s || s.count < 3 || s.high - s.low < 0.01) {
    return s && s.count >= 3 ? { key: 'typical', label: 'Steady price', pos: 0.5 } : { key: 'new', label: 'New' };
  }
  const pos = (current - s.low) / (s.high - s.low);
  if (current <= s.low * 1.005) return { key: 'great', label: 'Lowest seen', pos };
  if (pos <= 0.25) return { key: 'great', label: 'Great price', pos };
  if (pos <= 0.5) return { key: 'good', label: 'Good price', pos };
  if (pos <= 0.75) return { key: 'typical', label: 'Typical price', pos };
  return { key: 'wait', label: 'Wait — usually lower', pos };
}

export function sparkPoints(points, w = 108, h = 44) {
  const vals = points.map((p) => Number(p.price));
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1;
  return vals
    .map((v, i) => `${(4 + (i * (w - 8)) / (vals.length - 1)).toFixed(1)},${(6 + (1 - (v - min) / r) * (h - 12)).toFixed(1)}`)
    .join(' ');
}
