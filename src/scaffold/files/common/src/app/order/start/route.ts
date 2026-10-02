import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

/* Stripe sends the buyer here after paying. The engine checks the session is paid and belongs to
 * this pack, creates the order once, and the buyer lands on their order page. The worker also
 * creates the order for a buyer who closed the tab. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('session_id') ?? '';
  try {
    const engine = await getEngine();
    const order = await engine.openOrder(id);
    if (order) return NextResponse.redirect(new URL(`/order/${order.token}`, req.url), 303);
  } catch (err) {
    console.error('[order/start]', (err as Error).message);
  }
  return NextResponse.redirect(new URL('/?payment=unconfirmed', req.url), 303);
}
