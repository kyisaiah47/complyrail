// OpenAI's chat completions API, and any server that speaks the same protocol: a hosted gateway,
// vLLM, LM Studio, Ollama's OpenAI endpoint, or Gemini's own OpenAI-compatible endpoint.
import { postJson, errorText, describeFile } from './http.js';

function messagesFor({ system, prompt, file }) {
  const f = describeFile(file);
  const content = [{ type: 'text', text: prompt }];
  if (f) {
    if (f.isText) content.push({ type: 'text', text: `Document (${f.name}):\n${f.text}` });
    else if (f.isImage) content.push({ type: 'image_url', image_url: { url: `data:${f.mimeType};base64,${f.base64}` } });
    else content.push({ type: 'file', file: { filename: f.name, file_data: `data:${f.mimeType};base64,${f.base64}` } });
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: f ? content : prompt });
  return messages;
}

/**
 * openaiCompatible({ baseURL, apiKey, model, headers, jsonMode, tokenField })
 * `baseURL` is the API root that holds /chat/completions, for example http://localhost:11434/v1.
 * `apiKey` may be empty for a local server.
 */
export function openaiCompatible({
  baseURL,
  apiKey = '',
  model,
  headers = {},
  jsonMode = false,
  tokenField = 'max_tokens',
  timeoutMs = 120000,
  name = 'openai-compatible',
  fetch: fetchImpl,
} = {}) {
  if (!baseURL) throw new Error('openaiCompatible needs a baseURL');
  if (!model) throw new Error('openaiCompatible needs a model id');
  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`;

  async function complete({ system, prompt, file, json = false, maxTokens = 800, temperature } = {}) {
    if (!prompt) return { ok: false, reason: 'no prompt provided', transient: false };
    const body = { model, messages: messagesFor({ system, prompt, file }), [tokenField]: maxTokens };
    if (temperature !== undefined) body.temperature = temperature;
    if (json && jsonMode) body.response_format = { type: 'json_object' };
    const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const r = await postJson(url, { headers: { ...auth, ...headers }, body, timeoutMs, fetchImpl });
    if (!r.ok) return { ok: false, reason: `${name} ${errorText(r)}`, transient: r.transient };
    const text = r.json?.choices?.[0]?.message?.content;
    const out = Array.isArray(text) ? text.map((p) => p.text || '').join('') : text;
    if (!out || !String(out).trim()) return { ok: false, reason: `${name}: empty response`, transient: true };
    return { ok: true, text: String(out), model: r.json?.model || model };
  }

  return { name, model, complete };
}

/** OpenAI itself. The key is passed in by the caller; this module never reads the environment. */
export function openai({ apiKey, model, baseURL = 'https://api.openai.com/v1', organization, ...rest } = {}) {
  if (!apiKey) throw new Error('openai needs an apiKey');
  const headers = organization ? { 'OpenAI-Organization': organization } : {};
  return openaiCompatible({ baseURL, apiKey, model, headers, jsonMode: true, tokenField: 'max_completion_tokens', name: 'openai', ...rest });
}
