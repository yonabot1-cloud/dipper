// Which store a link belongs to, and one clean URL per product.

export const STORES = [
  { key: 'amazon', name: 'Amazon', hosts: ['amazon.com', 'amzn.to', 'amzn.com', 'a.co'] },
  { key: 'walmart', name: 'Walmart', hosts: ['walmart.com'] },
  { key: 'target', name: 'Target', hosts: ['target.com', 'tgt.gifts'] },
  { key: 'homedepot', name: 'Home Depot', hosts: ['homedepot.com'] },
  { key: 'bestbuy', name: 'Best Buy', hosts: ['bestbuy.com'] },
  { key: 'lowes', name: "Lowe's", hosts: ['lowes.com'] },
  { key: 'costco', name: 'Costco', hosts: ['costco.com'] },
  { key: 'ebay', name: 'eBay', hosts: ['ebay.com', 'ebay.us'] },
];

export const STORE_NAMES = Object.fromEntries(STORES.map((s) => [s.key, s.name]));

export function findUrlInText(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0];
  const bare = String(text || '').trim();
  if (/^[\w.-]+\.(com|co|to|us|gifts)\//i.test(bare)) return 'https://' + bare;
  return null;
}

export function storeFor(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\.|^smile\.|^m\./, '');
  } catch {
    return null;
  }
  for (const s of STORES) {
    if (s.hosts.some((h) => host === h || host.endsWith('.' + h))) return s.key;
  }
  return null;
}

export function isShortLink(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return ['a.co', 'amzn.to', 'tgt.gifts', 'ebay.us'].includes(h.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

// Returns { url, store, candidates } or null when the link isn't a product page we understand.
// candidates are other spellings of the same page, used to look up archived copies.
export function canonicalize(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const store = storeFor(u.href);
  if (!store) return null;
  const path = u.pathname;
  const origPath = `${u.hostname.replace(/^www\.|^smile\.|^m\./, '')}${path}`.replace(/\/$/, '');
  let m;

  switch (store) {
    case 'amazon': {
      m = path.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})/i);
      if (!m) return null;
      const asin = m[1].toUpperCase();
      return {
        store,
        url: `https://www.amazon.com/dp/${asin}`,
        candidates: uniq([`amazon.com/dp/${asin}`, `amazon.com/gp/product/${asin}`, origPath.replace(/(\/dp\/[A-Z0-9]{10}).*/i, '$1')]),
      };
    }
    case 'walmart': {
      m = path.match(/\/ip\/(?:[^/]+\/)?(\d{5,})/);
      if (!m) return null;
      return { store, url: `https://www.walmart.com/ip/${m[1]}`, candidates: uniq([`walmart.com/ip/${m[1]}`, origPath]) };
    }
    case 'target': {
      m = path.match(/A-(\d{6,})/);
      if (!m) return null;
      return { store, url: `https://www.target.com/p/-/A-${m[1]}`, candidates: uniq([origPath, `target.com/p/-/A-${m[1]}`]) };
    }
    case 'homedepot': {
      m = path.match(/\/p\/(?:[^/]+\/)?(\d{9})/);
      if (!m) return null;
      return { store, url: `https://www.homedepot.com/p/${m[1]}`, candidates: uniq([origPath, `homedepot.com/p/${m[1]}`]) };
    }
    case 'bestbuy': {
      const sku = u.searchParams.get('skuId') || (path.match(/\/(\d{7,8})\.p/) || [])[1] || (path.match(/\/product\/[^/]*\/(\d{7,8})\/?$/) || [])[1];
      const code = (path.match(/\/product\/[^/]+\/([A-Z0-9]{8,12})\/?$/i) || [])[1];
      if (!sku && !code) return null;
      if (sku) {
        return { store, url: `https://www.bestbuy.com/site/-/${sku}.p?skuId=${sku}`, candidates: uniq([origPath, `bestbuy.com/site/${sku}.p`, `bestbuy.com/product/-/${sku}`]) };
      }
      return { store, url: `https://www.bestbuy.com${path}`, candidates: uniq([origPath]) };
    }
    case 'lowes': {
      m = path.match(/\/pd\/[^/]+\/(\d{4,})/);
      if (!m) return null;
      return { store, url: `https://www.lowes.com${path}`, candidates: uniq([origPath]) };
    }
    case 'costco': {
      m = path.match(/\.product\.(\d+)\.html/) || path.match(/\/p\/[^/]+\/(\d+)/);
      if (!m) return null;
      return { store, url: `https://www.costco.com${path}`, candidates: uniq([origPath]) };
    }
    case 'ebay': {
      m = path.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
      if (!m) return null;
      return { store, url: `https://www.ebay.com/itm/${m[1]}`, candidates: uniq([`ebay.com/itm/${m[1]}`, origPath]) };
    }
  }
  return null;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}
