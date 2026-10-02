// Local filesystem adapters: an order store, a file store and a mail outbox. They need no service,
// so a pack can run end to end on one machine. One JSON file holds each order.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildMessage } from './mime.js';

const TERMINAL = new Set(['delivered', 'refused']);

function safeSegment(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_');
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** fileOrderStore({ dir }) keeps each order in <dir>/<id>.json. */
export function fileOrderStore({ dir }) {
  if (!dir) throw new Error('fileOrderStore needs a dir');
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = (id) => path.join(dir, `${safeSegment(id)}.json`);
  const read = (id) => {
    try {
      return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
    } catch {
      return null;
    }
  };
  const all = () =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);

  return {
    name: 'file',
    async insert(row) {
      const existing = row.session_id ? all().find((o) => o.session_id === row.session_id) : null;
      if (existing) return existing;
      writeAtomic(fileOf(row.id), JSON.stringify(row, null, 2));
      return row;
    },
    async get(id) {
      return read(id);
    },
    async bySession(sessionId) {
      return all().find((o) => o.session_id === sessionId) ?? null;
    },
    async byToken(token) {
      return all().find((o) => o.token === token) ?? null;
    },
    async update(id, patch) {
      const cur = read(id);
      if (!cur) throw new Error(`no order ${id}`);
      const next = { ...cur, ...patch };
      writeAtomic(fileOf(id), JSON.stringify(next, null, 2));
      return next;
    },
    async claim(id, untilIso, nowIso) {
      const cur = read(id);
      if (!cur) return null;
      if (cur.lease_until && cur.lease_until > nowIso) return null;
      const next = { ...cur, lease_until: untilIso };
      writeAtomic(fileOf(id), JSON.stringify(next, null, 2));
      return next;
    },
    async due(nowIso, limit = 50) {
      return all()
        .filter((o) => !TERMINAL.has(o.status) || o.status === 'monitoring')
        .filter((o) => o.next_attempt_at && o.next_attempt_at <= nowIso)
        .filter((o) => !o.lease_until || o.lease_until <= nowIso)
        .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
        .slice(0, limit);
    },
    async list() {
      return all().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
  };
}

/** fileStorage({ dir }) keeps each object at <dir>/<bucket>/<path>. Signed links are file:// URLs. */
export function fileStorage({ dir }) {
  if (!dir) throw new Error('fileStorage needs a dir');
  const where = (bucket, p) => {
    const full = path.resolve(dir, safeSegment(bucket), ...String(p).split('/').filter((s) => s && s !== '..').map(safeSegment));
    if (!full.startsWith(path.resolve(dir))) throw new Error('path escapes the storage dir');
    return full;
  };
  return {
    name: 'file',
    async put(bucket, p, bytes) {
      const full = where(bucket, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, bytes);
      return p;
    },
    async get(bucket, p) {
      return fs.readFileSync(where(bucket, p));
    },
    async signedUrl(bucket, p) {
      return pathToFileURL(where(bucket, p)).href;
    },
    pathOf(bucket, p) {
      return where(bucket, p);
    },
  };
}

/** fileOutbox({ dir }) writes each message as an .eml file and a .json summary instead of sending it. */
export function fileOutbox({ dir }) {
  if (!dir) throw new Error('fileOutbox needs a dir');
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return {
    name: 'outbox',
    async send(msg) {
      const { id, raw } = buildMessage(msg);
      const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(++n).padStart(3, '0')}`;
      fs.writeFileSync(path.join(dir, `${base}.eml`), raw);
      fs.writeFileSync(
        path.join(dir, `${base}.json`),
        JSON.stringify({ id, from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, bytes: a.content.length })) }, null, 2),
      );
      return { id };
    },
    list() {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    },
  };
}
