#!/usr/bin/env node
// The complyrail command.
//
//   complyrail new-app [dir] --app console|simple|both [--name "Product name"] [--force]
//   complyrail tick   [--config complyrail.config.mjs]     advance every due order once
//   complyrail worker [--config complyrail.config.mjs] [--every 120]
//   complyrail sync   [--config complyrail.config.mjs]     turn new paid sessions into orders
//
// A config file's default export returns an engine, or the options for createEngine().
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createEngine } from './engine.js';
import { newApp, MODES } from './scaffold/new-app.js';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const HELP = `complyrail ${pkg.version}

  complyrail new-app [dir] --app console|simple|both [--name "Product name"] [--force]
      Scaffold a Next.js app wired to the engine.
  complyrail tick   [--config complyrail.config.mjs]
      Advance every due order once.
  complyrail worker [--config complyrail.config.mjs] [--every 120]
      Sync paid sessions and advance due orders every N seconds.
  complyrail sync   [--config complyrail.config.mjs]
      Turn new paid Checkout sessions into orders.
`;

async function loadEngine(configPath) {
  const file = path.resolve(configPath || 'complyrail.config.mjs');
  if (!fs.existsSync(file)) throw new Error(`no config at ${file}`);
  const mod = await import(pathToFileURL(file).href);
  const made = typeof mod.default === 'function' ? await mod.default() : mod.default;
  return made && typeof made.tick === 'function' ? made : createEngine(made);
}

async function main() {
  const args = parse(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || args.help || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === '--version' || cmd === 'version' || args.version) {
    console.log(pkg.version);
    return;
  }
  if (cmd === 'new-app') {
    const mode = typeof args.app === 'string' ? args.app : 'both';
    if (!MODES.includes(mode)) throw new Error(`--app must be one of ${MODES.join(', ')}`);
    const dir = args._[1] || 'complyrail-app';
    const r = newApp({ dir, mode, name: typeof args.name === 'string' ? args.name : undefined, version: pkg.version, force: Boolean(args.force) });
    console.log(`Created a ${mode} app in ${r.dir} (${r.files.length} files).`);
    console.log('Next steps:');
    console.log(`  cd ${path.relative(process.cwd(), r.dir) || '.'}`);
    console.log('  npm install');
    console.log('  cp .env.example .env.local   # then fill in the keys you have');
    console.log('  npm run dev                  # the site');
    console.log('  npm run worker               # the order worker, in a second terminal');
    return;
  }
  if (cmd === 'tick' || cmd === 'sync') {
    const engine = await loadEngine(args.config);
    if (cmd === 'sync') console.log(`${(await engine.syncPayments()).length} new order(s)`);
    else console.log(`${(await engine.tick()).length} order(s) advanced`);
    return;
  }
  if (cmd === 'worker') {
    const engine = await loadEngine(args.config);
    const every = Math.max(10, Number(args.every || 120)) * 1000;
    for (;;) {
      try {
        await engine.syncPayments();
        await engine.tick();
      } catch (err) {
        console.error(`[complyrail] tick failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, every));
    }
  }
  throw new Error(`unknown command ${cmd}. Run complyrail help.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
