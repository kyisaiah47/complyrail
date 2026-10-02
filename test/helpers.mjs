// Shared test helpers. Nothing here reads a paid provider key or touches the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir(prefix = 'complyrail-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A clock the test moves by hand. */
export function fakeClock(start = '2026-10-02T12:00:00.000Z') {
  let t = Date.parse(start);
  const now = () => new Date(t);
  now.advance = (ms) => {
    t += ms;
  };
  now.advanceMinutes = (m) => {
    t += m * 60000;
  };
  now.set = (iso) => {
    t = Date.parse(iso);
  };
  return now;
}

/** A renderer that returns a stand-in PDF without a browser, for tests about the engine itself.
 *  It is padded past the size a pack's output check expects of a printed document. */
export async function fakePdf(html) {
  const head = Buffer.from(`%PDF-1.4\n% test render of ${html.length} bytes of HTML\n`);
  return Buffer.concat([head, Buffer.alloc(4096, 0x20), Buffer.from('\n%%EOF\n')]);
}

export function paidSession(id, extra = {}) {
  return {
    id,
    status: 'complete',
    payment_status: 'paid',
    mode: 'payment',
    amount_total: 1900,
    currency: 'usd',
    payment_intent: `pi_${id}`,
    metadata: { product: 'testpack' },
    customer_details: { email: 'buyer@example.com', name: 'Robin Example' },
    custom_fields: [],
    ...extra,
  };
}
