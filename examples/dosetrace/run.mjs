// Runs one synthetic DoseTrace order end to end and writes everything it made to ./out.
//
//   node examples/dosetrace/run.mjs                    # stub model, no network
//   GEMINI_API_KEY=... node examples/dosetrace/run.mjs --provider gemini
//
// PDFs need a Chrome or Chromium binary: set CHROME_PATH, or have google-chrome or chromium on the
// PATH. Payments are in memory, orders and files are on disk, and mail goes to an outbox folder.
// Nothing is charged, sent or uploaded.
//
// The run shows four things:
//   1. a paid session becomes an order and the buyer is sent the form link,
//   2. a typed licence number that disagrees with the uploaded licence stops the order with one
//      sentence for the buyer,
//   3. the corrected form runs through every stage to a delivered binder of nine PDFs,
//   4. the grounding check rejects a draft that adds a number no fact holds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEngine,
  gemini,
  memoryPayments,
  fileOrderStore,
  fileStorage,
  fileOutbox,
  readZip,
  checkGrounded,
  draftGrounded,
  buildHaystack,
} from 'complyrail';
import pack, { briefFacts, BRIEF_VOCABULARY } from './pack.mjs';
import { dosetraceStub } from './stub-model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const PROVIDER = arg('provider', 'stub');
const OUT = path.resolve(arg('out', path.join(HERE, 'out')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (p) => JSON.parse(fs.readFileSync(path.join(HERE, p), 'utf8'));
const answers = read('sample/order.json');
const session = read('sample/session.json');

function formFrom(a, { licenceTypo = false, keep = null } = {}) {
  return {
    pharmacy_name: a.pharmacy_name,
    dba: a.dba,
    address: a.address,
    city: a.city,
    state: a.state,
    state_license: a.state_license,
    owner_name: a.owner_name,
    owner_title: a.owner_title,
    fte: a.fte,
    locations: a.locations,
    wholesalers: a.wholesalers.map((w, i) => ({
      name: w.name,
      license: licenceTypo && i === 1 ? 'WA-WD-0007741' : w.license,
      data_location: w.data_location,
      retention: w.retention,
      ...(keep ? { doc: { upload: keep[i] } } : {}),
    })),
    staff: a.staff,
  };
}

const files = answers.wholesalers.map((w, i) => ({
  slot: 'licence',
  item: i,
  name: w.file,
  mimeType: 'application/pdf',
  bytes: fs.readFileSync(path.join(HERE, 'sample', 'licences', w.file)),
}));

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let provider;
  let interval = 0;
  if (PROVIDER === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('--provider gemini needs GEMINI_API_KEY');
    provider = gemini({ apiKey: process.env.GEMINI_API_KEY });
    // The free tier allows a few requests a minute per model.
    interval = 13000;
  } else if (PROVIDER === 'stub') {
    provider = dosetraceStub();
  } else {
    throw new Error(`unknown provider ${PROVIDER}; use stub or gemini`);
  }

  const outbox = fileOutbox({ dir: path.join(OUT, 'outbox') });
  const storage = fileStorage({ dir: path.join(OUT, 'files') });
  const store = fileOrderStore({ dir: path.join(OUT, 'orders') });
  const events = [];
  const engine = createEngine({
    pack,
    provider,
    payments: memoryPayments({ sessions: [session] }),
    store,
    storage,
    mailer: outbox,
    siteUrl: 'http://localhost:3000',
    modelIntervalMs: interval,
    log: (e) => {
      events.push(e);
      console.log(`  ${e.stage.padEnd(16)} ${e.result.padEnd(12)} ${e.note ? String(e.note).slice(0, 110) : ''}`);
    },
  });

  console.log(`ComplyRail DoseTrace example, provider: ${provider.name}`);
  console.log('\n1. The paid session becomes an order.');
  const [created] = await engine.syncPayments();
  let o = (await engine.tick())[0];
  console.log(`   status ${o.status}, intake email: "${outbox.list()[0].subject}"`);

  console.log('\n2. The buyer sends the form with a mistyped licence number.');
  o = await engine.submitIntake(created.token, formFrom(answers, { licenceTypo: true }), files);
  o = await runUntilWaiting(engine, o.token);
  console.log(`   status ${o.status}: ${o.wait_reason}`);
  const firstStop = { status: o.status, sentence: o.wait_reason };

  console.log('\n3. The buyer corrects the number and keeps both uploaded licences.');
  const keep = files.map((_, i) => o.uploads.find((u) => u.item === i).id);
  o = await engine.submitIntake(created.token, formFrom(answers, { keep }), []);
  o = await runUntilWaiting(engine, o.token);
  console.log(`   status ${o.status}`);
  if (o.status !== 'delivered') throw new Error(`the order did not deliver: ${o.status} ${o.wait_reason}`);

  const row = await store.get(o.id);
  const zipPath = storage.pathOf(pack.id, row.delivery.zip_path);
  const zip = readZip(fs.readFileSync(zipPath));
  const binderDir = path.join(OUT, 'binder');
  fs.mkdirSync(binderDir, { recursive: true });
  for (const e of zip) fs.writeFileSync(path.join(binderDir, e.name), e.bytes);
  console.log(`   determination: ${row.determination.determination}`);
  console.log(`   readiness brief: ${row.drafts.readiness_brief.source}${row.drafts.readiness_brief.rejections ? `, after ${row.drafts.readiness_brief.rejections} rejected drafts` : ''}`);
  if (row.drafts.readiness_brief.text) console.log(`   "${row.drafts.readiness_brief.text}"`);
  console.log(`   ${zip.length} files in ${path.relative(process.cwd(), zipPath)}:`);
  for (const e of zip) console.log(`     ${e.name.padEnd(36)} ${String(e.bytes.length).padStart(7)} bytes  ${e.bytes.subarray(0, 5).toString() === '%PDF-' ? 'PDF' : 'not a PDF'}`);
  console.log(`   ${outbox.list().length} emails in ${path.relative(process.cwd(), path.join(OUT, 'outbox'))}: ${outbox.list().map((m) => `"${m.subject}"`).join(', ')}`);

  console.log('\n4. The grounding check rejects an invented number.');
  const ctx = { determination: row.determination, intake: row.intake };
  const facts = briefFacts(ctx);
  const base = row.drafts.readiness_brief.text || 'Alder Creek Family Pharmacy has 9 licensed pharmacists and technicians on record.';
  const tampered = `${base} You also employ 14 delivery drivers.`;
  const direct = checkGrounded(tampered, buildHaystack([facts], BRIEF_VOCABULARY));
  console.log(`   checkGrounded on the delivered brief plus "You also employ 14 delivery drivers.": ${direct.ok ? 'accepted' : `rejected, ungrounded ${direct.kind} "${direct.token}"`}`);
  const viaModel = await draftGrounded({ provider: dosetraceStub({ invent: true }), system: pack.narratives[0].system, facts, vocabulary: BRIEF_VOCABULARY });
  console.log(`   draftGrounded with a model that writes 14 for the headcount: ${viaModel.ok ? 'accepted' : `rejected, ungrounded ${viaModel.kind} "${viaModel.token}"`}`);

  const report = {
    provider: provider.name,
    order: o.id,
    first_stop: firstStop,
    status: o.status,
    determination: row.determination.determination,
    brief: row.drafts.readiness_brief,
    files: zip.map((e) => ({ name: e.name, bytes: e.bytes.length, pdf: e.bytes.subarray(0, 5).toString() === '%PDF-' })),
    emails: outbox.list().map((m) => m.subject),
    grounding: { tampered_rejected: !direct.ok, token: direct.token, model_invention_rejected: !viaModel.ok, model_token: viaModel.token },
    history: row.history.map((h) => `${h.stage} ${h.result}`),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nReport: ${path.relative(process.cwd(), path.join(OUT, 'report.json'))}. Binder PDFs: ${path.relative(process.cwd(), binderDir)}`);
  if (direct.ok || viaModel.ok) throw new Error('the grounding check accepted an invented number');
}

/* Tick until the order waits on the buyer or finishes. A model outage puts it in retrying; the
 * example then waits for the retry time, as the worker would, for up to 30 minutes. */
async function runUntilWaiting(engine, token) {
  const deadline = Date.now() + 30 * 60000;
  for (;;) {
    await engine.tick();
    const o = await engine.view(token);
    if (o.status !== 'retrying' && o.status !== 'queued') return o;
    if (Date.now() > deadline) return o;
    const wait = Math.max(1000, Date.parse(o.next_attempt_at) - Date.now());
    console.log(`   waiting ${Math.round(wait / 1000)} s for the retry: ${o.wait_reason}`);
    await sleep(wait);
  }
}

main().catch((err) => {
  console.error(`\nThe example failed: ${err.message}`);
  process.exit(1);
});
