import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

/* The order page polls this while the order is being worked on. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ error: 'No order at this link.' }, { status: 404 });
  const order = await (await getEngine()).view(token);
  if (!order) return NextResponse.json({ error: 'No order at this link.' }, { status: 404 });
  return NextResponse.json({ order }, { headers: { 'Cache-Control': 'no-store' } });
}
