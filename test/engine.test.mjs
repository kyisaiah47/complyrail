import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createEngine,
  definePack,
  validateFields,
  determination,
  refusal,
  needsInput,
  done,
  retry,
  Retry,
  stub,
  memoryPayments,
  fileOrderStore,
  fileStorage,
  fileOutbox,
  readZip,
  backoffMinutes,
  STAGES,
} from '../src/index.js';
import { tmpDir, fakeClock, fakePdf, paidSession } from './helpers.mjs';

const FIELDS = [
  { name: 'business', label: 'the business name', required: true },
  { name: 'staff', label: 'the staff count', type: 'integer', required: true, minValue: 0 },
  { name: 'licences', label: 'Licences', type: 'list', min: 1, of: [{ name: 'holder', required: true }, { name: 'doc', type: 'file', slot: 'licence', required: true }] },
];

function makePack(overrides = {}) {
  return definePack({
    id: 'testpack',
    matches: (s) => (s.metadata?.product === 'testpack' ? { id: 'standard', name: 'Standard', amount: 1900, mode: s.mode === 'subscription' ? 'subscription' : 'payment' } : null),
    intake: { fields: FIELDS, validate: (form, ctx) => validateFields(FIELDS, form, ctx) },
    documents: [
      {
        slot: 'licence',
        schema: { about: 'a business licence', fields: { holder: 'string', number: 'string', expires: 'date' } },
        mime: ['application/pdf'],
        minConfidence: 0.7,
        privacy: 'full',
        validate: (read, intake) => {
          const row = intake.licences[read.item];
          return read.value.holder === row.holder ? [] : [`The licence you uploaded names ${read.value.holder}. Upload the licence for ${row.holder}.`];
        },
      },
    ],
    determine: (ctx) => {
      if (ctx.intake.staff > 100) return refusal('This product covers businesses with 100 staff or fewer.');
      return determination({ summary: `${ctx.intake.business} is in scope.`, small: ctx.intake.staff <= 25 });
    },
    narratives: [
      {
        slot: 'brief',
        system: 'Write one sentence.',
        facts: (ctx) => [`Business: ${ctx.intake.business}`, `Staff: ${ctx.intake.staff}`],
        vocabulary: [],
        fallback: 'omit',
      },
    ],
    render: (ctx) => [
      { name: '01-summary', template: '# Summary\n\n{{business}} has {{staff}} staff.\n\n{{brief}}', format: 'pdf', fields: { business: ctx.intake.business, staff: ctx.intake.staff, brief: ctx.drafts.brief ?? '' } },
      { name: '02-licences', template: 'holder\n' + ctx.intake.licences.map((l) => l.holder).join('\n'), format: 'csv' },
    ],
    checks: (files) => files.filter((f) => f.format === 'pdf' && !f.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))).map((f) => `${f.name} is not a PDF`),
    mail: {
      from: 'Test Pack <orders@example.com>',
      intake: 'Subject: Fill in your form\n\nHi {{first_name}}, open {{order_url}}.',
      delivery: 'Subject: Your pack is ready\n\nHi {{first_name}}, {{file_count}} files are attached.\n{{file_list}}',
      reminderDays: 3,
    },
    ...overrides,
  });
}

function setup({ pack = makePack(), respond, sessions = [paidSession('cs_test_one')] } = {}) {
  const dir = tmpDir();
  const clock = fakeClock();
  const payments = memoryPayments({ sessions });
  const provider = stub(
    respond ||
      ((req) => {
        if (req.purpose === 'read') return { holder: 'Harbor Bakery', number: 'BL-1001', expires: '2028-01-31', confidence: 0.95 };
        return 'Harbor Bakery has 12 staff.';
      }),
  );
  const outbox = fileOutbox({ dir: path.join(dir, 'outbox') });
  const storage = fileStorage({ dir: path.join(dir, 'files') });
  const store = fileOrderStore({ dir: path.join(dir, 'orders') });
  const engine = createEngine({ pack, provider, payments, store, storage, mailer: outbox, siteUrl: 'https://pack.example', renderPdf: fakePdf, now: clock, log: false });
  return { engine, clock, payments, provider, outbox, storage, store, dir };
}

const PDF = (name = 'licence.pdf') => ({ slot: 'licence', item: 0, name, mimeType: 'application/pdf', bytes: Buffer.from(`%PDF-1.4 ${name}`) });
const FORM = { business: 'Harbor Bakery', staff: '12', licences: [{ holder: 'Harbor Bakery' }] };

