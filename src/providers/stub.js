// A provider that never touches the network. Tests and dry runs use it.
//
// `respond(request)` receives { purpose, system, prompt, file, json } and returns one of:
//   - a string, used as the model's text,
//   - a plain object, sent back as JSON text,
//   - { ok: false, reason, transient }, to simulate an outage.
// `purpose` is 'read' for readDocument and 'draft' for draftGrounded.

export function stub(respond = () => '') {
  const calls = [];
  async function complete(request = {}) {
    calls.push(request);
    let out;
    try {
      out = await respond(request);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err), transient: true };
    }
    if (out && typeof out === 'object' && out.ok === false) {
      return { ok: false, reason: out.reason || 'stub failure', transient: out.transient !== false };
    }
    const text = typeof out === 'string' ? out : JSON.stringify(out ?? '');
    return { ok: true, text, model: 'stub' };
  }
  return { name: 'stub', model: 'stub', complete, calls };
}
