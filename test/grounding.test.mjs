import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrounded, buildHaystack, draftGrounded, stub, numberWords } from '../src/index.js';

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

test('a number word is rejected when no fact holds its value', () => {
  const r = checkGrounded('Three of your licensed staff have completed the training attestation.', ['Licensed staff named for the training attestation: 2'], VOCAB);
  assert.deepEqual(r, { ok: false, kind: 'number', token: 'Three' });
});

test('a number word passes when a fact holds its value', () => {
  assert.equal(checkGrounded('Three of your licensed staff have completed the training attestation.', ['Licensed staff named for the training attestation: 3'], VOCAB).ok, true);
  assert.equal(checkGrounded('Three of your licensed staff signed.', ['three licensed staff are named'], VOCAB).ok, true, 'the same word in the facts grounds it');
});

test('"one" and "a" are not checked as counts', () => {
  assert.equal(checkGrounded('Ask one of your locations to keep a copy.', ['Locations owned: 3'], VOCAB).ok, true);
});

test('compound number words are read as one value', () => {
  assert.deepEqual(numberWords('twenty-one days, two hundred and fifty orders, a dozen letters, thousands of pages').map((n) => n.value), [21, 250, 12, 1000]);
  assert.deepEqual(numberWords('two and three').map((n) => n.value), [2, 3]);
  assert.equal(checkGrounded('You have twenty-one days left.', ['Days left: 21']).ok, true);
  assert.deepEqual(checkGrounded('You have twenty-two days left.', ['Days left: 21']), { ok: false, kind: 'number', token: 'twenty-two' });
  assert.deepEqual(checkGrounded('It covers two hundred and fifty orders.', ['Orders: 25']), { ok: false, kind: 'number', token: 'two hundred and fifty' });
  assert.deepEqual(checkGrounded('Keep a dozen copies.', ['Copies: 2']), { ok: false, kind: 'number', token: 'dozen' });
});

test('a fact spelled out in words grounds the same count in digits', () => {
  assert.equal(checkGrounded('You have 3 wholesalers.', ['three wholesalers are on file']).ok, true);
});

test('ordinals and words that only contain a number are not counts', () => {
  assert.equal(checkGrounded('The third document is often the one someone asks for.', ['Documents: 9']).ok, true);
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
