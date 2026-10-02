// One POST helper for every provider. It never throws. It returns the status, the parsed JSON body
// when there is one, and whether the failure is worth trying again.

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export function isTransientStatus(status) {
  return TRANSIENT_STATUS.has(status);
}

export async function postJson(url, { headers = {}, body, timeoutMs = 120000, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, raw, transient: !res.ok && isTransientStatus(res.status) };
  } catch (err) {
    // Network failure, DNS, reset or timeout: always worth another try.
    return { ok: false, status: 0, json: null, raw: '', error: err instanceof Error ? err.message : String(err), transient: true };
  }
}

export function errorText(r) {
  const m = r.json?.error?.message || r.json?.error?.type || r.json?.message || r.error || r.raw || '';
  return `HTTP ${r.status}${m ? `: ${String(m).slice(0, 240)}` : ''}`;
}

/** Split a file into the parts each provider needs. */
export function describeFile(file) {
  if (!file) return null;
  const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes ?? '');
  const mimeType = file.mimeType || 'application/octet-stream';
  const isText = /^text\/|json$|csv$|xml$/.test(mimeType);
  return {
    name: file.name || 'document',
    mimeType,
    isText,
    isImage: mimeType.startsWith('image/'),
    isPdf: mimeType === 'application/pdf',
    base64: bytes.toString('base64'),
    text: isText ? bytes.toString('utf8') : null,
  };
}
