// Target loads prices from its own public product service (the same one its website uses).
import { fetchText } from './fetchPage.js';

const FALLBACK_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';

export function targetKeyFromHtml(html) {
  const m = String(html || '').match(/\\?"apiKey\\?"\s*:\s*\\?"([0-9a-f]{40})\\?"/);
  return m ? m[1] : FALLBACK_KEY;
}

export async function targetPrice(url, html) {
  const tcin = (url.match(/A-(\d{6,})/) || [])[1];
  if (!tcin) return null;
  const key = targetKeyFromHtml(html);
  const api = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=${key}&tcin=${tcin}&pricing_store_id=3991&has_pricing_store_id=true&is_bot=false`;
  const r = await fetchText(api, { timeout: 12000, headers: { accept: 'application/json', origin: 'https://www.target.com', referer: url } });
  try {
    const j = JSON.parse(r.text);
    const p = j?.data?.product;
    if (!p) return null;
    const price = p.price?.current_retail ?? p.price?.current_retail_min ?? p.children?.[0]?.price?.current_retail ?? null;
    return {
      price: price != null ? Math.round(Number(price) * 100) / 100 : null,
      title: p.item?.product_description?.title?.replace(/&#\d+;/g, '') || null,
      image: p.item?.enrichment?.images?.primary_image_url || null,
    };
  } catch {
    return null;
  }
}
