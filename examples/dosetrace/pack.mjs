// DoseTrace as a ComplyRail pack.
//
// DoseTrace makes a DSCSA readiness binder for one pharmacy: nine documents an inspector asks for,
// written from the pharmacy's own answers. The buyer uploads one licence or authorized trading
// partner letter per wholesaler. The model reads each document into typed fields. Plain code
// compares them with what the buyer typed, applies the 25-employee rule, and fills the templates.
// The model also drafts one readiness paragraph from a closed list of facts. A draft that names a
// fact the list does not hold is rejected, and after three rejections the binder ships without it.
//
// This file is the whole product logic. The engine does payment, intake, retries, rendering,
// delivery and mail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePack, validateFields, determination, refusal, needsInput } from 'complyrail';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const template = (name) => fs.readFileSync(path.join(HERE, 'templates', name), 'utf8');

// FDA extended the small dispenser exemption to this date on 6 August 2026.
export const SUNSET = '2027-11-27';
export const SUNSET_LONG = 'November 27, 2027';
export const FTE_THRESHOLD = 25;
// The day FDA takes the headcount for the exemption year that runs to SUNSET.
export const FTE_AS_OF = 'November 27, 2026';
export const PRICE_CENTS = 1900;

const STATE_CODES = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co',
  connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd',
  tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa',
  'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy', 'district of columbia': 'dc',
};

export function stateCode(s) {
  const n = String(s || '').toLowerCase().replace(/[.]/g, '').trim();
  if (!n) return '';
  if (n.length === 2) return n;
  return STATE_CODES[n] || n;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[.,]/g, '').replace(/\b(inc|llc|corp|co|ltd|lp|llp)\b/g, '').trim().replace(/\s+/g, ' ');
const normId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function fuzzyMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/* Every disagreement between a licence document and the wholesaler row the buyer typed. Two kinds
 * may be kept by the buyer: a licence from another state, and a document that does not itself state
 * authorized trading partner status. A kept finding prints the row as not yet verified. */
export function compare(doc, w, pharmacyState, today) {
  const out = [];
  const name = w.name || 'this wholesaler';
  if (doc.wholesalerName && !fuzzyMatch(doc.wholesalerName, w.name)) {
    out.push({ kind: 'name_mismatch', field: 'name', can_acknowledge: false,
      message: `The document you uploaded for ${name} names ${doc.wholesalerName.replace(/\.$/, '')}. Upload ${name}'s own licence, or correct the wholesaler's name.` });
  }
  if (doc.licenseNumber) {
    if (!w.license) {
      out.push({ kind: 'license_blank', field: 'license', document: doc.licenseNumber, can_acknowledge: false,
        message: `The document for ${name} shows licence number ${doc.licenseNumber}. Enter it in the licence field and send the form.` });
    } else if (normId(doc.licenseNumber) !== normId(w.license)) {
      out.push({ kind: 'license_mismatch', field: 'license', document: doc.licenseNumber, can_acknowledge: false,
        message: `You typed licence number ${w.license} for ${name}. The document shows ${doc.licenseNumber}. Correct the number, or upload the right document.` });
    }
  }
  if (doc.state && pharmacyState && stateCode(doc.state) !== stateCode(pharmacyState)) {
    out.push({ kind: 'other_state', field: 'state', can_acknowledge: true,
      message: `The licence for ${name} was issued by ${doc.state}. Your pharmacy is in ${pharmacyState}. Upload the licence ${name} holds for ${pharmacyState}, if it has one.` });
  }
  if (doc.isATP === false) {
    out.push({ kind: 'not_atp', field: 'isATP', can_acknowledge: true,
      message: `The document for ${name} does not state that it is a licensed wholesale distributor or authorized trading partner. Upload its state wholesale licence or its authorized trading partner letter.` });
  }
  if (doc.expirationDate && doc.expirationDate < today) {
    out.push({ kind: 'expired', field: 'expirationDate', can_acknowledge: false,
      message: `The licence for ${name} expired on ${doc.expirationDate}. Upload its current licence.` });
  }
  return out;
}

const acknowledgedKinds = (w) => [w.keep_other_state ? 'other_state' : null, w.keep_not_atp ? 'not_atp' : null].filter(Boolean);

