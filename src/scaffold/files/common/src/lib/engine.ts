import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Engine } from 'complyrail';

let pending: Promise<Engine> | null = null;

/* The engine for this process. Node loads complyrail.config.mjs and the pack from disk at run
 * time, outside the bundle, because a pack may read its templates from files beside itself. */
export function getEngine(): Promise<Engine> {
  pending ??= (async () => {
    const url = pathToFileURL(path.join(process.cwd(), 'complyrail.config.mjs')).href;
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
    return (await mod.default()) as Engine;
  })();
  return pending;
}
