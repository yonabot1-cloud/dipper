'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/client';
import { Logo, BellIcon } from './Bits';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function enablePush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (isIos() && !isInstalled()) {
      throw new Error('On iPhone, first add Dipper to your Home Screen: tap Share, then “Add to Home Screen”. Open it from there and tap the bell again.');
    }
    throw new Error('This browser can’t show notifications.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are turned off for Dipper in your settings.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await fetch('/api/push/key').then((r) => r.json());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
  const json = sub.toJSON();
  const { error } = await sb().from('push_subs').upsert({ user_id: userId, endpoint: json.endpoint, sub: json }, { onConflict: 'endpoint' });
  if (error) throw error;
  return true;
}

export default function TopBar({ session, onToast, back }) {
  const [open, setOpen] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [newPw, setNewPw] = useState('');
  const email = session?.user?.email || '';

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(async (reg) => {
        const sub = await reg.pushManager?.getSubscription?.();
        if (sub && Notification.permission === 'granted') setPushOn(true);
      }).catch(() => {});
    }
    if (window.location.hash.includes('type=recovery')) setRecovery(true);
    const { data } = sb().auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function bell() {
    try {
      await enablePush(session.user.id);
      setPushOn(true);
      onToast?.('Price alerts are on for this device.');
    } catch (e) {
      onToast?.(e.message);
    }
  }

  async function savePw(e) {
    e.preventDefault();
    const { error } = await sb().auth.updateUser({ password: newPw });
    if (error) return onToast?.(error.message);
    setRecovery(false);
    history.replaceState(null, '', window.location.pathname);
    onToast?.('Password updated.');
  }

  return (
    <header className="topbar">
      <div className="topbar-in">
        {back ? (
          <a href="/" className="back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            Watchlist
          </a>
        ) : (
          <Logo />
        )}
        <div className="top-actions">
          <span className="sync-pill" title="Your list is saved to your account and shows on every device you sign in on">
            <i /> <span>Synced · phone &amp; computer</span>
          </span>
          <button type="button" className={`icon-btn ${pushOn ? 'on' : ''}`} aria-label={pushOn ? 'Price alerts are on' : 'Turn on price alerts'} onClick={bell}>
            <BellIcon color={pushOn ? '#3DDC97' : '#0B0B0F'} />
          </button>
          <div style={{ position: 'relative' }}>
            <button type="button" className="avatar" aria-label="Account" aria-expanded={open} onClick={() => setOpen(!open)}>
              {(email[0] || 'D').toUpperCase()}
            </button>
            {open && (
              <div className="menu">
                <p>Signed in as {email}</p>
                <button type="button" onClick={() => { setOpen(false); bell(); }}>Turn on price alerts here</button>
                <button type="button" onClick={() => sb().auth.signOut()}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {recovery && (
        <form onSubmit={savePw} style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor="newpw">New password</label>
          <input id="newpw" className="field" style={{ flex: '1 1 260px' }} type="password" minLength={8} required placeholder="Choose a new password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <button className="btn-dark" style={{ padding: '0 24px' }}>Save new password</button>
        </form>
      )}
    </header>
  );
}
