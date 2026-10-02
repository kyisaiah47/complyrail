// HTML to PDF through a local headless Chrome or Chromium.
//
// The browser is found through CHROME_PATH, or else by name on the PATH (google-chrome,
// chromium and their variants). The library holds no per-platform install paths. On macOS, set
// CHROME_PATH to the binary inside the Chrome application bundle.
//
// Chrome's new headless mode writes the PDF and then often keeps running. So the renderer starts
// Chrome with its own temporary profile, waits until the output file exists and its size holds
// for two polls, and then stops the process it started. It never touches another Chrome profile,
// never opens a window and never plays sound.
//
// Set COMPLYRAIL_CHROME_NO_SANDBOX=1 only inside a container or CI runner that cannot start
// Chrome's sandbox.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome'];

/** The Chrome binary to use, or null when none is configured or on the PATH. */
export function findChrome(env = process.env) {
  const named = env.CHROME_PATH || env.COMPLYRAIL_CHROME;
  if (named) return fs.existsSync(named) ? named : null;
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  for (const name of PATH_NAMES) {
    try {
      const p = execFileSync(lookup, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim();
      if (p) return p;
    } catch {
      /* not on the PATH */
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * renderPdf(html, options) -> Promise<Buffer>
 * Throws when no browser is available or the print fails. The engine turns a throw into a retry.
 */
export async function renderPdf(html, { chromePath, timeoutMs = 60000, env = process.env } = {}) {
  const chrome = chromePath || findChrome(env);
  if (!chrome) throw new Error('No Chrome or Chromium found. Set CHROME_PATH to the browser binary.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complyrail-pdf-'));
  const input = path.join(dir, 'document.html');
  const output = path.join(dir, 'document.pdf');
  const profile = path.join(dir, 'profile');
  fs.writeFileSync(input, html);
  const args = [
    '--headless=new',
    '--mute-audio',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    `--user-data-dir=${profile}`,
    '--allow-file-access-from-files',
    '--no-pdf-header-footer',
    `--print-to-pdf=${output}`,
  ];
  if (env.COMPLYRAIL_CHROME_NO_SANDBOX === '1') args.push('--no-sandbox');
  args.push(pathToFileURL(input).href);

  const child = spawn(chrome, args, { stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  child.on('error', () => {
    exited = true;
  });
  try {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      await sleep(250);
      let size = -1;
      try {
        size = fs.statSync(output).size;
      } catch {
        size = -1;
      }
      if (size > 0) {
        if (size === last) {
          stable++;
          if (stable >= 2) return fs.readFileSync(output);
        } else {
          stable = 0;
        }
        last = size;
      } else if (exited) {
        throw new Error('Chrome exited without writing the PDF');
      }
    }
    throw new Error(`PDF render timed out after ${timeoutMs} ms`);
  } finally {
    if (!exited) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    // Chrome may still hold its profile for a moment after the kill.
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  }
}
