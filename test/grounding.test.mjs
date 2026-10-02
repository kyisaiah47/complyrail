import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrounded, buildHaystack, draftGrounded, stub } from '../src/index.js';

const FACTS = [
  'Pharmacy: Alder Creek Family Pharmacy',
  'Licensed FTE across the corporate entity: 9 (the small-dispenser line is 25)',
  'Locations owned by the same corporate entity: 1',
  'Exemption sunset: November 27, 2027',
  'Wholesalers on file: 2, Kelmore Drug Supply, Inc.; Torvald Pharmaceutical Distribution LLC',
];
const VOCAB = ['FDA', 'DSCSA', 'Drug Supply Chain Security Act'];

test('a draft built only from the facts passes', () => {
  const r = checkGrounded(
    'As Alder Creek Family Pharmacy, you count 9 licensed staff across 1 location, under the line of 25. Your exemption ends on November 27, 2027. Kelmore Drug Supply and Torvald Pharmaceutical Distribution are on file.',
    FACTS,
    VOCAB,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('an invented number is rejected and named', () => {
  const r = checkGrounded('You count 14 licensed staff across 1 location.', FACTS, VOCAB);
  assert.deepEqual(r, { ok: false, kind: 'number', token: '14' });
});

test('numbers compare whole: 20 is not grounded by 2027', () => {
  const r = checkGrounded('You have 20 days left.', FACTS, VOCAB);
  assert.equal(r.ok, false);
  assert.equal(r.token, '20');
});

test('an invented written date is rejected even when its digits appear elsewhere', () => {
  const r = checkGrounded('Your exemption ends on November 9, 2027.', FACTS, VOCAB);
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'date');
  assert.equal(r.token, 'November 9, 2027');
});

test('an invented capitalised phrase is rejected', () => {
  const r = checkGrounded('Your wholesaler Cardinal Health is on file.', FACTS, VOCAB);
  assert.deepEqual(r, { ok: false, kind: 'phrase', token: 'Cardinal Health' });
});

test('a possessive splits a run into two facts', () => {
  const r = checkGrounded("Alder Creek Family Pharmacy's DSCSA records are kept.", FACTS, VOCAB);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('vocabulary grounds domain names', () => {
  assert.equal(checkGrounded('The Drug Supply Chain Security Act applies.', FACTS, VOCAB).ok, true);
  assert.equal(checkGrounded('The Drug Supply Chain Security Act applies.', FACTS, []).ok, false);
});

test('facts may be an object of label to value', () => {
  const hay = buildHaystack({ pharmacy: 'Alder Creek Family Pharmacy', fte: 9 }, []);
  assert.equal(checkGrounded('Alder Creek Family Pharmacy has 9 staff.', hay).ok, true);
  assert.equal(checkGrounded('Alder Creek Family Pharmacy has 10 staff.', hay).ok, false);
});

test('an empty draft is rejected', () => {
  assert.equal(checkGrounded('   ', FACTS).ok, false);
});

test('draftGrounded rejects a model answer that invents a number', async () => {
  const provider = stub(() => 'You count 14 licensed pharmacists and technicians across 1 location.');
  const r = await draftGrounded({ provider, system: 'Write one paragraph.', facts: FACTS, vocabulary: VOCAB });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ungrounded');
  assert.equal(r.token, '14');
  const sent = provider.calls[0];
  assert.match(sent.system, /Use only the facts given below/);
  assert.match(sent.prompt, /Alder Creek Family Pharmacy/);
});

test('draftGrounded passes a grounded answer through', async () => {
  const provider = stub(() => 'You count 9 licensed pharmacists and technicians across 1 location.');
  const r = await draftGrounded({ provider, system: 'Write one paragraph.', facts: FACTS, vocabulary: VOCAB });
  assert.equal(r.ok, true);
  assert.equal(r.model, 'stub');
});

test('draftGrounded reports a failed call as call_failed, not as ungrounded', async () => {
  const provider = stub(() => ({ ok: false, reason: 'HTTP 429', transient: true }));
  const r = await draftGrounded({ provider, system: 's', facts: FACTS });
  assert.deepEqual([r.ok, r.reason, r.transient], [false, 'call_failed', true]);
});
