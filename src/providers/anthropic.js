// Anthropic's Messages API. PDFs go in as document blocks and images as image blocks.
// The key is passed in by the caller; this module never reads the environment.
import { postJson, errorText, describeFile } from './http.js';

export function anthropic({
  apiKey,
  model,
  baseURL = 'https://api.anthropic.com/v1',
  version = '2023-06-01',
  timeoutMs = 120000,
  fetch: fetchImpl,
} = {}) {
  if (!apiKey) throw new Error('anthropic needs an apiKey');
  if (!model) throw new Error('anthropic needs a model id');
  const url = `${baseURL.replace(/\/$/, '')}/messages`;

  async function complete({ system, prompt, file, maxTokens = 800, temperature } = {}) {
    if (!prompt) return { ok: false, reason: 'no prompt provided', transient: false };
    const f = describeFile(file);
    const content = [];
    if (f) {
      if (f.isText) content.push({ type: 'text', text: `Document (${f.name}):\n${f.text}` });
      else if (f.isImage) content.push({ type: 'image', source: { type: 'base64', media_type: f.mimeType, data: f.base64 } });
      else content.push({ type: 'document', source: { type: 'base64', media_type: f.mimeType, data: f.base64 } });
    }
    content.push({ type: 'text', text: prompt });
    const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;
    const r = await postJson(url, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': version },
      body,
      timeoutMs,
      fetchImpl,
    });
    if (!r.ok) return { ok: false, reason: `anthropic ${errorText(r)}`, transient: r.transient };
    const text = (r.json?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim()) return { ok: false, reason: 'anthropic: empty response', transient: true };
    return { ok: true, text, model: r.json?.model || model };
  }

  return { name: 'anthropic', model, complete };
}
