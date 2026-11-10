import { admin, vapid } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { publicKey } = await vapid(admin());
  return Response.json({ publicKey });
}
