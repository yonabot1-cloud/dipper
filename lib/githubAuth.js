// Verifies that a request really comes from this repo's GitHub Actions run,
// using GitHub's built-in OIDC token. No shared secret needed.
import { createPublicKey, createVerify } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const REPO = 'yonabot1-cloud/dipper';
export const AUDIENCE = 'dipper-price-checker';
let jwks = null;
let jwksAt = 0;

function b64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function keys() {
  if (!jwks || Date.now() - jwksAt > 3600e3) {
    const r = await fetch(`${ISSUER}/.well-known/jwks`);
    jwks = (await r.json()).keys;
    jwksAt = Date.now();
  }
  return jwks;
}

export async function fromGitHubActions(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(b64url(parts[0]).toString());
    const claims = JSON.parse(b64url(parts[1]).toString());
    const jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk || header.alg !== 'RS256') return false;
    const v = createVerify('RSA-SHA256');
    v.update(`${parts[0]}.${parts[1]}`);
    if (!v.verify(createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]))) return false;
    const now = Math.floor(Date.now() / 1000);
    const aud = [].concat(claims.aud);
    return claims.iss === ISSUER && aud.includes(AUDIENCE) && claims.repository === REPO && claims.exp > now;
  } catch {
    return false;
  }
}
