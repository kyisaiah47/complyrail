// complyrail new-app writes a complete Next.js tree for each --app value. A full `next build` of
// each mode is run by hand before a release; this test checks the tree and the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newApp, MODES } from '../src/scaffold/new-app.js';
import { scanTree } from '../scripts/scrub-gate.mjs';
import { tmpDir } from './helpers.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

const COMMON = [
  '.env.example',
  '.gitignore',
  'complyrail.config.mjs',
  'next.config.mjs',
  'package.json',
  'pack/index.mjs',
  'scripts/worker.mjs',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/order/[token]/page.tsx',
  'src/app/order/start/route.ts',
  'src/app/api/checkout/route.ts',
  'src/app/api/order/[token]/route.ts',
  'src/app/api/order/[token]/intake/route.ts',
  'src/app/api/order/[token]/download/route.ts',
  'src/components/IntakeForm.tsx',
  'src/components/state.ts',
  'src/lib/engine.ts',
  'src/lib/pack-info.ts',
  'tsconfig.json',
];

const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

for (const mode of MODES) {
  test(`new-app --app ${mode} writes the tree for that view`, () => {
    const dir = path.join(tmpDir('complyrail-app-'), 'app');
    const r = newApp({ dir, mode, name: 'Harbor Forms', version: '9.9.9' });
    for (const rel of COMMON) assert.ok(has(dir, rel), `${rel} is missing`);
    assert.equal(has(dir, 'src/components/console/ConsoleHome.tsx'), mode !== 'simple');
    assert.equal(has(dir, 'src/components/simple/SimpleHome.tsx'), mode !== 'console');
    assert.equal(has(dir, 'src/components/site-view/Welcome.tsx'), mode === 'both');
    const pkg = JSON.parse(read(dir, 'package.json'));
    assert.equal(pkg.name, 'harbor-forms');
    assert.equal(pkg.dependencies.complyrail, '^9.9.9');
    assert.ok(pkg.dependencies.next && pkg.scripts.worker);
    const page = read(dir, 'src/app/page.tsx');
    if (mode === 'both') assert.match(page, /<PageViews consoleView=\{<ConsoleHome/);
    if (mode === 'console') assert.match(page, /<ConsoleHome info=\{info\} \/>/);
    if (mode === 'simple') assert.match(page, /<SimpleHome info=\{info\} \/>/);
    assert.match(read(dir, 'pack/index.mjs'), /id: 'harbor-forms'/);
    if (mode === 'both') assert.match(read(dir, 'src/components/site-view/SiteViewProvider.tsx'), /'harbor-forms:view'/);
    for (const rel of r.files) assert.doesNotMatch(read(dir, rel), /__APP_(NAME|SLUG)__|__COMPLYRAIL_VERSION__/, rel);
    assert.equal(scanTree(dir).findings.length, 0, 'the generated app passes the scrub gate');
  });
}

test('new-app refuses a directory that is not empty', () => {
  const dir = tmpDir('complyrail-app-');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  assert.throws(() => newApp({ dir, mode: 'both', version: '1.0.0' }), /not empty/);
  assert.throws(() => newApp({ dir: path.join(dir, 'x'), mode: 'dense', version: '1.0.0' }), /--app must be one of console, simple, both/);
});

test('the complyrail command scaffolds through new-app and rejects an unknown view', () => {
  const dir = path.join(tmpDir('complyrail-cli-'), 'site');
  const out = execFileSync(process.execPath, [CLI, 'new-app', dir, '--app', 'simple', '--name', 'Pier Records'], { encoding: 'utf8' });
  assert.match(out, /Created a simple app/);
  assert.equal(JSON.parse(read(dir, 'complyrail.app.json')).app, 'simple');
  assert.throws(() => execFileSync(process.execPath, [CLI, 'new-app', `${dir}-2`, '--app', 'dense'], { stdio: 'pipe' }));
  assert.match(execFileSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' }), /new-app \[dir\] --app console\|simple\|both/);
});
