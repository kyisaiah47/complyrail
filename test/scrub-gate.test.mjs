// The scrub gate must fail closed on every class it guards. Each sample is assembled at run time,
// so this file itself holds none of them and passes the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, scanTree } from '../scripts/scrub-gate.mjs';
import { tmpDir } from './helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = (...parts) => parts.join('');
const h = (s) => crypto.createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 24);

const SAMPLES = {
  'local home path': j('/Us', 'ers/', 'someone/project'),
  'Stripe account id': j('acc', 't_', '1AbCdEfGhIjKlMn'),
  'decentralised identifier': j('di', 'd:plc:', 'abcdefghijklmnop'),
  'private credential tool': j('compound-', 'sec', 'ret STRIPE_KEY'),
  'OpenAI or Anthropic key': j('s', 'k-', 'proj-', 'a'.repeat(40)),
  'Stripe secret key': j('s', 'k_', 'live_', 'b'.repeat(24)),
  'Google API key': j('AI', 'za', 'c'.repeat(35)),
  'GitHub token': j('gh', 'p_', 'd'.repeat(36)),
  'AWS access key': j('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
  'private key block': j('-----BEGIN ', 'PRIVATE', ' KEY-----'),
  'JSON web token': j('ey', 'J', 'e'.repeat(20), '.ey', 'J', 'f'.repeat(20), '.', 'g'.repeat(20)),
  'hard-coded secret': j('api', 'Key', ' = "', 'h'.repeat(32), '"'),
  'stealth browser plugin': j("require('puppeteer-extra-plugin-", 'stea', "lth')"),
  'CAPTCHA bypass service': j('2', 'cap', 'tcha'),
  'webdriver flag override': j("Object.defineProperty(navigator, 'web", "driver', { get: () => false })"),
};

for (const [rule, sample] of Object.entries(SAMPLES)) {
  test(`the gate fails on a ${rule}`, () => {
    const found = scanText('sample.js', `const x = 1;\n${sample}\n`);
    assert.ok(found.some((f) => f.rule === rule), `${rule}: ${JSON.stringify(found)}`);
  });
}

test('personal identifiers are matched by hash, so the gate never spells them out', () => {
  const sets = { personalEmailLocal: new Set([h('pat.sample')]), privateIds: new Set([h('qzxprojectid0000')]), handles: new Set([h('samplehandle')]), githubOwner: h('samplehandle') };
  const text = j('mail pat.sample', '@example.org\nproject qzxprojectid0000.supabase.co\n@samplehandle on X\nhttps://github.com/', 'samplehandle/repo\n');
  const found = scanText('x.md', text, sets);
  assert.deepEqual(found.map((f) => f.rule).sort(), ['account handle', 'personal email address', 'private project or account id']);
  assert.equal(found.find((f) => f.rule === 'account handle').line, 3, 'the repository address on line 4 is allowed');
});

test('a clean file passes', () => {
  assert.deepEqual(scanText('ok.js', 'export const answer = 42; // see https://example.com\n'), []);
});

test('the command exits non-zero on a dirty tree and zero on a clean one', () => {
  const dir = tmpDir('complyrail-scrub-');
  const gate = path.join(ROOT, 'scripts', 'scrub-gate.mjs');
  fs.writeFileSync(path.join(dir, 'clean.md'), 'Nothing to see.\n');
  assert.match(execFileSync(process.execPath, [gate, '--root', dir], { encoding: 'utf8' }), /passed/);
  fs.writeFileSync(path.join(dir, 'dirty.md'), `${SAMPLES['Google API key']}\n`);
  assert.throws(() => execFileSync(process.execPath, [gate, '--root', dir], { stdio: 'pipe' }), /Command failed/);
});

test('this repository passes its own scrub gate', () => {
  const { findings } = scanTree(ROOT);
  assert.deepEqual(findings, []);
});
