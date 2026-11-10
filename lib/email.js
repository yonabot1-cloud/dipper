// Sends Dipper's alert emails through Gmail (free, up to ~500 a day).
// Needs GMAIL_APP_PASSWORD in Vercel (a Google "app password", not the normal password).
import nodemailer from 'nodemailer';

const USER = process.env.GMAIL_USER || 'yonabot1@gmail.com';
let transport = null;

export function emailReady() {
  return !!process.env.GMAIL_APP_PASSWORD;
}

function t() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: USER, pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, '') },
    });
  }
  return transport;
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export async function sendPriceEmail({ to, title, store, price, previous, target, image, itemUrl, storeUrl }) {
  if (!emailReady() || !to) return false;
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://dipper-alpha.vercel.app';
  const headline = target != null ? `Under your $${Number(target).toFixed(2)} alert` : 'The price just dropped';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F5F5F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:28px;overflow:hidden;font-family:-apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#0B0B0F;">
<tr><td style="background:#0B0B0F;padding:26px 30px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td><img src="${site}/icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:10px;border:0;"></td><td style="padding-left:10px;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Dipper</td></tr></table>
<div style="margin-top:20px;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3DDC97;">${esc(headline)}</div>
<div style="margin-top:6px;font-size:44px;font-weight:800;letter-spacing:-1.5px;color:#fff;">$${Number(price).toFixed(2)}</div>
${previous != null ? `<div style="margin-top:4px;font-size:15px;color:#B9B9C4;">was $${Number(previous).toFixed(2)}</div>` : ''}
</td></tr>
<tr><td style="padding:26px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${image ? `<td width="88" valign="top"><img src="${esc(image)}" width="76" height="76" alt="" style="display:block;border-radius:16px;object-fit:contain;border:1px solid #EEEEF2;"></td>` : ''}
<td valign="top" style="font-size:16px;font-weight:600;line-height:1.35;">${esc(title || 'Your item')}<div style="margin-top:6px;font-size:13px;font-weight:500;color:#5C5C66;">${esc(store)}</div></td>
</tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
<td style="background:#3DDC97;border-radius:999px;"><a href="${esc(storeUrl)}" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:700;color:#0B0B0F;text-decoration:none;">Open at ${esc(store)}</a></td>
<td style="padding-left:10px;"><a href="${esc(itemUrl)}" style="display:inline-block;padding:14px 18px;font-size:15px;font-weight:600;color:#0B0B0F;text-decoration:none;border:1px solid #DADAE0;border-radius:999px;">See it in Dipper</a></td>
</tr></table>
<p style="margin:26px 0 0;padding-top:16px;border-top:1px solid #EEEEF2;font-size:12px;line-height:1.5;color:#5C5C66;">You're getting this because you turned on email alerts for this item in Dipper. Turn them off on the item's page.</p>
</td></tr></table></td></tr></table></body></html>`;
  await t().sendMail({
    from: `"Dipper" <${USER}>`,
    to,
    subject: `${target != null ? 'Price alert' : 'Price drop'}: $${Number(price).toFixed(2)} — ${(title || 'your item').slice(0, 60)}`,
    html,
    text: `${headline}: ${title || 'Your item'} is now $${Number(price).toFixed(2)} at ${store}. ${storeUrl}`,
  });
  return true;
}
