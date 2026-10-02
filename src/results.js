// The three results every stage returns, and the three outcomes a pack's determine() returns.
//
// A stage returns done, retry(reason) or needsInput(sentence). Nothing else moves an order.
// A thrown error is treated as retry(error.message), so a crash never drops a paid order.

/** The stage finished. `patch` is merged into the order row. */
export function done(patch = {}, options = {}) {
  return { kind: 'done', patch, halt: options.halt ?? null, rescheduleAt: options.rescheduleAt ?? null };
}

/** The stage could not finish for a reason the buyer cannot fix. The engine backs off and tries again. */
export function retry(reason, patch = {}, options = {}) {
  return { kind: 'retry', reason: String(reason ?? 'unknown failure'), patch, waitReason: options.waitReason ?? null };
}

/**
 * Only the buyer can fix this. `sentence` is shown on the order page and emailed.
 * `problems` lists each answer to fix. `recheckAt` wakes the order without the buyer, for example to
 * send an intake reminder.
 */
export function needsInput(sentence, options = {}) {
  return {
    kind: 'needs_input',
    sentence: String(sentence),
    problems: (options.problems ?? []).map(toProblem),
    recheckAt: options.recheckAt ?? null,
    patch: options.patch ?? {},
  };
}

/** determine() found the result. `value` is stored on the order and passed to render(). */
export function determination(value) {
  return { kind: 'determination', value };
}

/** determine() refused the order. The engine refunds the payment unless `refund` is false. */
export function refusal(reason, options = {}) {
  return { kind: 'refusal', reason: String(reason), refund: options.refund !== false };
}

/** Thrown by a source connector or an action when the outside service is down. The stage retries. */
export class Retry extends Error {
  constructor(reason) {
    super(String(reason));
    this.name = 'Retry';
  }
}

/** A problem is one sentence for the buyer, plus optional machine fields. */
export function toProblem(p) {
  if (typeof p === 'string') return { message: p };
  if (p && typeof p.message === 'string') return { ...p };
  return { message: String(p) };
}

export const RESULT_KINDS = ['done', 'retry', 'needs_input'];

export function isResult(r) {
  return Boolean(r && RESULT_KINDS.includes(r.kind));
}
