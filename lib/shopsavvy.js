// ShopSavvy's free public product-data service (no key; 100 calls/hour per server).
// Product lookup by store link, current prices at every store, and price history.
const ENDPOINT = 'https://api.shopsavvy.com/mcp';
let session = null;
let nextId = 1;

async function rpc(method, params, { notify = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  };
  if (session) headers['mcp-session-id'] = session;
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: nextId++, method, params };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session = sid;
    if (notify) return null;
    const text = await res.text();
    let msg = null;
    if ((res.headers.get('content-type') || '').includes('event-stream')) {
      for (const line of text.split('\n')) {
        if (line.startsWith('data:')) {
          try {
            const m = JSON.parse(line.slice(5).trim());
            if (m.id === body.id || m.result || m.error) msg = m;
          } catch {}
        }
      }
    } else {
      try { msg = JSON.parse(text); } catch { msg = { error: { message: text.slice(0, 300) } }; }
    }
    if (!msg) throw new Error(`ShopSavvy ${res.status}: ${text.slice(0, 200)}`);
    if (msg.error) throw new Error(`ShopSavvy: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  } finally {
    clearTimeout(t);
  }
}

async function ensure() {
  if (session !== null) return;
  session = '';
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dipper', version: '1.0.0' } });
  await rpc('notifications/initialized', {}, { notify: true });
}

export async function listTools() {
  await ensure();
  return rpc('tools/list', {});
}

// Returns { text, json } — json is parsed structured content when the tool provides it.
export async function callTool(name, args) {
  await ensure();
  try {
    return unpack(await rpc('tools/call', { name, arguments: args }));
  } catch (e) {
    if (/session/i.test(e.message)) {
      session = null;
      await ensure();
      return unpack(await rpc('tools/call', { name, arguments: args }));
    }
    throw e;
  }
}

function unpack(result) {
  const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json = result?.structuredContent || null;
  if (!json) {
    try { json = JSON.parse(text); } catch {}
  }
  return { text, json, isError: !!result?.isError };
}
