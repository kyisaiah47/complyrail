// definePack() checks a pack against the interface before the engine runs it, and validateFields()
// checks a buyer's form against the pack's field list.

const FORMATS = new Set(['pdf', 'csv', 'html']);

function fail(id, msg) {
  throw new Error(`pack ${id || '(no id)'}: ${msg}`);
}

/** Validate a pack's shape and return it unchanged. Throws one sentence naming the first problem. */
export function definePack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('a pack must be an object');
  const id = pack.id;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(id, 'id must be a lower-case slug');
  if (typeof pack.matches !== 'function') fail(id, 'matches(session) must be a function');
  if (!pack.intake || !Array.isArray(pack.intake.fields) || typeof pack.intake.validate !== 'function') fail(id, 'intake needs fields[] and validate(form)');
  if (typeof pack.determine !== 'function') fail(id, 'determine(ctx) must be a function');
  if (typeof pack.render !== 'function') fail(id, 'render(ctx) must be a function');
  if (!pack.mail || typeof pack.mail.from !== 'string' || !pack.mail.intake || !pack.mail.delivery || typeof pack.mail.reminderDays !== 'number') {
    fail(id, 'mail needs from, intake, delivery and reminderDays');
  }
  for (const d of pack.documents || []) {
    if (!d.slot || !d.schema || !Array.isArray(d.mime) || typeof d.minConfidence !== 'number' || typeof d.validate !== 'function') {
      fail(id, `document ${d.slot || '(no slot)'} needs slot, schema, mime[], minConfidence and validate(read, intake)`);
    }
    if (!(d.privacy === 'full' || d.privacy === 'none' || typeof d.privacy === 'function')) fail(id, `document ${d.slot} privacy must be 'full', 'none' or a function`);
  }
  for (const s of pack.sources || []) if (!s.name || typeof s.fetch !== 'function') fail(id, 'each source needs name and fetch(order)');
  for (const n of pack.narratives || []) {
    if (!n.slot || typeof n.system !== 'string' || typeof n.facts !== 'function' || !Array.isArray(n.vocabulary)) fail(id, `narrative ${n.slot || '(no slot)'} needs slot, system, facts(ctx) and vocabulary[]`);
    const f = n.fallback;
    const ok = f === 'omit' || (f && typeof f.print === 'function') || (f && typeof f.ask === 'string');
    if (!ok) fail(id, `narrative ${n.slot} fallback must be 'omit', { print(ctx) } or { ask: sentence }`);
  }
  for (const a of pack.actions || []) if (!a.state || typeof a.run !== 'function') fail(id, 'each action needs state and run(order)');
  if (pack.monitor && (typeof pack.monitor.everyDays !== 'number' || typeof pack.monitor.run !== 'function')) fail(id, 'monitor needs everyDays and run(order)');
  if (pack.checks && typeof pack.checks !== 'function') fail(id, 'checks must be a function of the built files');
  return pack;
}

export function assertDocs(packId, docs) {
  if (!Array.isArray(docs) || !docs.length) fail(packId, 'render(ctx) returned no documents');
  const names = new Set();
  for (const d of docs) {
    if (!d || typeof d.name !== 'string' || !d.name) fail(packId, 'every document needs a name');
    if (names.has(d.name)) fail(packId, `two documents are named ${d.name}`);
    names.add(d.name);
    if (typeof d.template !== 'string') fail(packId, `document ${d.name} needs a template string`);
    if (!FORMATS.has(d.format)) fail(packId, `document ${d.name} format must be pdf, csv or html`);
  }
  return docs;
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
}

/**
 * validateFields(fields, form, { uploads }) -> { ok: true, value } | { ok: false, errors: [{ field, message }] }
 *
 * Field types: text, textarea, email, number, integer, select, checkbox, list and file.
 * A list holds rows of sub-fields in `of`. A file field names a document `slot`; its row index is
 * the upload's item number.
 */
export function validateFields(fields, form = {}, { uploads = [] } = {}, prefix = '', item = null) {
  const value = {};
  const errors = [];
  for (const f of fields) {
    const key = prefix ? `${prefix}.${f.name}` : f.name;
    const label = f.label || f.name;
    const raw = form?.[f.name];
    const max = f.max ?? (f.type === 'textarea' ? 4000 : 200);
    switch (f.type || 'text') {
      case 'list': {
        const rows = Array.isArray(raw) ? raw.slice(0, f.max ?? 50) : [];
        const out = [];
        rows.forEach((row, i) => {
          const r = validateFields(f.of || [], row || {}, { uploads }, `${key}.${i}`, i);
          if (r.ok) out.push(r.value);
          else errors.push(...r.errors);
        });
        if (out.length < (f.min ?? 0) && errors.length === 0) errors.push({ field: key, message: f.minMessage || `Add at least ${f.min} to ${label}.` });
        value[f.name] = out;
        break;
      }
      case 'number':
      case 'integer': {
        const s = str(raw, 24);
        if (s === '') {
          if (f.required) errors.push({ field: key, message: f.message || `Enter ${label}.` });
          value[f.name] = null;
          break;
        }
        const n = Number(s.replace(/,/g, ''));
        const bad = !Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n)) || (f.minValue !== undefined && n < f.minValue) || (f.maxValue !== undefined && n > f.maxValue);
        if (bad) errors.push({ field: key, message: f.message || `Enter ${label} as a ${f.type === 'integer' ? 'whole number' : 'number'}.` });
        value[f.name] = bad ? null : n;
        break;
      }
      case 'checkbox':
        value[f.name] = raw === true || raw === 'on' || raw === 'true';
        if (f.required && !value[f.name]) errors.push({ field: key, message: f.message || `Confirm ${label}.` });
        break;
      case 'file': {
        const up = uploads.find((u) => u.slot === f.slot && u.item === (item ?? 0));
        if (!up && f.required) errors.push({ field: key, message: f.message || `Upload ${label}.` });
        value[f.name] = up ? { slot: up.slot, item: up.item, name: up.name, path: up.path } : null;
        break;
      }
      case 'select': {
        const s = str(raw, max);
        const allowed = (f.options || []).map((o) => (typeof o === 'string' ? o : o.value));
        if (!s && f.required) errors.push({ field: key, message: f.message || `Choose ${label}.` });
        else if (s && !allowed.includes(s)) errors.push({ field: key, message: f.message || `Choose ${label} from the list.` });
        value[f.name] = s || null;
        break;
      }
      case 'email': {
        const s = str(raw, max);
        if (!s && f.required) errors.push({ field: key, message: f.message || `Enter ${label}.` });
        else if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errors.push({ field: key, message: f.message || `Enter ${label} as an email address.` });
        value[f.name] = s;
        break;
      }
      default: {
        const s = str(raw, max);
        if (!s && f.required) errors.push({ field: key, message: f.message || `Enter ${label}.` });
        value[f.name] = s;
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