test('the stage list is the spec list, in order', () => {
  assert.deepEqual(STAGES, ['verify_payment', 'request_intake', 'validate_intake', 'read_documents', 'fetch_sources', 'determine', 'draft', 'render', 'deliver', 'act', 'monitor']);
});

test('backoff is 2, 4, 8 minutes up to the ceiling', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9].map((n) => backoffMinutes(n, 60)), [2, 4, 8, 16, 32, 60, 60, 60]);
  assert.equal(backoffMinutes(5, 20), 20);
});

test('a paid order runs from payment to delivery', async () => {
  const { engine, outbox, storage } = setup();
  const created = await engine.syncPayments();
  assert.equal(created.length, 1);
  assert.equal((await engine.syncPayments()).length, 0, 'a session becomes one order only');

  let [o] = await engine.tick();
  assert.equal(o.status, 'awaiting_intake');
  assert.equal(o.stage, 'request_intake');
  assert.match(outbox.list()[0].subject, /Fill in your form/);
  assert.match(outbox.list()[0].text, /https:\/\/pack\.example\/order\//);

  await engine.submitIntake(o.token, FORM, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered', JSON.stringify(o));
  assert.equal(o.stage, 'complete');
  assert.deepEqual(o.files.map((f) => f.name), ['01-summary.pdf', '02-licences.csv']);
  assert.equal(o.has_download, true);

  const mails = outbox.list();
  const delivery = mails[mails.length - 1];
  assert.match(delivery.subject, /ready/);
  assert.equal(delivery.attachments.length, 1);

  const url = await engine.download(o.token);
  assert.match(url, /^file:/);
  const zip = readZip(fs.readFileSync(new URL(url)));
  assert.deepEqual(zip.map((e) => e.name), ['01-summary.pdf', '02-licences.csv']);
  assert.match(zip[1].bytes.toString(), /Harbor Bakery/);
  assert.ok(storage);
});

test('a document that disagrees with the answers waits for the buyer, then continues', async () => {
  let holder = 'Harbour Bakeries Ltd';
  const { engine, outbox, provider } = setup({
    respond: (req) => (req.purpose === 'read' ? { holder, number: 'BL-1', expires: null, confidence: 0.9 } : 'Harbor Bakery has 12 staff.'),
  });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF('wrong.pdf')]);
  [o] = await engine.tick();
  assert.equal(o.status, 'needs_input');
  assert.equal(o.stage, 'read_documents');
  assert.match(o.wait_reason, /names Harbour Bakeries Ltd/);
  assert.equal(o.problems.length, 1);
  assert.match(outbox.list().at(-1).text, /names Harbour Bakeries Ltd/);
  assert.equal((await engine.tick()).length, 0, 'a waiting order is not polled');

  holder = 'Harbor Bakery';
  await engine.submitIntake(o.token, FORM, [PDF('right.pdf')]);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
  assert.equal(provider.calls.filter((c) => c.purpose === 'read').length, 2);
});

test('a kept upload is not read again', async () => {
  let reads = 0;
  const { engine } = setup({
    respond: (req) => {
      if (req.purpose === 'read') {
        reads++;
        return { holder: 'Harbor Bakery', number: 'BL-1', expires: null, confidence: 0.9 };
      }
      return 'Harbor Bakery has 12 staff.';
    },
  });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, { ...FORM, staff: 'many' }, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'needs_input');
  assert.match(o.wait_reason, /whole number/);
  const keep = { ...FORM, licences: [{ holder: 'Harbor Bakery', doc: { upload: o.uploads[0].id } }] };
  await engine.submitIntake(o.token, keep, []);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
  assert.equal(reads, 1);
});

test('a model outage retries with backoff and never drops the order', async () => {
  let down = true;
  const { engine, clock } = setup({
    respond: (req) => (down ? { ok: false, reason: 'HTTP 429 quota', transient: true } : req.purpose === 'read' ? { holder: 'Harbor Bakery', number: 'BL-1', expires: null, confidence: 0.9 } : 'Harbor Bakery has 12 staff.'),
  });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  const waits = [];
  for (let i = 0; i < 4; i++) {
    [o] = await engine.tick();
    assert.equal(o.status, 'retrying');
    assert.equal(o.stage, 'read_documents');
    waits.push(Math.round((Date.parse(o.next_attempt_at) - clock().getTime()) / 60000));
    assert.equal((await engine.tick()).length, 0, 'not due before its time');
    clock.set(o.next_attempt_at);
  }
  assert.deepEqual(waits, [2, 4, 8, 16]);
  assert.match(o.wait_reason, /You do not need to do anything/);
  down = false;
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
});

