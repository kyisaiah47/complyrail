// THE GROUNDING RULE. It is fixed in the engine, and a pack cannot change it.
//
// Every digit run, every written date and every capitalised multi-word phrase in a draft must
// appear in the facts the model was given or in the pack's vocabulary. One ungrounded token rejects
// the whole draft. A pack supplies facts and vocabulary only.
//
// Numbers are compared as whole numbers. "25" in a draft is grounded by a fact that states 25. It is
// not grounded by a fact that states 2025.
//
// A capitalised run that fails as a whole is retried with its leading words dropped, down to two
// words. A grounded name often follows an ordinary sentence-initial capital ("As Alder Creek Family
// Pharmacy ..."), and the regex swallows both into one run. An invented phrase fails every tail.
// A possessive inside a run splits it, because "Alder Creek Family Pharmacy's DSCSA" joins two facts.

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const DATE_RES = [
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'),
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS}),?\\s+\\d{4}\\b`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`, 'gi'),
];
const PHRASE_RE = /\b[A-Z][a-zA-Z&'-]*(?:\s+[A-Z][a-zA-Z&'-]*){1,5}\b/g;

function normaliseNumber(raw) {
  let s = String(raw).replace(/,/g, '');
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  s = s.replace(/^0+(?=\d)/, '');
  return s;
}

function flatten(value, out) {
  if (value === null || value === undefined || value === '') return out;
  if (Array.isArray(value)) {
    for (const v of value) flatten(v, out);
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(String(k));
      flatten(v, out);
    }
  } else {
    out.push(String(value));
  }
  return out;
}

/** The facts as numbered lines, which is what the drafter shows the model. */
export function factLines(facts) {
  if (Array.isArray(facts)) return facts.map((f) => (typeof f === 'string' ? f : flatten(f, []).join(' '))).filter(Boolean);
  if (facts && typeof facts === 'object') {
    return Object.entries(facts)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? flatten(v, []).join(' ') : v}`);
  }
  return facts ? [String(facts)] : [];
}

/**
 * Everything the draft may say, as one lower-case search string and a set of whole numbers.
 * Facts may be an array of strings, an object of label to value, or any nested mix of the two.
 */
export function buildHaystack(facts, vocabulary = []) {
  const parts = flatten(facts, []);
  for (const v of vocabulary || []) parts.push(String(v));
  const text = parts.join(' \n ').replace(/[‘’]/g, "'").toLowerCase();
  const numbers = new Set();
  for (const m of text.matchAll(NUMBER_RE)) {
    numbers.add(normaliseNumber(m[0]));
    // "2026-10-02" holds the runs 2026, 10 and 02; "1,500" holds 1500.
    for (const run of m[0].split(/[^\d]+/)) if (run) numbers.add(normaliseNumber(run));
  }
  return { text, numbers };
}

function containsPhrase(haystack, needle) {
  return haystack.text.includes(String(needle).toLowerCase());
}

/**
 * checkGrounded(draft, facts, vocabulary)
 *   -> { ok: true, text }
 *    | { ok: false, kind: 'number' | 'date' | 'phrase' | 'empty', token }
 */
export function checkGrounded(draft, facts, vocabulary = []) {
  const haystack = facts && facts.text !== undefined && facts.numbers instanceof Set ? facts : buildHaystack(facts, vocabulary);
  if (!draft || !String(draft).trim()) return { ok: false, kind: 'empty', token: '' };
  const candidate = String(draft).replace(/[‘’]/g, "'");

  for (const m of candidate.matchAll(NUMBER_RE)) {
    const n = normaliseNumber(m[0].replace(/[,.]$/, ''));
    if (!haystack.numbers.has(n)) return { ok: false, kind: 'number', token: m[0].replace(/[,.]$/, '') };
  }

  for (const re of DATE_RES) {
    for (const m of candidate.matchAll(re)) {
      if (!containsPhrase(haystack, m[0])) return { ok: false, kind: 'date', token: m[0] };
    }
  }

  const groundedRun = (run) => {
    const words = run.split(/\s+/).filter(Boolean);
    if (words.length < 2) return true; // single capitalised words are not checked
    for (let start = 0; start <= words.length - 2; start++) {
      if (containsPhrase(haystack, words.slice(start).join(' '))) return true;
    }
    return false;
  };
  for (const m of candidate.matchAll(PHRASE_RE)) {
    const parts = m[0].split(/'s(?:\s+|$)/);
    if (!parts.every(groundedRun)) return { ok: false, kind: 'phrase', token: m[0] };
  }

  return { ok: true, text: candidate.trim() };
}

/** The sentence the engine adds to every drafting prompt. Packs cannot remove it. */
export const GROUNDING_INSTRUCTIONS = [
  'Use only the facts given below.',
  'Do not state a number, a date, a name or an organisation that is not in the facts, even to round it, generalise it or give an example.',
  'If a fact is marked incomplete, say plainly that it is still to do.',
  'Write plain sentences. Do not use headings, bullet points or markdown.',
].join(' ');
