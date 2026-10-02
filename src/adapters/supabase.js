// Supabase adapters over PostgREST and Storage, with the service role key.
//
// The order table keeps the fields the engine filters on as columns and everything else in one
// jsonb column named state. SUPABASE_SCHEMA below creates it. Turn row level security on and add no
// policies, so only the service role can read an order.

export const SUPABASE_SCHEMA = `
create table if not exists complyrail_orders (
  id text primary key,
  pack text not null,
  token text not null unique,
  session_id text unique,
  status text not null,
  stage text not null,
  email text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  lease_until timestamptz,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists complyrail_orders_due on complyrail_orders (next_attempt_at) where next_attempt_at is not null;
alter table complyrail_orders enable row level security;
`;

const COLUMNS = ['id', 'pack', 'token', 'session_id', 'status', 'stage', 'email', 'attempts', 'next_attempt_at', 'lease_until', 'created_at', 'updated_at'];

function toRow(order) {
  const row = { state: {} };
  for (const [k, v] of Object.entries(order)) {
    if (COLUMNS.includes(k)) row[k] = v;
    else row.state[k] = v;
  }
  return row;
}

function fromRow(row) {
  if (!row) return null;
  const { state, ...cols } = row;
  return { ...(state || {}), ...cols };
}

function client({ url, serviceKey, fetchImpl }) {
  if (!url || !serviceKey) throw new Error('Supabase adapters need url and serviceKey');
  const base = url.replace(/\/$/, '');
  const headers = (extra = {}) => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra });
  return { base, headers, fetchImpl: fetchImpl || globalThis.fetch };
}

export function supabaseOrderStore({ url, serviceKey, table = 'complyrail_orders', fetch: fetchImpl } = {}) {
  const c = client({ url, serviceKey, fetchImpl });
  const rest = `${c.base}/rest/v1/${table}`;

  async function req(method, query, { body, prefer } = {}) {
    const r = await c.fetchImpl(`${rest}${query}`, {
      method,
      headers: c.headers({ 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`supabase ${method} ${table} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  const one = async (query) => fromRow((await req('GET', `${query}&select=*&limit=1`))?.[0]);

  return {
    name: 'supabase',
    async insert(order) {
      const rows = await req('POST', '?on_conflict=session_id', { body: [toRow(order)], prefer: 'resolution=ignore-duplicates,return=representation' });
      if (rows && rows.length) return fromRow(rows[0]);
      return order.session_id ? one(`?session_id=eq.${encodeURIComponent(order.session_id)}`) : null;
    },
    get: (id) => one(`?id=eq.${encodeURIComponent(id)}`),
    bySession: (sid) => one(`?session_id=eq.${encodeURIComponent(sid)}`),
    byToken: (token) => one(`?token=eq.${encodeURIComponent(token)}`),
    async update(id, patch) {
      const cur = await one(`?id=eq.${encodeURIComponent(id)}`);
      if (!cur) throw new Error(`no order ${id}`);
      const next = { ...cur, ...patch };
      const rows = await req('PATCH', `?id=eq.${encodeURIComponent(id)}`, { body: toRow(next), prefer: 'return=representation' });
      return fromRow(rows?.[0]) ?? next;
    },
    async claim(id, untilIso, nowIso) {
      const q = `?id=eq.${encodeURIComponent(id)}&or=(lease_until.is.null,lease_until.lte.${encodeURIComponent(nowIso)})`;
      const rows = await req('PATCH', q, { body: { lease_until: untilIso }, prefer: 'return=representation' });
      return rows && rows.length ? fromRow(rows[0]) : null;
    },
    async due(nowIso, limit = 50) {
      const now = encodeURIComponent(nowIso);
      const rows = await req('GET', `?status=not.in.(delivered,refused)&next_attempt_at=lte.${now}&or=(lease_until.is.null,lease_until.lte.${now})&order=next_attempt_at.asc&limit=${limit}&select=*`);
      return (rows || []).map(fromRow);
    },
    async list(limit = 100) {
      return ((await req('GET', `?order=created_at.desc&limit=${limit}&select=*`)) || []).map(fromRow);
    },
  };
}

export function supabaseStorage({ url, serviceKey, fetch: fetchImpl } = {}) {
  const c = client({ url, serviceKey, fetchImpl });
  const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  return {
    name: 'supabase',
    async put(bucket, p, bytes, contentType = 'application/octet-stream') {
      const r = await c.fetchImpl(`${c.base}/storage/v1/object/${bucket}/${enc(p)}`, {
        method: 'POST',
        headers: c.headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
        body: bytes,
      });
      if (!r.ok) throw new Error(`storage put ${bucket}/${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
      return p;
    },
    async get(bucket, p) {
      const r = await c.fetchImpl(`${c.base}/storage/v1/object/${bucket}/${enc(p)}`, { headers: c.headers() });
      if (!r.ok) throw new Error(`storage get ${bucket}/${p} -> ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
    async signedUrl(bucket, p, expiresIn = 600) {
      const r = await c.fetchImpl(`${c.base}/storage/v1/object/sign/${bucket}/${enc(p)}`, {
        method: 'POST',
        headers: c.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn }),
      });
      if (!r.ok) throw new Error(`storage sign ${bucket}/${p} -> ${r.status}`);
      const d = await r.json();
      const rel = d.signedURL ?? d.signedUrl;
      if (!rel) throw new Error('storage sign returned no url');
      return `${c.base}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
    },
  };
}
