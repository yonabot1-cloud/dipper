// Reads the price, name and photo out of a store's product page HTML.
// Works on today's pages and on archived copies from past years.

export function parsePrice(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.,]/g, '');
  if (!s) return null;
  // "1,299.99" → 1299.99 ; "1.299,99" is not used by US stores
  const n = parseFloat(s.replace(/,/g, ''));
  if (!isFinite(n) || n < 0.5 || n > 200000) return null;
  return Math.round(n * 100) / 100;
}

export function looksBlocked(html) {
  if (!html || html.length < 2000) return true;
  return /validateCaptcha|Type the characters you see|Robot or human\?|px-captcha|Access Denied<\/title>|Pardon Our Interruption|are you a human|Request unsuccessful\. Incapsula/i.test(
    html.slice(0, 60000)
  );
}

function decode(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\\u0026/g, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html, prop) {
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${prop}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? decode(m[1]) : null;
}

function first(html, regexes) {
  for (const re of regexes) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function jsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      continue;
    }
    walk(data, out, 0);
  }
  return out;
}

function walk(node, out, depth) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, out, depth + 1));
  if (typeof node !== 'object') return;
  const t = [].concat(node['@type'] || []).map(String);
  if (t.some((x) => /Product/i.test(x))) out.push(node);
  if (node['@graph']) walk(node['@graph'], out, depth + 1);
  if (node.hasVariant) walk(node.hasVariant, out, depth + 1);
}

function offerPrice(offers) {
  if (!offers) return null;
  const list = [].concat(offers);
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const p =
      parsePrice(o.price) ??
      parsePrice(o.lowPrice) ??
      parsePrice(o.priceSpecification && [].concat(o.priceSpecification)[0]?.price);
    if (p != null) return p;
    if (o.offers) {
      const inner = offerPrice(o.offers);
      if (inner != null) return inner;
    }
  }
  return null;
}

function imageOf(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageOf(img[0]);
  return img.url || img.contentUrl || null;
}

