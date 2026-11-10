// Temporary diagnostics for the ShopSavvy connection.
import { listTools, callTool } from '@/lib/shopsavvy';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req) {
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get('tools')) {
      const t = await listTools();
      return Response.json(t.tools.map((x) => ({ name: x.name, input: x.inputSchema?.properties, required: x.inputSchema?.required })));
    }
    const name = sp.get('tool');
    const args = JSON.parse(sp.get('args') || '{}');
    const r = await callTool(name, args);
    return Response.json({ isError: r.isError, json: r.json, text: r.text.slice(0, 6000) });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
