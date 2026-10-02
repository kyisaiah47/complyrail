// THE GROUNDING RULE. It is fixed in the engine, and a pack cannot change it.
//
// Every digit run, every number word, every written date and every capitalised multi-word phrase in
// a draft must appear in the facts the model was given or in the pack's vocabulary. One ungrounded
// token rejects the whole draft. A pack supplies facts and vocabulary only.
//
// Numbers are compared as whole numbers. "25" in a draft is grounded by a fact that states 25. It is
// not grounded by a fact that states 2025.
//
// Number words count as numbers. "Three", "twenty-one", "two hundred and fifty", "a dozen" and
// "thousands" are read as their value, and the value must appear in the facts, as digits or as the
// same words. "one" and "a" alone are not checked, because both are far more often a pronoun or an
// article than a count. Ordinals ("third") are not counts and are not checked.
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

const SMALL = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, hundreds: 100, thousand: 1000, thousands: 1000, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9 };
const DOZEN = { dozen: 12, dozens: 12 };
const NUMBER_WORDS = [...Object.keys(SMALL), ...Object.keys(TENS), ...Object.keys(SCALE), ...Object.keys(DOZEN)];
const WORD_ALT = NUMBER_WORDS.sort((a, b) => b.length - a.length).join('|');
const NUMBER_WORD_RUN_RE = new RegExp(`\\b(?:${WORD_ALT})(?:(?:[\\s-]+and[\\s-]+|[\\s-]+)(?:${WORD_ALT}))*\\b`, 'gi');

const isSmall = (w) => w in SMALL || w in TENS;

function valueOf(words) {
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (w in SMALL) current += SMALL[w];
    else if (w in TENS) current += TENS[w];
    else if (w in DOZEN) current = (current || 1) * 12;
    else if (SCALE[w] === 100) current = (current || 1) * 100;
    else if (w in SCALE) {
      total += (current || 1) * SCALE[w];
      current = 0;
    }
  }
  return total + current;
}

/**
 * Every spelled-out quantity in a text, as { phrase, words, value }. A run of number words is one
 * quantity ("two hundred and fifty", "twenty-one"); two counts side by side ("two three") or joined
 * by "and" without a scale before it ("two and three") are separate quantities.
 */
export function numberWords(text) {
  const out = [];
  for (const m of String(text).matchAll(NUMBER_WORD_RUN_RE)) {
    const tokens = [...m[0].matchAll(/[A-Za-z]+/g)].map((t) => ({ w: t[0], at: m.index + t.index }));
    let cur = [];
    let start = 0;
    let end = 0;
    const flush = () => {
      if (cur.length) out.push({ phrase: String(text).slice(start, end), words: cur, value: valueOf(cur) });
      cur = [];
    };
    for (const { w: raw, at } of tokens) {
      const w = raw.toLowerCase();
      const prev = cur[cur.length - 1];
      if (w === 'and') {
        if (!(prev && (prev in SCALE || prev in DOZEN))) flush();
        continue;
      }
      // "twenty one" continues a number; "two three" and "twenty thirty" do not.
      if (prev && isSmall(prev) && isSmall(w) && !(prev in TENS && w in SMALL && SMALL[w] < 10)) flush();
      if (!cur.length) start = at;
      cur.push(w);
      end = at + raw.length;
    }
    flush();
  }
  return out;
}

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
  // A fact that spells a count out ("three wholesalers") grounds the same count in digits.
  for (const n of numberWords(text)) numbers.add(String(n.value));
  return { text, numbers };
}

function containsWords(haystack, words) {
  const forms = [words.join(' '), words.join('-')];
  return forms.some((f) => new RegExp(`(^|[^a-z])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(haystack.text));
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

  for (const n of numberWords(candidate)) {
    if (n.words.length === 1 && n.words[0] === 'one') continue; // a pronoun far more often than a count
    if (haystack.numbers.has(String(n.value)) || containsWords(haystack, n.words)) continue;
    return { ok: false, kind: 'number', token: n.phrase };
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
  'A number written as a word counts as a number.',
  'If a fact is marked incomplete, say plainly that it is still to do.',
  'Write plain sentences. Do not use headings, bullet points or markdown.',
].join(' ');
