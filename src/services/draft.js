// draftGrounded(system, facts, vocabulary): one model draft, checked against the grounding rule.
//
// The model is given a closed list of facts and the engine's grounding instructions. The answer is
// then checked by checkGrounded(). A draft that names one fact the list does not hold is rejected
// whole. The caller counts rejections; the engine falls back after three.
import { checkGrounded, buildHaystack, factLines, GROUNDING_INSTRUCTIONS } from '../grounding.js';

export function draftPrompt(facts) {
  const lines = factLines(facts);
  return `Facts, and only these facts:\n${lines.map((l) => `- ${l}`).join('\n')}\n\nWrite the text now.`;
}

/**
 * -> { ok: true, text, model }
 *  | { ok: false, reason: 'ungrounded', kind, token, text, model }
 *  | { ok: false, reason: 'call_failed', error, transient }
 */
export async function draftGrounded({ provider, system, facts, vocabulary = [], maxTokens = 700, temperature }) {
  const res = await provider.complete({
    purpose: 'draft',
    system: `${system ? `${system.trim()}\n\n` : ''}${GROUNDING_INSTRUCTIONS}`,
    prompt: draftPrompt(facts),
    maxTokens,
    temperature,
    facts,
  });
  if (!res.ok) return { ok: false, reason: 'call_failed', error: res.reason, transient: res.transient !== false };
  const text = String(res.text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const check = checkGrounded(text, buildHaystack([factLines(facts), facts], vocabulary));
  if (!check.ok) return { ok: false, reason: 'ungrounded', kind: check.kind, token: check.token, text, model: res.model };
  return { ok: true, text: check.text, model: res.model };
}
