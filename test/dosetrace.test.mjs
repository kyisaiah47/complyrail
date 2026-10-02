// The worked example, end to end, on the stub model. PDFs are printed by a real headless Chrome
// when one is found; CI sets COMPLYRAIL_REQUIRE_CHROME=1 so a missing browser fails the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, memoryPayments, fileOrderStore, fileStorage, fileOutbox, readZip, findChrome, checkGrounded, buildHaystack, draftGrounded } from '../src/index.js';
import pack, { briefFacts, BRIEF_VOCABULARY, compare } from '../examples/dosetrace/pack.mjs';
import { dosetraceStub } from '../examples/dosetrace/stub-model.mjs';
import { LICENCES } from '../examples/dosetrace/sample/make-licences.mjs';
import { stub } from '../src/index.js';
import { tmpDir, fakeClock, fakePdf } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.join(HERE, '..', 'examples', 'dosetrace');
const answers = JSON.parse(fs.readFileSync(path.join(EX, 'sample', 'order.json'), 'utf8'));
const session = JSON.parse(fs.readFileSync(path.join(EX, 'sample', 'session.json'), 'utf8'));
const chrome = findChrome();
const realPdf = Boolean(chrome) || process.env.COMPLYRAIL_REQUIRE_CHROME === '1';

function form({ typo = false, keep = null } = {}) {
  return {
    ...answers,
    wholesalers: answers.wholesalers.map((w, i) => ({
      name: w.name,
      license: typo && i === 1 ? 'WA-WD-0007741' : w.license,
      data_location: w.data_location,
      retention: w.retention,
      ...(keep ? { doc: { upload: keep[i] } } : {}),
    })),
  };
}
const files = answers.wholesalers.map((w, i) => ({ slot: 'licence', item: i, name: w.file, mimeType: 'application/pdf', bytes: fs.readFileSync(path.join(EX, 'sample', 'licences', w.file)) }));

function engine({ clock = fakeClock('2026-10-02T15:00:00.000Z'), provider = dosetraceStub(), pdf = realPdf ? undefined : fakePdf } = {}) {
  const dir = tmpDir('complyrail-dosetrace-');
  const payments = memoryPayments({ sessions: [session] });
  const outbox = fileOutbox({ dir: path.join(dir, 'outbox') });
  const storage = fileStorage({ dir: path.join(dir, 'files') });
  const store = fileOrderStore({ dir: path.join(dir, 'orders') });
  const e = createEngine({ pack, provider, payments, store, storage, mailer: outbox, now: clock, log: false, ...(pdf ? { renderPdf: pdf } : {}) });
  return { e, payments, outbox, storage, store, clock };
}

