#!/usr/bin/env node
// THE SCRUB GATE. It fails closed when any file in the repository holds something that must never
// be public:
//
//   - a maintainer's personal email address,
//   - a maintainer's local home path,
//   - the maintainers' hosted database project id,
//   - a Stripe account id, or any decentralised identifier (did:plc:...),
//   - the maintainers' private credential tools,
//   - the maintainers' social account handles,
//   - a key-shaped string (API keys, tokens, private keys, service role JWTs, webhook secrets),
//   - bot-detection bypass code: a stealth browser plugin, a service or library that solves
//     CAPTCHAs, or an override of the browser's webdriver flag.
//
// Personal identifiers are stored here only as truncated SHA-256 hashes. The gate hashes every
// word-shaped token in every file and compares, so this public file never spells out what it
// protects. The patterns for code and key shapes are written so they cannot match their own source.
//
// It has no allowlist, no skip flag and no known-issues file. A finding is fixed in the file.
//
//   node scripts/scrub-gate.mjs            # scan every tracked and untracked, unignored file
//   node scripts/scrub-gate.mjs --root dir # scan another tree
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hash = (s) => crypto.createHash('sha256').update(String(s).toLowerCase()).digest('hex').slice(0, 24);

/* Email local parts of the maintainers' personal mailboxes. */
const PERSONAL_EMAIL_LOCAL = new Set([
  '1232b0f5e5073b48e735122a',
  '7565b53036e265298424a9b7',
  '9e5b2ac27f550fd4a4425af0',
  '22918b4eb9aa29bee78df1bf',
  '2f986f5f901c9bdbe75d52d6',
  'db06483bc5d43da544887df5',
]);

/* The hosted database project id and the account DIDs. */
const PRIVATE_IDS = new Set(['41f5de058b2a5859451df101', '610f6aca579d27046d173160', '46beb0e600da7c9558b4fc98']);

/* Social account handles. The first one is also the GitHub owner, which may appear only as the
 * repository's own address, directly after "github.com/". */
const GITHUB_OWNER = '1232b0f5e5073b48e735122a';
const HANDLES = new Set([
  GITHUB_OWNER,
  '37354cb95dcc4ee9cf024879',
  '7d51d82c55fe2d756d2e0086',
  'b2f3a4aee965bf05b70efe86',
  '3a0e52ccc2254ebca7256e69',
  '8e325fd979479aa192acb641',
  '7327751d474f3cca55c8a931',
  'f11d00bfd64aed93522c78db',
  '926b41eebada34c916aced7c',
  '4a20a45bb111de6b6ec8e5a7',
]);

/* Each pattern is written with a character class inside its keyword, so the gate's own source
 * does not match it. */
const PATTERNS = [
  ['local home path', /\/Us[e]rs\/[A-Za-z0-9._-]+/],
  ['Stripe account id', /\bacc[t]_[A-Za-z0-9]{8,}/],
  ['decentralised identifier', /\bdi[d]:plc:[a-z2-7]{8,}/],
  ['private credential tool', /\bcompound-(?:secr[e]t|vau[l]t)\b/],

  ['OpenAI or Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['Stripe secret key', /\b(?:s[k]|r[k])_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['Stripe webhook secret', /\bwhs[e]c_[A-Za-z0-9]{20,}/],
  ['Google API key', /\bAI[z]a[0-9A-Za-z_-]{35}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_p[a]t_[A-Za-z0-9_]{30,})/],
  ['Slack token', /\bxo[x][abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKI[A][0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVAT[E] KEY-----/],
  ['JSON web token', /\bey[J][A-Za-z0-9_-]{10,}\.ey[J][A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['Supabase access token', /\bsb[p]_[a-f0-9]{40}\b/],
  ['Supabase secret key', /\bsb_secre[t]_[A-Za-z0-9_-]{20,}/],
  ['hard-coded secret', /\b(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{28,}["']/i],

  ['stealth browser plugin', /(?:puppeteer-extra-plugin-stea[l]th|playwright-ext[r]a|Stealth[P]lugin|undetected-chromedri[v]er)/i],
  ['CAPTCHA bypass service', /(?:\b2capt[c]ha\b|anti-?capt[c]ha|capsol[v]er|capmons[t]er|deathbycapt[c]ha|capt[c]ha[\s_-]*sol[v](?:e|er|ing))/i],
  ['webdriver flag override', /(?:defineProperty\(\s*navigator\s*,\s*["']webdri[v]er|navigator\.webdri[v]er\s*=|["']--disable-blink-features=AutomationControll[e]d)/],
];

const TEXT_EXT = /\.(?:m?js|cjs|ts|tsx|jsx|json|md|txt|yml|yaml|css|html|svg|sql|sh|env|example|gitignore|npmignore|lock)$/i;

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = out.split('\0').filter(Boolean);
    if (files.length) return files.filter((f) => fs.existsSync(path.join(root, f)));
  } catch {
    /* not a git checkout */
  }
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(root, p));
    }
  };
  walk(root);
  return files;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** scanText(name, text) -> [{ file, line, rule, sample }] */
export function scanText(file, text, sets = {}) {
  const local = sets.personalEmailLocal || PERSONAL_EMAIL_LOCAL;
  const ids = sets.privateIds || PRIVATE_IDS;
  const handles = sets.handles || HANDLES;
  const owner = sets.githubOwner || GITHUB_OWNER;
  const findings = [];
  const add = (rule, index, sample) => findings.push({ file, line: lineOf(text, index), rule, sample: String(sample).slice(0, 12) + (String(sample).length > 12 ? '...' : '') });

  for (const m of text.matchAll(/([A-Za-z0-9._%+-]+)@[A-Za-z0-9-]+\.[A-Za-z]/g)) {
    if (local.has(hash(m[1]))) add('personal email address', m.index, '<redacted>@');
  }
  for (const m of text.matchAll(/[A-Za-z0-9_.-]{3,64}/g)) {
    const token = m[0].replace(/^[._-]+|[._-]+$/g, '');
    const parts = new Set([token, ...token.split('.')].filter((p) => p.length >= 3));
    for (const p of parts) {
      const h = hash(p);
      if (ids.has(h)) add('private project or account id', m.index, '<redacted>');
      else if (handles.has(h)) {
        const before = text.slice(Math.max(0, m.index - 11), m.index);
        if (h === owner && before === 'github.com/' && token === p) continue;
        add('account handle', m.index, '<redacted>');
      }
    }
  }
  for (const [rule, re] of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) add(rule, m.index, m[0]);
  }
  return findings;
}

export function scanTree(root) {
  const findings = [];
  const files = listFiles(root);
  for (const rel of files) {
    const full = path.join(root, rel);
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    const text = TEXT_EXT.test(rel) ? buf.toString('utf8') : buf.toString('latin1');
    findings.push(...scanText(rel, text));
  }
  return { files: files.length, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i === -1 ? path.join(path.dirname(fileURLToPath(import.meta.url)), '..') : process.argv[i + 1]);
  const { files, findings } = scanTree(root);
  if (findings.length) {
    console.error(`scrub gate: FAILED, ${findings.length} finding(s) in ${root}`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}  ${f.sample}`);
    process.exit(1);
  }
  console.log(`scrub gate: passed, ${files} files scanned, 0 findings`);
}
