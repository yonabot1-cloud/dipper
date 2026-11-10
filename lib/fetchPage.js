const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const BROWSER_HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'upgrade-insecure-requests': '1',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
};

export async function fetchText(url, { timeout = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...headers },
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, finalUrl: res.url };
  } catch (err) {
    return { ok: false, status: 0, text: '', finalUrl: url, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

// Follows a short link (a.co, amzn.to …) to the real product page URL.
export async function resolveShortLink(url) {
  const r = await fetchText(url, { timeout: 10000 });
  return r.finalUrl || url;
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
