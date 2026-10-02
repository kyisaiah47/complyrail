// Stripe over its REST API. It reads Checkout sessions, refunds them and checks subscriptions.
// A 429 or 5xx is retried three times with a short pause before the call gives up.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function stripePayments({ secretKey, baseURL = 'https://api.stripe.com/v1', fetch: fetchImpl = globalThis.fetch, tries = 3, timeoutMs = 15000 } = {}) {
  if (!secretKey) throw new Error('stripePayments needs a secretKey');
  const base = baseURL.replace(/\/$/, '');
  const auth = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

  async function call(method, path, { form, idempotencyKey } = {}) {
    let last;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const headers = { Authorization: auth };
        if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        const r = await fetchImpl(`${base}/${path}`, {
          method,
          headers,
          body: form ? new URLSearchParams(form).toString() : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && !d.error) return d;
        const err = new Error(`stripe ${method} ${path}: ${d.error?.message || r.status}`);
        if (r.status < 500 && r.status !== 429) {
          err.status = r.status;
          throw err;
        }
        last = err;
      } catch (e) {
        if (e.status) throw e;
        last = e;
      }
      if (attempt < tries) await sleep(attempt * 1000);
    }
    throw last;
  }

  return {
    name: 'stripe',
    /** Paid, complete Checkout sessions created in the last `days` days. */
    async listPaidSessions({ days = 30 } = {}) {
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const out = [];
      let after = null;
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ limit: '100', status: 'complete', 'created[gte]': String(since) });
        if (after) q.set('starting_after', after);
        const d = await call('GET', `checkout/sessions?${q}`);
        out.push(...d.data.filter((s) => ['paid', 'no_payment_required'].includes(s.payment_status)));
        if (!d.has_more || !d.data.length) break;
        after = d.data[d.data.length - 1].id;
      }
      return out;
    },
    async getSession(id) {
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(String(id))) return null;
      try {
        return await call('GET', `checkout/sessions/${id}`);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    /** Refund the whole payment behind a Checkout session. Idempotent per session. */
    async refund(session) {
      const s = session.payment_intent || session.invoice ? session : await call('GET', `checkout/sessions/${session.id}`);
      let paymentIntent = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (!paymentIntent && s.invoice) {
        const inv = await call('GET', `invoices/${typeof s.invoice === 'string' ? s.invoice : s.invoice.id}`);
        paymentIntent = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id;
      }
      if (!paymentIntent) throw new Error(`stripe: session ${s.id} has no payment to refund`);
      const rf = await call('POST', 'refunds', {
        form: { payment_intent: paymentIntent, 'metadata[reason]': 'complyrail refusal' },
        idempotencyKey: `complyrail-refund-${s.id}`,
      });
      return { id: rf.id };
    },
    async subscriptionActive(order) {
      const id = typeof order.session?.subscription === 'string' ? order.session.subscription : order.session?.subscription?.id;
      if (!id) return false;
      const sub = await call('GET', `subscriptions/${id}`);
      return ['active', 'trialing'].includes(sub.status);
    },
  };
}