/* The trading partner log row for one wholesaler, built only from what matched. */
function verifiedRow(w, read, pharmacyState, today) {
  const d = read.value;
  const found = compare(d, w, pharmacyState, today);
  const matched = [];
  if (d.wholesalerName) matched.push('holder name');
  if (d.licenseNumber && w.license) matched.push('licence number');
  const notAtp = found.some((p) => p.kind === 'not_atp');
  const otherState = found.some((p) => p.kind === 'other_state');
  const docRef = String(read.name || 'licence document').replace(/[|_*`[\]]/g, ' ').trim();
  const readOn = String(read.at || today).slice(0, 10);
  let verifiedVia;
  if (notAtp) {
    verifiedVia = `_Not verified. The document on file (${docRef}) does not state authorized trading partner status. Confirm by state licence lookup or FDA registration._`;
  } else {
    const what = matched.join(' and ');
    verifiedVia = `Licence document on file (${docRef}), read ${readOn}. ${what.charAt(0).toUpperCase()}${what.slice(1)} match the pharmacy's intake.`
      + (d.state ? ` Issued by ${d.state}${otherState ? ", not the pharmacy's state" : ''}.` : '')
      + (d.expirationDate ? ` Expires ${d.expirationDate}.` : '');
  }
  return {
    name: w.name,
    type: 'Wholesale distributor',
    license: w.license || '',
    verified_via: verifiedVia,
    verified_on: notAtp ? '' : readOn,
    data_location: w.data_location || '',
    retention: w.retention || '',
  };
}

function wholesalerTable(rows) {
  const head = '| Trading partner | Type | License / DEA on file | ATP verified how | Verified on | EPCIS / T3 data location | Retention |\n|---|---|---|---|---|---|---|';
  const body = rows.map((w) => '| ' + [
    w.name || '(name missing)',
    w.type || 'Wholesale distributor',
    w.license || '_to confirm_',
    w.verified_via || '_to confirm by state licence lookup or FDA registration_',
    w.verified_on || '_to complete_',
    w.data_location || '_ask the wholesaler in writing_',
    w.retention || '_ask the wholesaler in writing_',
  ].join(' | ') + ' |');
  return [head, ...body].join('\n');
}

const longDate = (isoDay) => new Date(`${isoDay}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const WHOLESALER_FIELDS = [
  { name: 'name', label: "the wholesaler's name", required: true, max: 200 },
  { name: 'license', label: "the wholesaler's licence number", max: 80 },
  { name: 'data_location', label: 'where its EPCIS data lives', max: 200 },
  { name: 'retention', label: 'how long it keeps the data', max: 80 },
  { name: 'doc', label: "this wholesaler's state licence or authorized trading partner letter", type: 'file', slot: 'licence', required: true },
  { name: 'keep_other_state', label: 'I will verify an out-of-state licence another way', type: 'checkbox' },
  { name: 'keep_not_atp', label: 'I will confirm trading partner status another way', type: 'checkbox' },
];

export const FIELDS = [
  { name: 'pharmacy_name', label: "the pharmacy's legal name", required: true, max: 200 },
  { name: 'dba', label: 'the name the pharmacy trades under', max: 200 },
  { name: 'address', label: 'the street address', required: true, max: 300 },
  { name: 'city', label: 'the city', required: true, max: 120 },
  { name: 'state', label: 'the state', required: true, max: 40 },
  { name: 'state_license', label: 'the state pharmacy licence number', required: true, max: 80 },
  { name: 'owner_name', label: "the pharmacist-in-charge's name", required: true, max: 120 },
  { name: 'owner_title', label: "the pharmacist-in-charge's title", max: 80 },
  { name: 'fte', label: 'the number of full-time licensed pharmacists and technicians', type: 'integer', required: true, minValue: 0, maxValue: 9999,
    message: 'Enter the number of full-time licensed pharmacists and technicians as a whole number.' },
  { name: 'locations', label: 'how many locations the business owns', type: 'integer', required: true, minValue: 1, maxValue: 999,
    message: 'Enter how many locations the business owns, 1 or more.' },
  { name: 'wholesalers', label: 'Wholesalers', type: 'list', min: 1, max: 20, of: WHOLESALER_FIELDS,
    minMessage: 'Add at least one wholesaler. The trading partner log needs every supplier you buy prescription drugs from.' },
  { name: 'staff', label: 'Licensed staff', type: 'list', min: 1, max: 60, of: [
    { name: 'name', label: "the staff member's name", required: true, max: 120 },
    { name: 'role', label: 'their role', max: 80 },
  ], minMessage: 'Add every licensed pharmacist and technician who signs the training attestation.' },
];

const BRIEF_SYSTEM = `You draft one short paragraph for the index page of a DSCSA compliance binder \
prepared for a single pharmacy. Audience: the pharmacy owner or pharmacist-in-charge, not a \
lawyer. Plain, direct, second person ("you"). 70-130 words, one paragraph, no headings, no \
bullet points, no markdown.

RULES, and each is a hard constraint:
- Use ONLY the facts given to you below. Do not state a number, name, date, license number, or \
entity that is not in that list, even to round it, generalize it, or give an example.
- Do not restate DSCSA statute citations, hour windows, or retention-year rules. Those already \
have their own documents in this binder. Summarize what THIS pharmacy's own answers show.
- If a wholesaler or field is marked incomplete below, say so plainly as something still to do. \
Do not guess what it might be.
- Do not use sales language. This is a compliance document.`;

export const BRIEF_VOCABULARY = ['FDA', 'DSCSA', 'EPCIS', 'ATP', 'SOP', 'DoseTrace', 'Drug Supply Chain Security Act'];

/** The closed fact list for the readiness brief. Nothing else reaches the model. */
export function briefFacts(ctx) {
  const f = ctx.determination.fields;
  const rows = ctx.determination.rows;
  const incomplete = rows.filter((w) => !w.verified_on || !w.data_location || !w.retention || !w.license);
  return {
    Pharmacy: `${f.pharmacy_name}${ctx.intake.dba ? ` (d/b/a ${ctx.intake.dba})` : ''}`,
    'State license': `${f.state_license} (${f.state || 'state not given'})`,
    'Licensed FTE across the corporate entity': `${f.fte} (FDA's small-dispenser line is 25)`,
    'Locations owned by the same corporate entity': f.locations,
    Determination: f.determination,
    'Exemption sunset': `${f.sunset_long} (${f.days_left} from the binder's prepared date, ${f.date_long})`,
    'Wholesalers on file': `${rows.length}: ${rows.map((w) => w.name).join('; ') || 'none'}`,
    'Wholesalers with an incomplete verification row (missing license, verification, EPCIS data location, or retention answer)': incomplete.length ? incomplete.map((w) => w.name).join('; ') : 'none, every row is complete',
    'Licensed staff named for the training attestation': (ctx.intake.staff || []).length,
  };
}

const DOCS = [
  ['binder-index.md', '00-binder-index', 'Binder index'],
  ['exemption-determination.md', '01-exemption-determination', 'Exemption determination'],
  ['trading-partner-log.md', '02-trading-partner-log', 'Trading partner log'],
  ['sop-incoming-inspection.md', '03-sop-incoming-inspection', 'SOP: incoming inspection'],
  ['sop-suspect-product.md', '04-sop-suspect-product', 'SOP: suspect product'],
  ['sop-saleable-returns.md', '05-sop-saleable-returns', 'SOP: saleable returns'],
  ['tracing-response-runbook.md', '06-tracing-response-runbook', 'Tracing response runbook'],
  ['training-attestation.md', '07-training-attestation', 'Training attestation'],
  ['records-retention-plan.md', '08-records-retention-plan', 'Records retention plan'],
];

const cssString = (v) => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/* Each document is its own PDF and gets pulled out of the binder on its own, so each carries its
 * title in the running head and the pharmacy in the running foot, with page numbers. */
const furniture = (title, pharmacy, licence) => `
@page {
  @top-left { content: "DOSETRACE"; font: 700 8.5pt Helvetica, Arial, sans-serif; color: #1c1a15; }
  @top-right { content: ${cssString(title)}; font: 700 7.5pt Helvetica, Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #56524a; }
  @bottom-left { content: ${cssString([pharmacy, licence && `Licence ${licence}`].filter(Boolean).join(' · '))}; font: 7.5pt Helvetica, Arial, sans-serif; color: #56524a; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Helvetica, Arial, sans-serif; color: #56524a; }
}`;

export default definePack({
  id: 'dosetrace',
  product: { name: 'DoseTrace', url: 'https://dosetrace.thecompound.tech' },
  prices: [{ id: 'binder', name: 'DoseTrace pharmacy supply chain binder', amount: PRICE_CENTS, mode: 'payment' }],

  matches(session) {
    if (session.metadata?.product !== 'dosetrace') return null;
    return { id: 'binder', name: 'DoseTrace pharmacy supply chain binder', amount: PRICE_CENTS, mode: 'payment' };
  },

  intake: {
    fields: FIELDS,
    validate(form, ctx) {
      const r = validateFields(FIELDS, form, ctx);
      if (!r.ok) return r;
      const v = r.value;
      v.owner_title = v.owner_title || 'Pharmacist-in-Charge';
      v.first_name = String(v.owner_name).split(/\s+/)[0] || '';
      v.wholesalers = v.wholesalers.map((w) => ({ ...w, acknowledged: acknowledgedKinds(w) }));
      return { ok: true, value: v };
    },
  },

  documents: [
    {
      slot: 'licence',
      schema: {
        about: 'a wholesale drug distributor licence, or an Authorized Trading Partner (ATP) letter or certificate',
        fields: {
          wholesalerName: { type: 'string', about: 'the licence holder' },
          licenseNumber: 'string',
          state: { type: 'string', about: 'the state that issued it' },
          expirationDate: 'date',
          isATP: { type: 'boolean', about: 'true only if the document itself states the holder is a licensed wholesale distributor or authorized trading partner under DSCSA (21 U.S.C. 360eee); a plain business licence is false' },
        },
      },
      mime: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
      minConfidence: 0.7,
      privacy: 'full',
      validate(read, intake) {
        const w = intake.wholesalers[read.item];
        if (!w) return ['This document is not attached to a wholesaler on your form. Remove it or add the wholesaler.'];
        if (!read.value.wholesalerName && !read.value.licenseNumber) return [`We could not read ${read.name} clearly. Upload a sharper scan or the original PDF.`];
        const kept = new Set(w.acknowledged || []);
        return compare(read.value, w, intake.state, String(read.at).slice(0, 10)).filter((p) => !(p.can_acknowledge && kept.has(p.kind)));
      },
    },
  ],

  determine(ctx) {
    const intake = ctx.intake;
    const today = ctx.today;
    // GATE 1: after the sunset date the pre-sunset binder misdescribes the pharmacy's status.
    if (today >= SUNSET && intake.posture !== 'post_sunset') {
      return refusal(`The exemption ended on ${SUNSET_LONG}. This binder is written for the period before that date, so it cannot be made for you.`);
    }
    // GATE 2: a trading partner log with no partners evidences nothing.
    if (!intake.wholesalers?.length) return needsInput('Add at least one wholesaler. The trading partner log needs every supplier you buy prescription drugs from.');
    // GATE 3: the headcount decides the determination.
    const fte = Number(intake.fte);
    if (!Number.isFinite(fte)) return needsInput('Enter the number of full-time licensed pharmacists and technicians as a whole number.');

    const reads = new Map((ctx.documents.licence || []).map((r) => [r.item, r]));
    const rows = intake.wholesalers.map((w, i) => (reads.has(i) ? verifiedRow(w, reads.get(i), intake.state, today) : { name: w.name, type: 'Wholesale distributor', license: w.license, data_location: w.data_location, retention: w.retention }));
    const locations = Number(intake.locations) || 1;
    const qualifies = fte <= FTE_THRESHOLD;
    const where = locations === 1 ? 'one location' : `${locations} locations`;
    const text = qualifies
      ? `Small dispenser under the FDA exemption. ${fte} licensed pharmacists and technicians across ${where}, at or under the 25-employee threshold.`
      : `Not exempt. ${fte} licensed pharmacists and technicians across ${where} is above the 25-employee threshold, so this pharmacy is not a small business dispenser on the headcount it gave.`;
    const daysLeft = Math.ceil((Date.parse(`${SUNSET}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const fields = {
      date: today,
      date_long: longDate(today),
      pharmacy_name: intake.pharmacy_name,
      dba_line: intake.dba ? ` (d/b/a ${intake.dba})` : '',
      address: `${intake.address}, ${intake.city}, ${intake.state}`,
      state: intake.state,
      state_license: intake.state_license,
      first_name: intake.first_name,
      owner_name: intake.owner_name,
      owner_title: intake.owner_title,
      fte: String(fte),
      locations: String(locations),
      threshold: String(FTE_THRESHOLD),
      sunset: SUNSET,
      sunset_long: SUNSET_LONG,
      days_left: daysLeft > 0 ? `${daysLeft} days` : 'the date has passed',
      determination: text,
      determination_basis: qualifies
        ? `The exemption is available to a dispenser whose owning corporate entity has 25 or fewer full-time employees licensed as pharmacists or qualified as pharmacy technicians. This pharmacy counted ${fte} such employees across every location the entity owns, as of ${today}.`
        : `The exemption is available only where the owning corporate entity has 25 or fewer full-time employees licensed as pharmacists or qualified as pharmacy technicians. This pharmacy's intake of ${today} gave ${fte} such employees across ${locations} location${locations === 1 ? '' : 's'}. ${fte} is more than 25, so the pharmacy does not qualify on that headcount. FDA takes the headcount for the exemption year that runs to ${SUNSET_LONG} on ${FTE_AS_OF}. If the entity's count on that day is 25 or fewer, this determination no longer holds and should be reissued. This determination is based only on the headcount in the intake. It does not assess any earlier period.`,
      exempt_scope_note:
        'The exemption covered only the enhanced drug distribution security requirements: the electronic, interoperable exchange of transaction information and statements. It never covered the core duties. Those are buying only from authorized trading partners, holding transaction information, quarantining and investigating suspect product, and responding to a tracing request.',
      wholesaler_table: wholesalerTable(rows),
      wholesaler_count: String(rows.length),
      sop_revision: today,
      staff_rows: (intake.staff.length ? intake.staff : [{ name: '(add each licensed staff member)', role: '' }]).map((s) => `| ${s.name} | ${s.role || ''} | | |`).join('\n'),
      retention_rows: rows.map((w) => `| ${w.name} | ${w.data_location || '_ask in writing_'} | ${w.retention || '_ask in writing_'} | _ask in writing_ |`).join('\n'),
    };
    return determination({
      summary: text,
      determination: text,
      qualifies,
      fte,
      locations,
      pharmacy_name: intake.pharmacy_name,
      wholesaler_count: String(rows.length),
      sop_revision: today,
      rows,
      fields,
    });
  },

  narratives: [
    {
      slot: 'readiness_brief',
      system: BRIEF_SYSTEM,
      facts: briefFacts,
      vocabulary: BRIEF_VOCABULARY,
      // The brief is an extra paragraph on the index. The nine documents never depend on it.
      fallback: 'omit',
    },
  ],

  render(ctx) {
    const f = ctx.determination.fields;
    const brief = ctx.drafts.readiness_brief;
    return DOCS.map(([file, name, title]) => {
      let md = template(file);
      if (name === '00-binder-index' && brief) md += `\n\n## Readiness brief\n\n${brief.replace(/{{/g, '{ {')}\n`;
      return { name, title: `${title}, ${f.pharmacy_name}`, template: md, format: 'pdf', fields: f, css: furniture(title, f.pharmacy_name, f.state_license) };
    });
  },

  checks(files) {
    const problems = [];
    if (files.length !== DOCS.length) problems.push(`expected ${DOCS.length} documents, built ${files.length}`);
    for (const file of files) {
      if (file.bytes.subarray(0, 5).toString() !== '%PDF-') problems.push(`${file.name} is not a PDF`);
      else if (file.bytes.length < 2000) problems.push(`${file.name} is too small to hold its document`);
    }
    return problems;
  },

  mail: {
    from: process.env.DOSETRACE_MAIL_FROM || 'DoseTrace <orders@example.com>',
    intake: (fields) => {
      const left = Math.ceil((Date.parse(`${SUNSET}T00:00:00Z`) - Date.parse(`${fields.today || new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000);
      return template('order-link-email.md')
        .replaceAll('{{days_left}}', left > 0 ? `${left} days` : 'no days')
        .replaceAll('{{pharmacy_name}}', String(fields.pharmacy_name || 'your pharmacy'));
    },
    reminder: (fields, order) => {
      const days = Math.max(1, Math.floor((Date.parse(fields.today || new Date().toISOString()) - Date.parse(order.created_at)) / 86400000));
      return template('order-reminder-email.md').replaceAll('{{days_ago}}', String(days)).replaceAll('{{pharmacy_name}}', String(fields.pharmacy_name || 'your pharmacy'));
    },
    needsInput: (fields) => {
      const n = Number(fields.problem_count) || 1;
      return template('order-fix-email.md')
        .replaceAll('{{problem_count}}', `${n} answer${n === 1 ? '' : 's'}`)
        .replaceAll('{{pharmacy_name}}', String(fields.pharmacy_name || 'your pharmacy'));
    },
    delivery: template('delivery-email.md'),
    reminderDays: 3,
  },
});
