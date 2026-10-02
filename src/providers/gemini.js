// Gemini over its REST API, with the Flash fallback chain.
//
// The free tier's quota is per model and per day. A 429 from one model moves the call to the next
// model in the chain. So do a 404 (a retired id), a 503 (overloaded), a 500, and a 400 that only one
// model family raises. A 401 or 403 stops the chain, because no other model will accept a bad key.
// When every model is out, complete() returns ok:false with transient:true and the engine backs off.
import { postJson, errorText, describeFile } from './http.js';

export const GEMINI_FLASH_CHAIN = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];

const NEXT_MODEL = new Set([0, 400, 404, 408, 429, 500, 502, 503, 504]);

export function gemini({
  apiKey,
  model = GEMINI_FLASH_CHAIN[0],
  chain = GEMINI_FLASH_CHAIN,
  baseURL = 'https://generativelanguage.googleapis.com/v1beta',
  timeoutMs = 120000,
  fetch: fetchImpl,
} = {}) {
  const base = baseURL.replace(/\/$/, '');
  const at = chain.indexOf(model);
  const models = at === -1 ? [model, ...chain] : chain.slice(at);

  async function complete({ system, prompt, file, json = false, maxTokens = 800, temperature } = {}) {
    if (!apiKey) return { ok: false, reason: 'Gemini has no API key', transient: true };
    if (!prompt) return { ok: false, reason: 'no prompt provided', transient: false };
    const parts = [{ text: prompt }];
    const f = describeFile(file);
    if (f) {
      if (f.isText) parts.push({ text: `\n\nDocument (${f.name}):\n${f.text}` });
      else parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
    }
    const failures = [];
    let transient = false;
    for (const m of models) {
      // 2.5 Flash thinks unless the budget is 0. The 3.x and -latest ids take a thinking level, and
      // their thought tokens count against the output budget, so they get a larger ceiling.
      const is25 = m.startsWith('gemini-2.5');
      const generationConfig = {
        maxOutputTokens: is25 ? maxTokens : Math.max(maxTokens * 4, 2048),
        thinkingConfig: is25 ? { thinkingBudget: 0 } : { thinkingLevel: 'LOW' },
      };
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (json) generationConfig.responseMimeType = 'application/json';
      const body = { contents: [{ role: 'user', parts }], generationConfig };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const r = await postJson(`${base}/models/${encodeURIComponent(m)}:generateContent`, {
        headers: { 'x-goog-api-key': apiKey },
        body,
        timeoutMs,
        fetchImpl,
      });
      if (r.ok) {
        const text = (r.json?.candidates?.[0]?.content?.parts || [])
          .filter((p) => typeof p.text === 'string' && !p.thought)
          .map((p) => p.text)
          .join('');
        if (text.trim()) return { ok: true, text, model: m };
        failures.push(`${m}: empty response`);
        transient = true;
        continue;
      }
      failures.push(`${m}: ${errorText(r)}`);
      if (r.transient || r.status === 0) transient = true;
      if (!NEXT_MODEL.has(r.status)) break;
    }
    return { ok: false, reason: `Gemini failed on every model tried. ${failures.join(' | ')}`, transient };
  }

  return { name: 'gemini', model: models[0], complete };
}
