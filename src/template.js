// Templates: {{field}} placeholders, and email templates that open with a Subject line.

/** Replace every {{key}} with fields[key]. An unresolved placeholder is an error, never a blank. */
export function fillTemplate(template, fields = {}, name = 'template') {
  let out = String(template);
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && typeof v === 'object') continue;
    out = out.split(`{{${k}}}`).join(v === null || v === undefined ? '' : String(v));
  }
  const left = out.match(/{{\s*[a-zA-Z0-9_.-]+\s*}}/g);
  if (left) throw new Error(`${name}: unresolved fields ${[...new Set(left)].join(', ')}`);
  return out;
}

/**
 * An email template is one of:
 *   - a string whose first line is "Subject: ..." followed by a blank line and the body,
 *   - an object { subject, text, html? } whose strings may hold {{placeholders}},
 *   - a function (fields, order) returning either of the above.
 * Returns { subject, text, html }.
 */
export function renderMail(template, fields = {}, order = null, name = 'mail template') {
  let t = typeof template === 'function' ? template(fields, order) : template;
  if (typeof t === 'string') {
    const filled = fillTemplate(t, fields, name);
    const m = /^Subject:\s*(.*)\r?\n(?:\r?\n)?/.exec(filled);
    if (!m) throw new Error(`${name}: a string template must start with a "Subject:" line`);
    return { subject: m[1].trim(), text: filled.slice(m[0].length).trimEnd() + '\n', html: null };
  }
  if (t && typeof t === 'object' && typeof t.subject === 'string' && typeof t.text === 'string') {
    return {
      subject: fillTemplate(t.subject, fields, name).trim(),
      text: fillTemplate(t.text, fields, name).trimEnd() + '\n',
      html: t.html ? fillTemplate(t.html, fields, name) : null,
    };
  }
  throw new Error(`${name}: expected a "Subject:" string, a { subject, text } object or a function`);
}