test('the DoseTrace pack delivers a nine-document binder from a synthetic order', { timeout: 180000 }, async () => {
  const { e, outbox, storage, store } = engine();
  const [created] = await e.syncPayments();
  let [o] = await e.tick();
  assert.equal(o.status, 'awaiting_intake');
  assert.match(outbox.list()[0].subject, /Enter your pharmacy's details/);
  assert.match(outbox.list()[0].text, /421 days from today/);

  await e.submitIntake(created.token, form({ typo: true }), files);
  [o] = await e.tick();
  assert.equal(o.status, 'needs_input');
  assert.equal(o.wait_reason, 'You typed licence number WA-WD-0007741 for Torvald Pharmaceutical Distribution LLC. The document shows WA-WD-0007740. Correct the number, or upload the right document.');
  assert.match(outbox.list().at(-1).subject, /Fix 1 answer before your binder is made/);

  const keep = [0, 1].map((i) => o.uploads.find((u) => u.item === i).id);
  await e.submitIntake(created.token, form({ keep }), []);
  [o] = await e.tick();
  assert.equal(o.status, 'delivered', o.wait_reason);

  const row = await store.get(o.id);
  assert.equal(row.determination.qualifies, true);
  assert.match(row.determination.determination, /^Small dispenser under the FDA exemption\. 9 licensed/);
  assert.equal(row.drafts.readiness_brief.source, 'model');
  const zip = readZip(fs.readFileSync(storage.pathOf('dosetrace', row.delivery.zip_path)));
  assert.deepEqual(zip.map((f) => f.name), [
    '00-binder-index.pdf',
    '01-exemption-determination.pdf',
    '02-trading-partner-log.pdf',
    '03-sop-incoming-inspection.pdf',
    '04-sop-suspect-product.pdf',
    '05-sop-saleable-returns.pdf',
    '06-tracing-response-runbook.pdf',
    '07-training-attestation.pdf',
    '08-records-retention-plan.pdf',
  ]);
  for (const f of zip) assert.equal(f.bytes.subarray(0, 5).toString(), '%PDF-', f.name);
  if (realPdf) for (const f of zip) assert.ok(f.bytes.length > 20000, `${f.name} holds a printed document`);
  const delivery = outbox.list().at(-1);
  assert.equal(delivery.subject, 'Your binder for Alder Creek Family Pharmacy is ready');
  assert.match(delivery.text, /Your determination: \*\*Small dispenser/);
  assert.equal(delivery.attachments.length, 1);
});

test('the grounding check rejects a DoseTrace brief with an invented number', async () => {
  const { e, store } = engine({ pdf: fakePdf });
  const [created] = await e.syncPayments();
  await e.tick();
  await e.submitIntake(created.token, form(), files);
  const [o] = await e.tick();
  assert.equal(o.status, 'delivered', o.wait_reason);
  const row = await store.get(o.id);
  const facts = briefFacts({ determination: row.determination, intake: row.intake });
  const good = row.drafts.readiness_brief.text;
  assert.equal(checkGrounded(good, buildHaystack([facts], BRIEF_VOCABULARY)).ok, true);
  const bad = checkGrounded(`${good} You also employ 14 delivery drivers.`, buildHaystack([facts], BRIEF_VOCABULARY));
  assert.deepEqual([bad.ok, bad.kind, bad.token], [false, 'number', '14']);
  const viaModel = await draftGrounded({ provider: dosetraceStub({ invent: true }), system: pack.narratives[0].system, facts, vocabulary: BRIEF_VOCABULARY });
  assert.deepEqual([viaModel.ok, viaModel.reason, viaModel.token], [false, 'ungrounded', '14']);
});

test('a spelled-out count passes only when the facts hold it', async () => {
  const { e, store } = engine({ pdf: fakePdf });
  const [created] = await e.syncPayments();
  await e.tick();
  await e.submitIntake(created.token, form(), files);
  const [o] = await e.tick();
  const row = await store.get(o.id);
  const facts = briefFacts({ determination: row.determination, intake: row.intake });
  // A sentence Gemini Flash drafted on this synthetic order on 2026-10-02.
  const draft = 'Three of your licensed staff have completed the DSCSA training attestation.';
  assert.equal(facts['Licensed staff named for the training attestation'], 3);
  assert.equal(checkGrounded(draft, buildHaystack([facts], BRIEF_VOCABULARY)).ok, true, 'the order names three staff');
  const two = checkGrounded(draft, buildHaystack([{ ...facts, 'Licensed staff named for the training attestation': 2 }], BRIEF_VOCABULARY));
  assert.deepEqual([two.ok, two.kind, two.token], [false, 'number', 'Three']);
  const fourteen = checkGrounded('Fourteen delivery drivers work for you.', buildHaystack([facts], BRIEF_VOCABULARY));
  assert.deepEqual([fourteen.ok, fourteen.token], [false, 'Fourteen']);
});

test('a model that keeps inventing numbers ships the binder without the brief', async () => {
  const { e, store } = engine({ provider: dosetraceStub({ invent: true }), pdf: fakePdf });
  const [created] = await e.syncPayments();
  await e.tick();
  await e.submitIntake(created.token, form(), files);
  const [o] = await e.tick();
  assert.equal(o.status, 'delivered');
  const row = await store.get(o.id);
  assert.deepEqual([row.drafts.readiness_brief.source, row.drafts.readiness_brief.rejections, row.drafts.readiness_brief.text], ['omitted', 3, null]);
});

test('after the sunset date the pack refuses the order and the payment is refunded', async () => {
  // Licences renewed past the sunset, so the document check passes and the date gate decides.
  const renewed = stub((req) => {
    const l = LICENCES.find((x) => x.file === req.file?.name);
    return { wholesalerName: l.holder, licenseNumber: l.number, state: 'Washington', expirationDate: '2030-06-30', isATP: true, confidence: 0.95 };
  });
  const { e, payments } = engine({ clock: fakeClock('2027-12-01T12:00:00.000Z'), provider: renewed, pdf: fakePdf });
  const [created] = await e.syncPayments();
  await e.tick();
  await e.submitIntake(created.token, form(), files);
  const [o] = await e.tick();
  assert.equal(o.status, 'refused');
  assert.match(o.refusal, /The exemption ended on November 27, 2027/);
  assert.equal(payments.refunds.length, 1);
});

test('over the headcount line the determination says not exempt', async () => {
  const { e, store } = engine({ pdf: fakePdf });
  const [created] = await e.syncPayments();
  await e.tick();
  await e.submitIntake(created.token, { ...form(), fte: '31' }, files);
  const [o] = await e.tick();
  assert.equal(o.status, 'delivered', o.wait_reason);
  const row = await store.get(o.id);
  assert.equal(row.determination.qualifies, false);
  assert.match(row.determination.determination, /^Not exempt\. 31 licensed/);
});

test('compare() reports each kind of disagreement in one sentence', () => {
  const w = { name: 'Kelmore Drug Supply, Inc.', license: 'WA-WD-1' };
  const found = compare({ wholesalerName: 'Other Wholesale Co', licenseNumber: 'WA-WD-2', state: 'Oregon', isATP: false, expirationDate: '2020-01-01' }, w, 'WA', '2026-10-02');
  assert.deepEqual(found.map((p) => p.kind), ['name_mismatch', 'license_mismatch', 'other_state', 'not_atp', 'expired']);
  for (const p of found) assert.match(p.message, /\.$/);
  assert.deepEqual(compare({ wholesalerName: 'Kelmore Drug Supply', licenseNumber: 'wa-wd-1', state: 'Washington', isATP: true, expirationDate: '2030-01-01' }, w, 'WA', '2026-10-02'), []);
});
