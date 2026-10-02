// One provider interface over every model.
//
//   provider.complete({ system, prompt, file, json, maxTokens, temperature })
//     -> { ok: true, text, model } | { ok: false, reason, transient }
//
// complete() never throws. A missing key, an outage and a malformed answer all come back as
// ok:false, so the engine can treat "no model available" as a retry and never as a crash.
export { gemini, GEMINI_FLASH_CHAIN } from './gemini.js';
export { openai, openaiCompatible } from './openai.js';
export { anthropic } from './anthropic.js';
export { stub } from './stub.js';

/** Wrap a provider so calls are at least `intervalMs` apart. Free tiers count requests per minute. */
export function paced(provider, intervalMs = 0) {
  if (!intervalMs) return provider;
  let next = 0;
  return {
    ...provider,
    async complete(request) {
      const wait = next - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      next = Date.now() + intervalMs;
      return provider.complete(request);
    },
  };
}