test('a crash inside a stage is a retry, not a lost order', async () => {
  let crash = true;
  const pack = makePack({
    determine: (ctx) => {
      if (crash) throw new Error('boom');
      return determination({ summary: 'ok' });
    },
  });
  const { engine, clock } = setup({ pack });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'retrying');
  assert.equal(o.stage, 'determine');
  crash = false;
  clock.set(o.next_attempt_at);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
});

test('a refusal refunds the payment and closes the order', async () => {
  const { engine, payments, outbox } = setup();
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, { ...FORM, staff: '250' }, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'refused');
  assert.equal(o.refusal, 'This product covers businesses with 100 staff or fewer.');
  assert.equal(payments.refunds.length, 1);
  assert.equal(payments.refunds[0].session, 'cs_test_one');
  assert.match(outbox.list().at(-1).text, /refunded in full/);
  await assert.rejects(engine.submitIntake(o.token, FORM, []), /refunded and is closed/);
});

test('three ungrounded drafts fall back to the declared fallback', async (t) => {
  await t.test('omit', async () => {
    const { engine } = setup({ respond: (req) => (req.purpose === 'read' ? { holder: 'Harbor Bakery', number: 'BL-1', expires: null, confidence: 0.9 } : 'Harbor Bakery has 99 staff.') });
    await engine.syncPayments();
    let [o] = await engine.tick();
    await engine.submitIntake(o.token, FORM, [PDF()]);
    [o] = await engine.tick();
    assert.equal(o.status, 'delivered');
    const order = await engine.view(o.token);
    assert.ok(order);
  });
  await t.test('print the buyer words', async () => {
    const pack = makePack({
      narratives: [{ slot: 'brief', system: 's', facts: (ctx) => [`Business: ${ctx.intake.business}`], vocabulary: [], fallback: { print: (ctx) => `Prepared for ${ctx.intake.business}.` } }],
    });
    const { engine, store } = setup({ pack, respond: (req) => (req.purpose === 'read' ? { holder: 'Harbor Bakery', number: 'BL-1', expires: null, confidence: 0.9 } : 'Invented Company Name.') });
    await engine.syncPayments();
    let [o] = await engine.tick();
    await engine.submitIntake(o.token, FORM, [PDF()]);
    [o] = await engine.tick();
    const row = await store.get(o.id);
    assert.equal(row.drafts.brief.source, 'buyer_words');
    assert.equal(row.drafts.brief.rejections, 3);
    assert.equal(row.drafts.brief.text, 'Prepared for Harbor Bakery.');
  });
  await t.test('ask the buyer', async () => {
    const pack = makePack({
      narratives: [{ slot: 'brief', system: 's', facts: (ctx) => [`Business: ${ctx.intake.business}`], vocabulary: [], fallback: { ask: 'Tell us more about your business in the notes field.' } }],
    });
    const { engine } = setup({ pack, respond: (req) => (req.purpose === 'read' ? { holder: 'Harbor Bakery', number: 'BL-1', expires: null, confidence: 0.9 } : 'It has 77 staff.') });
    await engine.syncPayments();
    let [o] = await engine.tick();
    await engine.submitIntake(o.token, FORM, [PDF()]);
    [o] = await engine.tick();
    assert.equal(o.status, 'needs_input');
    assert.equal(o.stage, 'draft');
    assert.equal(o.wait_reason, 'Tell us more about your business in the notes field.');
  });
});

test('a low-confidence read asks for a sharper file', async () => {
  const { engine } = setup({ respond: (req) => (req.purpose === 'read' ? { holder: 'Harbor Bakery', confidence: 0.3 } : 'x') });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'needs_input');
  assert.match(o.wait_reason, /could not read licence\.pdf clearly/);
});

test('unparseable reads retry, then ask the buyer after three', async () => {
  const { engine, clock } = setup({ respond: () => 'not json at all' });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  for (let i = 0; i < 2; i++) {
    [o] = await engine.tick();
    assert.equal(o.status, 'retrying');
    clock.set(o.next_attempt_at);
  }
  [o] = await engine.tick();
  assert.equal(o.status, 'needs_input');
  assert.match(o.wait_reason, /could not read licence\.pdf/);
});

