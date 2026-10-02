'use client';
import { useEffect } from 'react';
import type { PublicOrder } from 'complyrail';
import { useViewState } from './state';

const WORKING = ['queued', 'retrying'];

/* The order, refreshed every five seconds while the worker has it. */
export function useOrder(initial: PublicOrder) {
  const [order, setOrder] = useViewState<PublicOrder>(`order:${initial.token}`, initial);
  useEffect(() => {
    if (!WORKING.includes(order.status)) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/order/${order.token}`, { cache: 'no-store' });
        if (r.ok) setOrder(((await r.json()) as { order: PublicOrder }).order);
      } catch {
        /* the next poll tries again */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [order.status, order.token, setOrder]);
  return [order, setOrder] as const;
}

/** One sentence for where the order is. A failure is never described as a clean result. */
export function statusSentence(o: PublicOrder): string {
  switch (o.status) {
    case 'awaiting_intake':
      return 'Your payment went through. Fill in the form to start your order.';
    case 'needs_input':
      return o.wait_reason || 'Your order needs an answer from you.';
    case 'queued':
      return 'Your order is being prepared. This page updates on its own.';
    case 'retrying':
      return o.wait_reason || 'A step on our side is waiting and tries again on its own.';
    case 'delivered':
      return 'Your documents are ready.';
    case 'monitoring':
      return 'Your documents are ready. Your record is checked again on a schedule while your plan is active.';
    case 'refused':
      return `${o.refusal ?? 'This order could not be made.'} Your payment was refunded.`;
    default:
      return 'Your order is saved.';
  }
}

export const showsForm = (o: PublicOrder) => o.status === 'awaiting_intake' || o.status === 'needs_input' || o.status === 'delivered';
