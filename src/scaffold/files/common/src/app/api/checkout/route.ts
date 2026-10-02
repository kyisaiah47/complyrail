import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

/* Starts a Stripe Checkout session for the pack's first price. The session carries
 * metadata[product] = the pack id, which is what the pack's matches() reads.
 *
 * With no STRIPE_SECRET_KEY, and only outside production, it creates a stand-in paid session
 * instead, so the whole order flow can be tried locally without a payment account. */
export async function POST() {
  const engine = await getEngine();
  const pack = engine.pack;
  const tier = pack.prices?.[0];
  if (!tier) return NextResponse.json({ error: 'This product has no price yet.' }, { status: 500 });
  const site = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Payments are not set up on this site.' }, { status: 503 });
    const order = await engine.acceptSession({
      id: `cs_test_dev_${crypto.randomUUID().replace(/-/g, '')}`,
      status: 'complete',
      payment_status: 'paid',
      mode: tier.mode ?? 'payment',
      amount_total: tier.amount ?? 0,
      currency: 'usd',
      metadata: { product: pack.id },
      customer_details: { email: process.env.DEV_BUYER_EMAIL || 'buyer@example.com', name: 'Test Buyer' },
    });
    if (!order) return NextResponse.json({ error: "The pack's matches() did not accept the development session." }, { status: 500 });
    return NextResponse.json({ url: `${site}/order/${order.token}` });
  }

  const body = new URLSearchParams({
    mode: tier.mode === 'subscription' ? 'subscription' : 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(tier.amount ?? 0),
    'line_items[0][price_data][product_data][name]': tier.name ?? pack.id,
    'metadata[product]': pack.id,
    success_url: `${site}/order/start?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/`,
  });
  if (tier.mode === 'subscription') body.set('line_items[0][price_data][recurring][interval]', 'month');
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const d = (await r.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!r.ok || !d.url) {
    console.error('[checkout]', d.error?.message ?? r.status);
    return NextResponse.json({ error: 'Checkout could not start. Try again in a minute.' }, { status: 502 });
  }
  return NextResponse.json({ url: d.url });
}
