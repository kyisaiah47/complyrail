// THE ENGINE. One paid order moves through eleven stages. Each stage reads and writes one order row.
//
//   verify_payment  request_intake  validate_intake  read_documents  fetch_sources  determine
//   draft  render  deliver  act  monitor
//
// Every stage returns done, retry(reason) or needsInput(sentence). A retry backs off 2, 4, 8 ...
// minutes up to a ceiling and never stops. A crash is a retry. A stage that only the buyer can fix
// waits with one sentence on the order page. A refusal refunds the payment. A paid order is never
// dropped and never delivered short.
//
// The pack decides the outcome with plain functions. The model only reads documents into typed
// fields and drafts text from a closed list of facts, and every draft passes the grounding rule.
import crypto from 'node:crypto';
import { done, retry, needsInput, Retry, toProblem, isResult } from './results.js';
import { definePack, assertDocs } from './pack.js';
import { readDocument as readDocumentService } from './services/read-document.js';
import { draftGrounded as draftService } from './services/draft.js';
import { renderPdf as defaultRenderPdf } from './render/pdf.js';
import { htmlDocument } from './render/document.js';
import { fillTemplate, renderMail } from './template.js';
import { makeZip } from './render/zip.js';
import { paced } from './providers/index.js';

export const STAGES = [
  'verify_payment',
  'request_intake',
  'validate_intake',
  'read_documents',
  'fetch_sources',
  'determine',
  'draft',
  'render',
  'deliver',
  'act',
  'monitor',
];

export const STAGE_LABELS = {
  verify_payment: 'Payment confirmed',
  request_intake: 'Form sent to you',
  validate_intake: 'Your answers checked',
  read_documents: 'Your documents read',
  fetch_sources: 'Public records fetched',
  determine: 'Rules applied',
  draft: 'Summary written',
  render: 'Documents built',
  deliver: 'Delivered',
  act: 'Filings sent',
  monitor: 'Monitoring',
};

const MAX_DRAFT_REJECTIONS = 3;
const MAX_PARSE_FAILURES = 3;
const PAID = ['paid', 'no_payment_required'];
const DAY_MS = 86400000;

/** Minutes to wait before the next attempt: 2, 4, 8, 16 ... capped at the ceiling. */
export function backoffMinutes(attempts, ceiling = 60) {
  return Math.min(ceiling, 2 ** Math.max(1, attempts));
}

/** A buyer-facing problem with a form submission. `message` is one sentence for the order page. */
export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'text/csv': 'csv', 'text/plain': 'txt' };
const extOf = (mime) => EXT[mime] || String(mime).split('/')[1] || 'bin';

function scalars(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  return out;
}

function customFields(session) {
  const out = {};
  for (const f of session?.custom_fields || []) out[f.key] = f.text?.value ?? f.numeric?.value ?? f.dropdown?.value ?? null;
  return out;
}

const idOf = (v) => (typeof v === 'string' ? v : v?.id ?? null);

function snapshot(session) {
  return {
    id: session.id,
    status: session.status,
    payment_status: session.payment_status,
    mode: session.mode ?? null,
    amount_total: session.amount_total ?? null,
    currency: session.currency ?? null,
    payment_intent: idOf(session.payment_intent),
    subscription: idOf(session.subscription),
    invoice: idOf(session.invoice),
    customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    metadata: session.metadata ?? {},
    fields: customFields(session),
  };
}

function defaultLog(e) {
  const note = e.note ? ` ${String(e.note).slice(0, 200)}` : '';
  console.log(`[complyrail] ${e.order} ${e.stage} -> ${e.result}${note}`);
}

/**
 * createEngine(options) -> engine
 *
 * options:
 *   pack       the pack (see definePack)
 *   provider   a model provider (see providers/)
 *   payments   stripePayments() or memoryPayments()
 *   store      supabaseOrderStore() or fileOrderStore()
 *   storage    supabaseStorage() or fileStorage()
 *   mailer     smtpMailer() or fileOutbox()
 *   siteUrl    the site that serves /order/<token>
 *   bucket     storage bucket for this pack's files (default: the pack id)
 *   modelIntervalMs     minimum gap between model calls (free tiers count requests per minute)
 *   retryCeilingMinutes the longest wait between retries (default 60)
 *   renderPdf, now, log, leaseMinutes, attachLimitBytes, uploadLimitBytes
 */
