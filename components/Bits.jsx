'use client';

export function LogoMark({ size = 34 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 7c3 0 4 9 9 9s6-9 9-9" stroke="#3DDC97" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Logo({ href = '/' }) {
  return (
    <a href={href} className="logo" aria-label="Dipper home">
      <LogoMark />
      <span className="logo-word">Dipper</span>
    </a>
  );
}

export function BellIcon({ color = 'currentColor', size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function TrashIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

export function BoxIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0B0B0F" strokeOpacity="0.3" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  );
}

export function ProductImage({ src, alt }) {
  if (!src) return <BoxIcon />;
  return <img src={src} alt={alt || ''} referrerPolicy="no-referrer" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />;
}

export function Toast({ text }) {
  if (!text) return null;
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}

export function Foot() {
  return <p className="foot">Dipper 1.0.0 · © 2026</p>;
}

export function Splash({ text }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <LogoMark size={56} />
        {text && <p style={{ color: '#5C5C66', maxWidth: 320 }}>{text}</p>}
      </div>
    </div>
  );
}
