// In-memory payments for development and tests. It holds Checkout sessions you add and records
// every refund. It never touches Stripe.

export function memoryPayments({ sessions = [], subscriptions = {} } = {}) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const subs = new Map(Object.entries(subscriptions));
  const refunds = [];
  return {
    name: 'memory',
    refunds,
    addSession(session) {
      byId.set(session.id, session);
      return session;
    },
    setSubscription(id, status) {
      subs.set(id, status);
    },
    async listPaidSessions() {
      return [...byId.values()].filter((s) => s.status === 'complete' && ['paid', 'no_payment_required'].includes(s.payment_status));
    },
    async getSession(id) {
      return byId.get(id) ?? null;
    },
    async refund(session) {
      const id = `re_memory_${refunds.length + 1}`;
      refunds.push({ id, session: session.id, amount: session.amount_total ?? null });
      return { id };
    },
    async subscriptionActive(order) {
      const id = order.session?.subscription;
      if (!id) return false;
      return ['active', 'trialing'].includes(subs.get(id));
    },
  };
}