const STORE_RULES = {
  amazon: {
    price: [
      /apex-pricetopay-accessibility-label["'][^>]*>[^$<]{0,40}\$([\d,]+\.\d{2})/i,
      /priceToPay[\s\S]{0,400}?class=["']a-offscreen["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /id=["']corePrice(?:Display_desktop_feature|Display_desktop|_feature|_desktop)_div["'][\s\S]{0,3000}?class=["']a-offscreen["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /id=["']apex_desktop["'][\s\S]{0,4000}?class=["']a-offscreen["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /"priceAmount"\s*:\s*([\d.]+)/,
      /id=["']priceblock_dealprice["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /id=["']priceblock_ourprice["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /id=["']priceblock_saleprice["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /id=["']price_inside_buybox["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /id=["']newBuyBoxPrice["'][^>]*>\s*\$([\d,]+\.\d{2})/i,
      /class=["']a-price a-text-price a-size-medium apexPriceToPay["'][\s\S]{0,300}?\$([\d,]+\.\d{2})/i,
    ],
    title: [/id=["']productTitle["'][^>]*>\s*([^<]+?)\s*</i],
    image: [/"hiRes"\s*:\s*"(https:[^"]+)"/, /data-old-hires=["'](https:[^"']+)["']/, /id=["']landingImage["'][^>]*src=["'](https:[^"']+)["']/, /id=["']imgBlkFront["'][^>]*src=["'](https:[^"']+)["']/],
  },
  walmart: {
    price: [/"priceInfo"\s*:\s*\{[\s\S]{0,600}?"currentPrice"\s*:\s*\{[^}]*?"price"\s*:\s*([\d.]+)/, /"currentPrice"\s*:\s*\{\s*"price"\s*:\s*([\d.]+)/, /itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i],
    title: [/"product"\s*:\s*\{[^{}]{0,400}?"name"\s*:\s*"([^"]+)"/],
    image: [/"imageInfo"\s*:\s*\{[\s\S]{0,400}?"thumbnailUrl"\s*:\s*"([^"]+)"/],
  },
  target: {
    price: [/\\?"current_retail\\?"\s*:\s*([\d.]+)/, /\\?"formatted_current_price\\?"\s*:\s*\\?"\$([\d,]+\.\d{2})/, /data-test=["']product-price["'][^>]*>\s*\$([\d,]+\.\d{2})/i],
    title: [/<h1[^>]*data-test=["']product-title["'][^>]*>([^<]+)</i],
    image: [],
  },
  homedepot: {
    price: [/"pricing"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/, /"specialPrice"\s*:\s*([\d.]+)/, /itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i],
    title: [/<h1[^>]*class=["'][^"']*product-details__title[^"']*["'][^>]*>([^<]+)</i],
    image: [],
  },
  bestbuy: {
    price: [/"customerPrice"\s*:\s*([\d.]+)/, /"currentPrice"\s*:\s*([\d.]+)/, /class=["']priceView-hero-price priceView-customer-price["'][\s\S]{0,200}?\$([\d,]+\.\d{2})/i],
    title: [/<h1[^>]*class=["'][^"']*heading-5[^"']*["'][^>]*>([^<]+)</i],
    image: [],
  },
  lowes: {
    price: [/"finalPrice"\s*:\s*([\d.]+)/, /"sellingPrice"\s*:\s*([\d.]+)/, /itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i],
    title: [],
    image: [],
  },
  costco: {
    price: [/"finalOnlinePrice"\s*:\s*"?([\d.]+)/, /priceTotal\s*:\s*initialize\(([\d.]+)\)/, /itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i, /class=["']value["'][^>]*>\s*([\d,]+\.\d{2})\s*</i],
    title: [/<h1[^>]*itemprop=["']name["'][^>]*>([^<]+)</i],
    image: [],
  },
  ebay: {
    price: [/"price"\s*:\s*\{\s*"value"\s*:\s*"?([\d.]+)/, /itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i, /class=["']x-price-primary["'][\s\S]{0,200}?US \$([\d,]+\.\d{2})/i, /id=["']prcIsum["'][^>]*>\s*US \$([\d,]+\.\d{2})/i],
    title: [/<h1[^>]*class=["']x-item-title__mainTitle["'][\s\S]{0,200}?<span[^>]*>([^<]+)</i],
    image: [],
  },
};

export function extract(html, store) {
  const res = { price: null, title: null, image: null, blocked: false };
  if (looksBlocked(html)) {
    res.blocked = true;
    return res;
  }
  const rules = STORE_RULES[store] || { price: [], title: [], image: [] };

  // 1) Store-specific spots (most accurate)
  res.price = parsePrice(first(html, rules.price));
  res.title = decode(first(html, rules.title));
  res.image = first(html, rules.image);

  // 2) Structured product data
  const products = jsonLdProducts(html);
  for (const p of products) {
    if (res.price == null) res.price = offerPrice(p.offers);
    if (!res.title && p.name) res.title = decode(String(p.name));
    if (!res.image) res.image = imageOf(p.image);
  }

  // 3) Page meta tags
  if (res.price == null) res.price = parsePrice(meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || meta(html, 'price'));
  if (!res.title) res.title = meta(html, 'og:title') || decode(first(html, [/<title[^>]*>([^<]+)<\/title>/i]));
  if (!res.image) res.image = meta(html, 'og:image') || meta(html, 'twitter:image');

  if (res.title) {
    res.title = res.title
      .replace(/\s*[:|–-]\s*(Amazon\.com.*|Walmart\.com|Target|The Home Depot|Best Buy|Lowe's|Costco|eBay)\s*$/i, '')
      .replace(/^Amazon\.com\s*:\s*/i, '')
      .slice(0, 200);
  }
  if (res.image) res.image = decode(res.image).replace(/^\/\//, 'https://');
  if (res.image && !/^https?:\/\//.test(res.image)) res.image = null;
  return res;
}