export function createEngine({
  pack: rawPack,
  provider,
  payments,
  store,
  storage,
  mailer,
  siteUrl = 'http://localhost:3000',
  bucket,
  modelIntervalMs = 0,
  retryCeilingMinutes,
  renderPdf = defaultRenderPdf,
  now = () => new Date(),
  log = defaultLog,
  leaseMinutes = 15,
  attachLimitBytes = 10 * 1024 * 1024,
  uploadLimitBytes = 20 * 1024 * 1024,
} = {}) {
  const pack = definePack(rawPack);
  for (const [name, v] of Object.entries({ provider, payments, store, storage, mailer })) {
    if (!v) throw new Error(`createEngine needs ${name}`);
  }
  const model = paced(provider, modelIntervalMs);
  const BUCKET = bucket || pack.id;
  const CEILING = retryCeilingMinutes ?? pack.retryCeilingMinutes ?? 60;
  const SITE = String(siteUrl).replace(/\/$/, '');
  const emit = typeof log === 'function' ? log : () => {};
  const iso = (d) => new Date(d).toISOString();
  const nowIso = () => now().toISOString();
  const docSpecs = new Map((pack.documents || []).map((d) => [d.slot, d]));

  // ── the services a pack may call ───────────────────────────────────────────────────────────
  const services = {
    readDocument: (file, schema, options = {}) => readDocumentService({ provider: model, file, schema, privacy: options.privacy ?? 'full', maxBytes: uploadLimitBytes }),
    draftGrounded: (system, facts, vocabulary = []) => draftService({ provider: model, system, facts, vocabulary }),
    renderPdf: (html) => renderPdf(html),
    upload: (bkt, path, bytes, contentType) => storage.put(bkt, path, bytes, contentType),
    send: async (template, fields = {}, attach = []) => {
      const to = fields.to || fields.email;
      if (!to) throw new Error('send() needs fields.to or fields.email');
      const m = renderMail(template, fields, null);
      return mailer.send({ from: pack.mail.from, to, subject: m.subject, text: m.text, html: m.html, attachments: attach });
    },
    stripe: { refund: (session) => payments.refund(session) },
  };

  // ── order helpers ──────────────────────────────────────────────────────────────────────────
  function newOrder(session, tier) {
    const t = nowIso();
    return {
      id: `ord_${crypto.randomBytes(10).toString('hex')}`,
      pack: pack.id,
      token: crypto.randomBytes(24).toString('hex'),
      session_id: session.id,
      status: 'queued',
      stage: 'verify_payment',
      email: session.customer_details?.email ?? session.customer_email ?? null,
      customer_name: session.customer_details?.name ?? null,
      tier,
      session: snapshot(session),
      form: null,
      form_submitted_at: null,
      uploads: [],
      intake: null,
      documents: {},
      read_failures: {},
      sources: null,
      determination: null,
      drafts: {},
      files: [],
      delivery: {},
      actions: {},
      monitor: {},
      emails: {},
      problems: [],
      wait_reason: null,
      last_error: null,
      refund_id: null,
      attempts: 0,
      next_attempt_at: t,
      lease_until: null,
      history: [],
      created_at: t,
      updated_at: t,
    };
  }

  function mailFields(order, extra = {}) {
    const first = String(order.intake?.first_name || order.form?.first_name || order.customer_name || '').split(/\s+/)[0] || 'there';
    return {
      ...scalars(order.session?.fields),
      ...scalars(order.intake),
      ...scalars(order.determination),
      order_url: `${SITE}/order/${order.token}`,
      first_name: first,
      customer_name: order.customer_name || '',
      email: order.email || '',
      order_id: order.id,
      product: pack.product?.name || pack.id,
      tier: order.tier?.name || order.tier?.id || '',
      today: now().toISOString().slice(0, 10),
      ...extra,
    };
  }

  async function sendToBuyer(order, template, fields, attach = [], name = 'mail') {
    if (!order.email) {
      emit({ order: order.id, stage: order.stage, result: 'mail_skipped', note: `${name}: the order has no email address` });
      return false;
    }
    const m = renderMail(template, fields, order, name);
    await mailer.send({ from: pack.mail.from, to: order.email, subject: m.subject, text: m.text, html: m.html, attachments: attach });
    return true;
  }

  function reminderTemplate() {
    if (pack.mail.reminder) return pack.mail.reminder;
    return (fields, order) => {
      const m = renderMail(pack.mail.intake, fields, order, 'intake template');
      return { subject: `Reminder: ${m.subject}`, text: m.text };
    };
  }

  const NEEDS_INPUT_MAIL = {
    subject: 'Your order needs an answer from you',
    text: 'Hi {{first_name}},\n\nYour order cannot continue until you fix the answers below.\n\n{{problem_list}}\n\nOpen your order page to fix them and send the form again:\n\n{{order_url}}\n\nYour order continues as soon as every answer is fixed.\n',
  };
  const REFUSED_MAIL = {
    subject: 'Your order was refunded',
    text: 'Hi {{first_name}},\n\nWe could not make your order. {{refusal_reason}}\n\n{{refund_line}}\n\nYour order page has the details:\n\n{{order_url}}\n',
  };
  const CHANGE_MAIL = { subject: '{{report_subject}}', text: '{{report_text}}\n\nYour order page:\n\n{{order_url}}\n' };

  async function save(order, patch) {
    const next = await store.update(order.id, { ...patch, updated_at: nowIso() });
    Object.assign(order, next);
    return order;
  }

  function uploadedBy(order) {
    return (order.uploads || []).slice().sort((a, b) => (a.slot === b.slot ? a.item - b.item : a.slot.localeCompare(b.slot)));
  }

  function groupedDocuments(order) {
    const out = {};
    for (const u of uploadedBy(order)) {
      const entry = order.documents?.[u.sha256];
      if (!entry?.read) continue;
      (out[u.slot] ||= []).push({ item: u.item, name: u.name, ...entry.read });
    }
    return out;
  }

  function context(order) {
    const draftTexts = {};
    for (const [slot, d] of Object.entries(order.drafts || {})) if (d?.final) draftTexts[slot] = d.text ?? null;
    const t = now();
    return {
      order: publicOrder(order),
      tier: order.tier,
      session: order.session,
      form: order.form,
      intake: order.intake,
      documents: groupedDocuments(order),
      sources: order.sources || {},
      determination: order.determination,
      drafts: draftTexts,
      now: t,
      today: t.toISOString().slice(0, 10),
      services,
    };
  }

  function monitorApplies(order) {
    if (!pack.monitor) return false;
    return order.tier?.mode === 'subscription' || Number(order.tier?.monitorDays) > 0;
  }

  function applies(stage, order) {
    switch (stage) {
      case 'read_documents':
        return (pack.documents || []).length > 0;
      case 'fetch_sources':
        return (pack.sources || []).length > 0;
      case 'draft':
        return (pack.narratives || []).length > 0;
      case 'act':
        return (pack.actions || []).length > 0;
      case 'monitor':
        return monitorApplies(order);
      default:
        return true;
    }
  }

  function nextStage(order, stage) {
    for (let i = STAGES.indexOf(stage) + 1; i < STAGES.length; i++) if (applies(STAGES[i], order)) return STAGES[i];
    return 'complete';
  }

  // ── the stages ─────────────────────────────────────────────────────────────────────────────
  const STAGE = {
    async verify_payment(order) {
      const fresh = (await payments.getSession(order.session_id)) ?? null;
      const s = fresh ? snapshot(fresh) : order.session;
      if (s.status !== 'complete' || !PAID.includes(s.payment_status)) return retry('the payment is not confirmed yet');
      const tier = fresh ? pack.matches(fresh) : order.tier;
      if (!tier) return retry(`session ${order.session_id} does not match pack ${pack.id}`);
      return done({ session: s, tier, email: order.email || s.customer_email });
    },

    async request_intake(order) {
      const emails = { ...(order.emails || {}) };
      if (!emails.intake_at) {
        await sendToBuyer(order, pack.mail.intake, mailFields(order), [], 'intake template');
        emails.intake_at = nowIso();
        await save(order, { emails });
      }
      if (order.form_submitted_at) return done({ emails });
      const remindAt = Date.parse(emails.intake_at) + pack.mail.reminderDays * DAY_MS;
      if (!emails.reminder_at && now().getTime() >= remindAt) {
        await sendToBuyer(order, reminderTemplate(), mailFields(order), [], 'reminder template');
        emails.reminder_at = nowIso();
        await save(order, { emails });
      }
      return needsInput('Fill in the form on your order page.', { recheckAt: emails.reminder_at ? null : iso(remindAt), patch: { emails } });
    },

    async validate_intake(order) {
      const res = await pack.intake.validate(order.form ?? {}, { uploads: order.uploads || [], order: publicOrder(order) });
      if (!res || res.ok !== true) {
        const problems = (res?.errors?.length ? res.errors : [{ message: 'Some answers are missing. Open the form and send it again.' }]).map(toProblem);
        const sentence = problems.length === 1 ? problems[0].message : `Fix ${problems.length} answers on your order page.`;
        return needsInput(sentence, { problems });
      }
      return done({ intake: res.value });
    },

    async read_documents(order) {
      const documents = { ...(order.documents || {}) };
      const failures = { ...(order.read_failures || {}) };
      const problems = [];
      for (const u of uploadedBy(order)) {
        const spec = docSpecs.get(u.slot);
        if (!spec) continue;
        if (!spec.mime.includes(u.mimeType)) {
          problems.push({ slot: u.slot, item: u.item, kind: 'file_type', message: `Upload ${u.name} as a ${spec.mime.map(extOf).join(', ')} file.` });
          continue;
        }
        let entry = documents[u.sha256];
        if (!entry?.read) {
          const bytes = await storage.get(BUCKET, u.path);
          const r = await services.readDocument({ name: u.name, mimeType: u.mimeType, bytes }, spec.schema, { privacy: spec.privacy });
          if (!r.ok) {
            if (r.code === 'parse_failed') {
              failures[u.sha256] = (failures[u.sha256] || 0) + 1;
              if (failures[u.sha256] >= MAX_PARSE_FAILURES) {
                problems.push({ slot: u.slot, item: u.item, kind: 'unreadable', message: `We could not read ${u.name}. Upload a sharper scan or the original file.` });
                continue;
              }
            }
            if (r.code === 'bad_input' || r.code === 'privacy') {
              problems.push({ slot: u.slot, item: u.item, kind: 'unreadable', message: `We could not read ${u.name}: ${r.error}.` });
              continue;
            }
            return retry(`document read: ${r.error}`, { documents, read_failures: failures }, {
              waitReason: 'Your answers are saved. The step that reads your documents is waiting for a free slot and tries again on its own. You do not need to do anything.',
            });
          }
          entry = { slot: u.slot, sha256: u.sha256, read: { value: r.value, confidence: r.confidence, model: r.model, at: nowIso() } };
          documents[u.sha256] = entry;
        }
        const read = { ...entry.read, slot: u.slot, item: u.item, name: u.name };
        if (read.confidence < spec.minConfidence) {
          problems.push({ slot: u.slot, item: u.item, kind: 'low_confidence', message: `We could not read ${u.name} clearly. Upload a sharper scan or the original file.` });
          continue;
        }
        const found = (await spec.validate(read, order.intake)) || [];
        for (const p of Array.isArray(found) ? found : [found]) problems.push({ slot: u.slot, item: u.item, ...toProblem(p) });
      }
      const patch = { documents, read_failures: failures };
      if (problems.length) {
        const sentence = problems.length === 1 ? problems[0].message : `Fix ${problems.length} answers on your order page.`;
        return needsInput(sentence, { problems, patch });
      }
      return done(patch);
    },

    async fetch_sources(order) {
      const out = { ...(order.sources || {}) };
      for (const s of pack.sources || []) {
        if (out[s.name] !== undefined) continue;
        try {
          out[s.name] = (await s.fetch(publicOrder(order), services)) ?? null;
        } catch (err) {
          return retry(`source ${s.name}: ${err.message}`, { sources: out }, {
            waitReason: 'A public record this order needs is not answering. The order tries again on its own. You do not need to do anything.',
          });
        }
      }
      return done({ sources: out });
    },

    async determine(order) {
      const out = await pack.determine(context(order));
      if (out?.kind === 'determination') return done({ determination: out.value ?? {} });
      if (out?.kind === 'needs_input') return out;
      if (out?.kind === 'refusal') {
        let refundId = order.refund_id;
        if (out.refund && !refundId) {
          try {
            refundId = (await services.stripe.refund(order.session)).id;
          } catch (err) {
            return retry(`refund: ${err.message}`, { refusal: out.reason }, { waitReason: 'This order cannot be made, and its refund is being sent. You do not need to do anything.' });
          }
          await save(order, { refund_id: refundId, refusal: out.reason });
        }
        const emails = { ...(order.emails || {}) };
        if (!emails.refused_at) {
          const refundLine = refundId ? 'Your payment has been refunded in full.' : 'No refund was due on this order.';
          await sendToBuyer(order, pack.mail.refused || REFUSED_MAIL, mailFields(order, { refusal_reason: out.reason, refund_line: refundLine }), [], 'refusal mail');
          emails.refused_at = nowIso();
        }
        return done({ refund_id: refundId, refusal: out.reason, emails, wait_reason: out.reason }, { halt: 'refused' });
      }
      throw new Error('determine() must return determination(), refusal() or needsInput()');
    },

    async draft(order) {
      const drafts = { ...(order.drafts || {}) };
      const ctx = context(order);
      for (const n of pack.narratives || []) {
        const d = { rejections: 0, rejected: [], ...(drafts[n.slot] || {}) };
        if (d.final) {
          ctx.drafts[n.slot] = d.text ?? null;
          continue;
        }
        while (d.rejections < MAX_DRAFT_REJECTIONS) {
          const facts = await n.facts(ctx);
          const r = await services.draftGrounded(n.system, facts, n.vocabulary);
          if (r.ok) {
            Object.assign(d, { final: true, text: r.text, source: 'model', model: r.model });
            break;
          }
          if (r.reason === 'call_failed') {
            drafts[n.slot] = d;
            return retry(`draft ${n.slot}: ${r.error}`, { drafts }, {
              waitReason: 'Your answers matched. The step that writes your summary is waiting for a free slot and tries again on its own. You do not need to do anything.',
            });
          }
          d.rejections += 1;
          d.rejected = [...d.rejected, { kind: r.kind, token: r.token }];
          emit({ order: order.id, stage: 'draft', result: 'rejected', note: `${n.slot}: ungrounded ${r.kind} "${r.token}"` });
        }
        if (!d.final) {
          const f = n.fallback;
          if (f === 'omit') Object.assign(d, { final: true, text: null, source: 'omitted' });
          else if (typeof f.print === 'function') Object.assign(d, { final: true, text: String((await f.print(ctx)) ?? ''), source: 'buyer_words' });
          else {
            drafts[n.slot] = { ...d, rejections: 0, asked: true };
            return needsInput(f.ask, { patch: { drafts } });
          }
        }
        drafts[n.slot] = d;
        ctx.drafts[n.slot] = d.text ?? null;
      }
      return done({ drafts });
    },

    async render(order) {
      const ctx = context(order);
      const docs = assertDocs(pack.id, await pack.render(ctx));
      const files = [];
      const built = [];
      for (const doc of docs) {
        const content = doc.fields ? fillTemplate(doc.template, doc.fields, doc.name) : doc.template;
        let bytes;
        let ext;
        let type;
        if (doc.format === 'csv') {
          bytes = Buffer.from(content, 'utf8');
          ext = 'csv';
          type = 'text/csv';
        } else {
          const html = htmlDocument({ title: doc.title || doc.name, body: content, css: doc.css ?? pack.css ?? '' });
          if (doc.format === 'html') {
            bytes = Buffer.from(html, 'utf8');
            ext = 'html';
            type = 'text/html';
          } else {
            bytes = await services.renderPdf(html);
            ext = 'pdf';
            type = 'application/pdf';
          }
        }
        const name = `${doc.name}.${ext}`;
        const path = `${order.id}/files/${name}`;
        await storage.put(BUCKET, path, bytes, type);
        files.push({ name, path, format: doc.format, contentType: type, bytes: bytes.length });
        built.push({ name, format: doc.format, contentType: type, bytes });
      }
      const problems = pack.checks ? (await pack.checks(built)) || [] : [];
      if (problems.length) {
        return retry(`output check failed: ${problems.map((p) => toProblem(p).message).join('; ')}`, {}, {
          waitReason: 'Your documents are built and failed a final check on our side. They are rebuilt on their own. You do not need to do anything.',
        });
      }
      return done({ files });
    },

    async deliver(order) {
      const delivery = { ...(order.delivery || {}) };
      if (!delivery.zip_path) {
        const entries = [];
        for (const f of order.files || []) entries.push({ name: f.name, bytes: await storage.get(BUCKET, f.path) });
        const zip = makeZip(entries, { date: now() });
        const zipName = `${pack.id}-${now().toISOString().slice(0, 10)}.zip`;
        const path = `${order.id}/${zipName}`;
        await storage.put(BUCKET, path, zip, 'application/zip');
        Object.assign(delivery, { zip_path: path, zip_name: zipName, zip_bytes: zip.length });
        await save(order, { delivery });
      }
      if (!delivery.emailed_at) {
        const fields = mailFields(order, {
          file_count: String((order.files || []).length),
          file_list: (order.files || []).map((f) => `- ${f.name}`).join('\n'),
        });
        const attach = delivery.zip_bytes <= attachLimitBytes ? [{ filename: delivery.zip_name, content: await storage.get(BUCKET, delivery.zip_path), contentType: 'application/zip' }] : [];
        await sendToBuyer(order, pack.mail.delivery, fields, attach, 'delivery template');
        delivery.emailed_at = nowIso();
      }
      return done({ delivery, delivered_at: order.delivered_at || nowIso() });
    },

    async act(order) {
      const actions = { ...(order.actions || {}) };
      for (const a of pack.actions || []) {
        if (actions[a.state] === 'done') continue;
        const r = await a.run(publicOrder(order), services);
        if (!isResult(r)) throw new Error(`action ${a.state} must return done(), retry() or needsInput()`);
        if (r.kind === 'done') {
          actions[a.state] = 'done';
          await save(order, { actions, ...r.patch });
          continue;
        }
        if (r.kind === 'retry') return retry(`action ${a.state}: ${r.reason}`, { actions, ...r.patch }, { waitReason: r.waitReason });
        return needsInput(r.sentence, { problems: r.problems, patch: { actions, ...r.patch } });
      }
      return done({ actions });
    },

    async monitor(order) {
      const m = { ...(order.monitor || {}) };
      const every = pack.monitor.everyDays * DAY_MS;
      const t = now().getTime();
      if (!m.started_at) {
        Object.assign(m, { started_at: nowIso(), runs: 0 });
        return done({ monitor: m }, { rescheduleAt: new Date(t + every) });
      }
      let active;
      if (order.tier?.mode === 'subscription') active = await payments.subscriptionActive(order);
      else active = t < Date.parse(order.created_at) + Number(order.tier?.monitorDays || 0) * DAY_MS;
      if (!active) {
        m.ended_at = nowIso();
        return done({ monitor: m }, { halt: 'delivered' });
      }
      const report = await pack.monitor.run(publicOrder(order), services);
      m.runs = (m.runs || 0) + 1;
      m.last_run_at = nowIso();
      if (report) {
        const rendered = renderMail(report, mailFields(order), order, 'change report');
        await sendToBuyer(order, CHANGE_MAIL, mailFields(order, { report_subject: rendered.subject, report_text: rendered.text.trim() }), report.attach || [], 'change report');
        m.last_report_at = nowIso();
      }
      return done({ monitor: m }, { rescheduleAt: new Date(t + every) });
    },
  };

  // ── the runner ─────────────────────────────────────────────────────────────────────────────
  function waitSentence(at) {
    return `Your order is saved. A step on our side is waiting and tries again at ${iso(at).slice(11, 16)} UTC. You do not need to do anything.`;
  }

  function noticeKey(result) {
    return crypto.createHash('sha256').update(JSON.stringify([result.sentence, result.problems])).digest('hex').slice(0, 16);
  }

  async function apply(order, stage, result) {
    const t = nowIso();
    const note = result.reason || result.sentence || (result.halt ? result.halt : undefined);
    const history = [...(order.history || []), { at: t, stage, result: result.kind, ...(note ? { note: String(note).slice(0, 300) } : {}) }].slice(-200);
    let patch;
    if (result.kind === 'done') {
      if (result.halt) {
        patch = { status: result.halt, stage: 'complete', next_attempt_at: null, problems: [], last_error: null, attempts: 0, wait_reason: null, ...result.patch };
      } else if (result.rescheduleAt) {
        patch = { status: 'monitoring', stage, next_attempt_at: iso(result.rescheduleAt), attempts: 0, wait_reason: null, last_error: null, problems: [], ...result.patch };
      } else {
        const next = nextStage(order, stage);
        patch = { stage: next, status: next === 'complete' ? 'delivered' : 'queued', next_attempt_at: next === 'complete' ? null : t, attempts: 0, wait_reason: null, problems: [], last_error: null, ...result.patch };
      }
    } else if (result.kind === 'retry') {
      const attempts = (order.attempts || 0) + 1;
      const at = now().getTime() + backoffMinutes(attempts, CEILING) * 60000;
      patch = { ...result.patch, status: 'retrying', attempts, next_attempt_at: iso(at), last_error: result.reason.slice(0, 500), wait_reason: result.waitReason || waitSentence(at) };
    } else {
      const status = stage === 'request_intake' ? 'awaiting_intake' : 'needs_input';
      patch = { ...result.patch, status, wait_reason: result.sentence, problems: result.problems, next_attempt_at: result.recheckAt ? iso(result.recheckAt) : null, attempts: 0, last_error: null };
      if (status === 'needs_input') {
        const key = noticeKey(result);
        const emails = { ...(order.emails || {}), ...(result.patch?.emails || {}) };
        if (emails.needs_input_key !== key) {
          try {
            const list = result.problems.length ? result.problems.map((p) => `- ${p.message}`).join('\n') : `- ${result.sentence}`;
            await sendToBuyer(order, pack.mail.needsInput || NEEDS_INPUT_MAIL, mailFields(order, { problem_list: list, problem_count: String(result.problems.length || 1) }), [], 'needs-input mail');
            emails.needs_input_key = key;
            emails.needs_input_at = t;
          } catch (err) {
            // The buyer must hear about it. The stage runs again shortly and the notice is retried.
            patch.next_attempt_at = iso(now().getTime() + 2 * 60000);
            patch.last_error = `needs-input mail failed: ${err.message}`.slice(0, 500);
          }
        }
        patch.emails = emails;
      }
    }
    const updated = await store.update(order.id, { ...patch, history, updated_at: t });
    emit({ order: order.id, stage, result: result.kind === 'done' && result.halt ? result.halt : result.kind, note });
    return updated;
  }

  /** Advance one order until it waits: on a retry, on the buyer, on a monitor date or at the end. */
  async function runOrder(id) {
    const t = now();
    let order = await store.claim(id, iso(t.getTime() + leaseMinutes * 60000), t.toISOString());
    if (!order) return null;
    try {
      for (let steps = 0; steps < STAGES.length * 2; steps++) {
        if (order.stage === 'complete') break;
        const stage = order.stage;
        let result;
        try {
          result = await STAGE[stage](order);
        } catch (err) {
          result = err instanceof Retry ? retry(err.message) : retry(`${stage} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!isResult(result)) result = retry(`${stage} returned no result`);
        order = await apply(order, stage, result);
        if (result.kind !== 'done' || result.halt || result.rescheduleAt) break;
      }
    } finally {
      order = await store.update(order.id, { lease_until: null });
    }
    return order;
  }

  /** Turn a Checkout session into an order, once. Returns null for a session that is not a paid order for this pack. */
  async function acceptSession(session) {
    if (!session || session.status !== 'complete' || !PAID.includes(session.payment_status)) return null;
    const tier = pack.matches(session);
    if (!tier) return null;
    const existing = await store.bySession(session.id);
    if (existing) return existing;
    return store.insert(newOrder(session, tier));
  }

  /** What the order page shows. No storage path or provider detail leaves the engine. */
  function publicOrder(order) {
    if (!order) return null;
    const stages = STAGES.filter((s) => applies(s, order));
    const at = order.stage === 'complete' ? stages.length : stages.indexOf(order.stage);
    return {
      id: order.id,
      token: order.token,
      pack: order.pack,
      tier: order.tier ? { id: order.tier.id, name: order.tier.name ?? order.tier.id, mode: order.tier.mode ?? 'payment' } : null,
      email: order.email,
      customer_name: order.customer_name,
      status: order.status,
      stage: order.stage,
      stages: stages.map((s, i) => ({ id: s, label: STAGE_LABELS[s], state: i < at ? 'done' : i === at ? (order.status === 'needs_input' || order.status === 'awaiting_intake' ? 'waiting' : 'current') : 'todo' })),
      form: order.form,
      intake: order.intake,
      uploads: (order.uploads || []).map((u) => ({ slot: u.slot, item: u.item, name: u.name, id: u.sha256 })),
      problems: order.problems || [],
      wait_reason: order.wait_reason,
      next_attempt_at: order.next_attempt_at,
      determination: order.determination,
      summary: order.determination?.summary ?? null,
      refusal: order.refusal ?? null,
      files: (order.files || []).map((f) => ({ name: f.name, format: f.format, bytes: f.bytes })),
      has_download: Boolean(order.delivery?.zip_path),
      delivered_at: order.delivered_at ?? null,
      created_at: order.created_at,
      session_fields: order.session?.fields ?? {},
    };
  }

  const LATER_STAGES = new Set(STAGES.slice(STAGES.indexOf('read_documents')));

  /**
   * The buyer's form. `form` holds the answers. A file field may hold { upload: <id> } to keep a
   * file sent earlier. `files` holds new uploads: [{ slot, item, name, mimeType, bytes }].
   * Throws InputError with one sentence for the buyer.
   */
  async function submitIntake(token, form, files = []) {
    const order = await store.byToken(token);
    if (!order) throw new InputError('No order at this link.', 404);
    if (order.status === 'refused') throw new InputError('This order was refunded and is closed.', 409);
    const t = now();
    if (order.lease_until && order.lease_until > t.toISOString()) throw new InputError('Your order is being worked on right now. Wait a minute and send the form again.', 409);
    if (['queued', 'retrying'].includes(order.status) && LATER_STAGES.has(order.stage)) {
      throw new InputError('Your order is being prepared from the answers you already sent. Wait for it to finish, then you can correct them.', 409);
    }
    if (!form || typeof form !== 'object') throw new InputError('The form did not arrive. Send it again.');

    const fresh = [];
    for (const f of files) {
      const spec = docSpecs.get(f.slot);
      if (!spec) throw new InputError(`This order does not take a "${f.slot}" upload.`);
      if (!spec.mime.includes(f.mimeType)) throw new InputError(`Upload ${f.name} as a ${spec.mime.map(extOf).join(', ')} file.`);
      const bytes = Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes ?? '');
      if (!bytes.length) throw new InputError(`${f.name} is empty. Upload it again.`);
      if (bytes.length > uploadLimitBytes) throw new InputError(`${f.name} is over ${Math.round(uploadLimitBytes / 1048576)} MB. Upload a smaller file.`);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const path = `${order.id}/uploads/${f.slot}-${Number(f.item) || 0}-${sha256.slice(0, 16)}.${extOf(f.mimeType)}`;
      await storage.put(BUCKET, path, bytes, f.mimeType);
      fresh.push({ slot: f.slot, item: Number(f.item) || 0, name: String(f.name || 'document').slice(0, 160), mimeType: f.mimeType, path, sha256, bytes: bytes.length, at: t.toISOString() });
    }

    // Earlier files the form keeps, re-keyed to the row that now holds them.
    const previous = new Map((order.uploads || []).map((u) => [u.sha256, u]));
    const kept = [];
    const walk = (fields, values, item) => {
      for (const fd of fields || []) {
        const v = values?.[fd.name];
        if (fd.type === 'list' && Array.isArray(v)) v.forEach((row, i) => walk(fd.of, row, i));
        else if (fd.type === 'file' && v && typeof v === 'object' && v.upload && previous.has(v.upload)) {
          const at = item ?? 0;
          if (!fresh.some((u) => u.slot === fd.slot && u.item === at)) kept.push({ ...previous.get(v.upload), slot: fd.slot, item: at });
        }
      }
    };
    walk(pack.intake.fields, form, null);
    const uploads = [...fresh, ...kept];

    const back = STAGES.indexOf(order.stage) !== -1 && STAGES.indexOf(order.stage) <= STAGES.indexOf('request_intake') ? order.stage : 'validate_intake';
    const updated = await store.update(order.id, {
      form,
      uploads,
      form_submitted_at: t.toISOString(),
      stage: back,
      status: 'queued',
      next_attempt_at: t.toISOString(),
      attempts: 0,
      problems: [],
      wait_reason: null,
      last_error: null,
      read_failures: {},
      sources: null,
      determination: null,
      drafts: {},
      files: [],
      delivery: {},
      updated_at: t.toISOString(),
    });
    return publicOrder(updated);
  }

  return {
    pack,
    services,
    stages: STAGES,

    /** The stages an order on this tier passes through, with their labels for an order page. */
    stagesFor(tier) {
      return STAGES.filter((s) => applies(s, { tier: tier ?? null })).map((id) => ({ id, label: STAGE_LABELS[id] }));
    },

    /** verify_payment for every new paid session the payments adapter lists. */
    async syncPayments(options = {}) {
      const sessions = await payments.listPaidSessions(options);
      const created = [];
      for (const s of sessions) {
        const before = await store.bySession(s.id);
        if (before) continue;
        const o = await acceptSession(s);
        if (o) created.push(o);
      }
      return created;
    },

    /** The site's success redirect: find or create the order for one Checkout session. */
    async openOrder(sessionId) {
      const existing = await store.bySession(sessionId);
      if (existing) return publicOrder(existing);
      const s = await payments.getSession(sessionId);
      return publicOrder(await acceptSession(s));
    },

    acceptSession: async (session) => publicOrder(await acceptSession(session)),
    submitIntake,
    runOrder,

    /** Advance every due order. Returns the orders it touched. */
    async tick({ limit = 50 } = {}) {
      const due = await store.due(nowIso(), limit);
      const touched = [];
      for (const o of due) {
        const r = await runOrder(o.id);
        if (r) touched.push(publicOrder(r));
      }
      return touched;
    },

    async view(token) {
      return publicOrder(await store.byToken(token));
    },

    /** A short-lived link to the delivered archive, or null before delivery. */
    async download(token, expiresIn = 600) {
      const o = await store.byToken(token);
      if (!o?.delivery?.zip_path) return null;
      return storage.signedUrl(BUCKET, o.delivery.zip_path, expiresIn);
    },

    publicOrder,
  };
}
