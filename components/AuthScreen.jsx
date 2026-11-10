'use client';
import { useState } from 'react';
import { sb } from '@/lib/client';
import { Logo } from './Bits';

const GOOGLE_ON = process.env.NEXT_PUBLIC_GOOGLE_AUTH === 'on';

export default function AuthScreen() {
  const [mode, setMode] = useState('signup'); // signup | signin | reset | verify
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const client = sb();
    try {
      if (mode === 'verify') {
        let { error } = await client.auth.verifyOtp({ email, token: code.trim(), type: 'signup' });
        if (error) ({ error } = await client.auth.verifyOtp({ email, token: code.trim(), type: 'email' }));
        if (error) throw new Error('That code didn’t work. Check the newest email from Dipper, or tap “Send a new code”.');
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/' });
        if (error) throw error;
        setMsg({ ok: true, text: 'Check your email for a link to set a new password.' });
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + '/' } });
        if (error) throw error;
        if (!data.session) {
          setMode('verify');
          setCode('');
          setMsg({ ok: true, text: `We emailed a 6-digit code to ${email}. Enter it below.` });
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error && /not confirmed/i.test(error.message)) {
          await client.auth.resend({ type: 'signup', email });
          setMode('verify');
          setCode('');
          setMsg({ ok: true, text: `Please confirm your email first — we sent a 6-digit code to ${email}.` });
          return;
        }
        if (error) throw error;
      }
    } catch (err) {
      let text = err.message || 'Something went wrong.';
      if (/Invalid login/i.test(text)) text = 'That email and password don’t match. Try again or reset your password.';
      if (/already registered/i.test(text)) text = 'You already have an account — sign in instead.';
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } });
  }

  async function resend() {
    setMsg(null);
    const { error } = await sb().auth.resend({ type: 'signup', email });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'New code sent. It can take a minute to arrive.' });
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'signin' ? 'Welcome back' : mode === 'verify' ? 'Check your email' : 'Reset your password';

  return (
    <div className="auth">
      <section className="auth-hero">
        <Logo />
        <svg className="auth-curve" viewBox="0 0 640 240" fill="none" aria-hidden="true">
          <path d="M0 50 C 160 50, 200 205, 330 205 S 520 30, 640 30" stroke="#3DDC97" strokeWidth="6" strokeLinecap="round" />
          <circle cx="330" cy="205" r="13" fill="#3DDC97" />
          <circle cx="330" cy="205" r="32" stroke="#3DDC97" strokeOpacity="0.3" strokeWidth="2" />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1>
            Know the
            <br />
            moment it dips.
          </h1>
          <p>Paste a link from Amazon, Walmart, Target, Home Depot or Costco. See up to two years of prices, and get a ping when it drops.</p>
        </div>
      </section>

      <section className="auth-side">
        <form className="auth-form" onSubmit={submit}>
          <h2>{title}</h2>
          {GOOGLE_ON && (mode === 'signup' || mode === 'signin') && (
            <>
              <button type="button" className="btn-google" onClick={google}>
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continue with Google
              </button>
              <div className="or">or with email</div>
            </>
          )}

          {mode === 'verify' ? (
            <>
              <label className="field-label" htmlFor="code">6-digit code</label>
              <input
                id="code"
                className="field code-field"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
              />
            </>
          ) : (
            <>
              <label className="field-label" htmlFor="email">Email</label>
              <input id="email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </>
          )}

          {(mode === 'signup' || mode === 'signin') && (
            <>
              <label className="field-label" htmlFor="password">Password</label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </>
          )}

          {msg && <div className={`form-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

          <button className="btn-dark" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'signin' ? 'Sign in' : mode === 'verify' ? 'Confirm & continue' : 'Send reset link'}
          </button>

          <p className="auth-switch">
            {mode === 'signup' ? (
              <>Already have an account? <button type="button" className="link-btn" onClick={() => { setMode('signin'); setMsg(null); }}>Sign in</button></>
            ) : mode === 'signin' ? (
              <>
                New here? <button type="button" className="link-btn" onClick={() => { setMode('signup'); setMsg(null); }}>Create an account</button> ·{' '}
                <button type="button" className="link-btn" onClick={() => { setMode('reset'); setMsg(null); }}>Forgot password</button>
              </>
            ) : mode === 'verify' ? (
              <>
                Didn’t get it? <button type="button" className="link-btn" onClick={resend}>Send a new code</button> ·{' '}
                <button type="button" className="link-btn" onClick={() => { setMode('signup'); setMsg(null); }}>Change email</button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={() => { setMode('signin'); setMsg(null); }}>Back to sign in</button>
            )}
          </p>
        </form>
      </section>
    </div>
  );
}
