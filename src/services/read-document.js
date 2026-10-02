// readDocument(file, schema): one model read of one uploaded file into strict JSON.
//
// It never asserts a fact. It returns ok:false on a failed call or on JSON it cannot parse, and on
// ok:true every value carries the type the schema declared and the read carries a confidence. The
// pack's validator decides what a value means for the buyer.
//
// A schema is { about?, fields: { name: type } }. A type is 'string', 'number', 'boolean', 'date'
// (YYYY-MM-DD) or 'string[]', or an object { type, about }. A field the document does not show
// comes back null.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const READ_SYSTEM = [
  'You read one document and return only strict JSON.',
  'Return no prose, no markdown fences and no explanation.',
  'Read the document itself.',
  'If the document does not show a field, use null for it.',
  'Never invent a plausible value.',
  '"confidence" is a number from 0 to 1 for the read as a whole.',
  'Lower it when the document is blurry, cropped or ambiguous, or when you inferred a field instead of reading it.',
].join(' ');

function typeOf(spec) {
  return typeof spec === 'string' ? spec : spec?.type || 'string';
}

export function schemaPrompt(schema) {
  const fields = schema?.fields || {};
  const lines = Object.entries(fields).map(([name, spec]) => {
    const t = typeOf(spec);
    const shown = t === 'date' ? '"YYYY-MM-DD" or null' : t === 'string[]' ? 'array of strings' : `${t} or null`;
    const about = typeof spec === 'object' && spec.about ? ` (${spec.about})` : '';
    return `  "${name}": ${shown}${about}`;
  });
  lines.push('  "confidence": number');
  return `${schema?.about ? `The document: ${schema.about}\n\n` : ''}Output JSON exactly in this shape:\n{\n${lines.join(',\n')}\n}`;
}

/** Pull the first balanced JSON object out of a model answer, ignoring fences and stray prose. */
export function extractJson(s) {
  const cleaned = String(s ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return cleaned;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned;
}

function clamp01(n) {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** Coerce the model's JSON into the declared types. Never trust the raw object. */
export function normaliseRead(raw, schema) {
  const value = {};
  for (const [name, spec] of Object.entries(schema?.fields || {})) {
    const v = raw?.[name];
    switch (typeOf(spec)) {
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : NaN;
        value[name] = Number.isFinite(n) ? n : null;
        break;
      }
      case 'boolean':
        value[name] = v === true ? true : v === false ? false : null;
        break;
      case 'date':
        value[name] = typeof v === 'string' && DATE_RE.test(v.trim()) ? v.trim() : null;
        break;
      case 'string[]':
        value[name] = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
        break;
      default:
        value[name] = typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
    }
  }
  return { value, confidence: clamp01(Number(raw?.confidence)) };
}

/**
 * readDocument({ provider, file, schema, privacy })
 *   file: { name, mimeType, bytes }
 *   privacy: 'full' sends the file; a function (file) -> { text } sends only what it returns;
 *            'none' sends nothing and the read fails with code 'privacy'.
 * -> { ok: true, value, confidence, model }
 *  | { ok: false, code: 'no_inference' | 'parse_failed' | 'bad_input' | 'privacy', error, transient }
 */
export async function readDocument({ provider, file, schema, privacy = 'full', maxBytes = 20 * 1024 * 1024 }) {
  if (!file || !file.bytes) return { ok: false, code: 'bad_input', error: 'no file', transient: false };
  if (file.bytes.length > maxBytes) return { ok: false, code: 'bad_input', error: `file is over ${Math.round(maxBytes / 1048576)} MB`, transient: false };
  if (privacy === 'none') return { ok: false, code: 'privacy', error: 'this document may not be sent to a model', transient: false };

  let sent = file;
  if (typeof privacy === 'function') {
    const reduced = await privacy(file);
    sent = { name: file.name, mimeType: 'text/plain', bytes: Buffer.from(String(reduced?.text ?? ''), 'utf8') };
  }

  const prompt = `Read the attached document and extract its fields.\n\n${schemaPrompt(schema)}\n\nWrite the JSON now.`;
  let lastError = 'model returned unparseable output';
  // One more try on unparseable JSON, then the caller decides.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await provider.complete({ purpose: 'read', system: READ_SYSTEM, prompt, file: sent, json: true, maxTokens: 800 });
    if (!res.ok) return { ok: false, code: 'no_inference', error: res.reason, transient: res.transient !== false };
    try {
      const parsed = JSON.parse(extractJson(res.text));
      const { value, confidence } = normaliseRead(parsed, schema);
      return { ok: true, value, confidence, model: res.model };
    } catch (err) {
      lastError = `model returned unparseable output: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { ok: false, code: 'parse_failed', error: lastError, transient: true };
}