test('one intake reminder goes out after the reminder delay', async () => {
  const { engine, clock, outbox } = setup();
  await engine.syncPayments();
  let [o] = await engine.tick();
  assert.equal(outbox.list().length, 1);
  clock.advance(3 * 86400000 + 1000);
  [o] = await engine.tick();
  assert.equal(o.status, 'awaiting_intake');
  assert.equal(outbox.list().length, 2);
  assert.match(outbox.list()[1].subject, /^Reminder: /);
  clock.advance(10 * 86400000);
  assert.equal((await engine.tick()).length, 0, 'only one reminder');
});

test('a source outage retries', async () => {
  let up = false;
  const pack = makePack({
    sources: [
      {
        name: 'registry',
        fetch: () => {
          if (!up) throw new Retry('registry is down');
          return { listed: true };
        },
      },
    ],
  });
  const { engine, clock, store } = setup({ pack });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'retrying');
  assert.equal(o.stage, 'fetch_sources');
  up = true;
  clock.set(o.next_attempt_at);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
  assert.deepEqual((await store.get(o.id)).sources, { registry: { listed: true } });
});

test('actions run once each, with their own retry', async () => {
  let filed = 0;
  let portalUp = false;
  const pack = makePack({
    actions: [
      {
        state: 'filed',
        run: () => {
          if (!portalUp) return retry('portal is down');
          filed++;
          return done();
        },
      },
    ],
  });
  const { engine, clock } = setup({ pack });
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.stage, 'act');
  assert.equal(o.status, 'retrying');
  assert.equal(o.has_download, true, 'the pack is delivered before the action');
  portalUp = true;
  clock.set(o.next_attempt_at);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
  assert.equal(filed, 1);
});

test('monitor re-checks while the subscription is active and stops when it lapses', async () => {
  const reports = [];
  const pack = makePack({
    monitor: {
      everyDays: 30,
      run: (order) => {
        reports.push(order.id);
        return { subject: 'Your record changed', text: 'One listing changed. See {{order_url}}.' };
      },
    },
  });
  const session = paidSession('cs_test_sub', { mode: 'subscription', subscription: 'sub_1' });
  const { engine, clock, payments, outbox } = setup({ pack, sessions: [session] });
  payments.setSubscription('sub_1', 'active');
  await engine.syncPayments();
  let [o] = await engine.tick();
  await engine.submitIntake(o.token, FORM, [PDF()]);
  [o] = await engine.tick();
  assert.equal(o.status, 'monitoring');
  assert.equal(reports.length, 0);
  clock.advance(30 * 86400000);
  [o] = await engine.tick();
  assert.equal(reports.length, 1);
  assert.match(outbox.list().at(-1).subject, /Your record changed/);
  payments.setSubscription('sub_1', 'canceled');
  clock.advance(30 * 86400000);
  [o] = await engine.tick();
  assert.equal(o.status, 'delivered');
  assert.equal(reports.length, 1);
});

test('openOrder accepts only a paid session for this pack', async () => {
  const { engine, payments } = setup({ sessions: [] });
  payments.addSession(paidSession('cs_test_other', { metadata: { product: 'something-else' } }));
  payments.addSession({ ...paidSession('cs_test_unpaid'), payment_status: 'unpaid' });
  payments.addSession(paidSession('cs_test_mine'));
  assert.equal(await engine.openOrder('cs_test_other'), null);
  assert.equal(await engine.openOrder('cs_test_unpaid'), null);
  const o = await engine.openOrder('cs_test_mine');
  assert.equal(o.status, 'queued');
  assert.equal((await engine.openOrder('cs_test_mine')).id, o.id);
});

test('an upload of the wrong type is refused with one sentence', async () => {
  const { engine } = setup();
  await engine.syncPayments();
  const [o] = await engine.tick();
  await assert.rejects(engine.submitIntake(o.token, FORM, [{ slot: 'licence', item: 0, name: 'a.exe', mimeType: 'application/x-msdownload', bytes: Buffer.from('MZ') }]), /Upload a\.exe as a pdf file/);
});

test('definePack names the first missing piece', () => {
  assert.throws(() => definePack({ id: 'x' }), /matches\(session\)/);
  assert.throws(() => makePack({ narratives: [{ slot: 'a', system: 's', facts: () => [], vocabulary: [], fallback: 'guess' }] }), /fallback/);
});

test('needsInput, retry and done carry their fields', () => {
  assert.equal(needsInput('Fix it.', { problems: ['one'] }).problems[0].message, 'one');
  assert.equal(retry('busy').kind, 'retry');
  assert.equal(done({ a: 1 }).patch.a, 1);
});
