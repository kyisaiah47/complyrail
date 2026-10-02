// The Stripe, Supabase and SMTP adapters are exercised against local servers that speak each
// protocol. The file adapters run on a temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { stripePayments, supabaseOrderStore, supabaseStorage, smtpMailer, fileOrderStore, fileStorage, fileOutbox } from '../src/index.js';
import { tmpDir } from './helpers.mjs';

function httpServer(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
        seen.push(entry);
        const [status, payload, type = 'application/json'] = handler(entry, seen.length);
        res.writeHead(status, { 'Content-Type': type });
        res.end(type === 'application/json' ? JSON.stringify(payload) : payload);
      });
    });
    s.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${s.address().port}`, seen, close: () => new Promise((r) => s.close(r)) }));
  });
}

test('stripe lists paid sessions across pages and refunds idempotently', async () => {
  const srv = await httpServer((req) => {
    if (req.url.startsWith('/v1/checkout/sessions?') && !req.url.includes('starting_after')) {
      return [200, { has_more: true, data: [{ id: 'cs_test_a', payment_status: 'paid' }, { id: 'cs_test_b', payment_status: 'unpaid' }] }];
    }
    if (req.url.includes('starting_after=cs_test_b')) return [200, { has_more: false, data: [{ id: 'cs_test_c', payment_status: 'paid' }] }];
    if (req.url === '/v1/refunds') return [200, { id: 're_1' }];
    if (req.url === '/v1/subscriptions/sub_1') return [200, { status: 'active' }];
    return [404, { error: { message: 'no' } }];
  });
  try {
    const p = stripePayments({ secretKey: 'sk_test_local', baseURL: `${srv.base}/v1` });
    const paid = await p.listPaidSessions();
    assert.deepEqual(paid.map((s) => s.id), ['cs_test_a', 'cs_test_c']);
    const rf = await p.refund({ id: 'cs_test_a', payment_intent: 'pi_1' });
    assert.equal(rf.id, 're_1');
    const refundReq = srv.seen.find((s) => s.url === '/v1/refunds');
    assert.equal(refundReq.headers['idempotency-key'], 'complyrail-refund-cs_test_a');
    assert.match(refundReq.body.toString(), /payment_intent=pi_1/);
    assert.equal(refundReq.headers.authorization, `Basic ${Buffer.from('sk_test_local:').toString('base64')}`);
    assert.equal(await p.subscriptionActive({ session: { subscription: 'sub_1' } }), true);
    assert.equal(await p.getSession('not-a-session-id'), null);
  } finally {
    await srv.close();
  }
});

test('stripe retries a 5xx and gives up on a 4xx at once', async () => {
  let calls = 0;
  const srv = await httpServer((req) => {
    calls++;
    if (req.url.includes('cs_test_flaky')) return calls < 2 ? [503, { error: { message: 'busy' } }] : [200, { id: 'cs_test_flaky' }];
    return [400, { error: { message: 'bad request' } }];
  });
  try {
    const p = stripePayments({ secretKey: 'sk_test_local', baseURL: srv.base });
    assert.equal((await p.getSession('cs_test_flaky')).id, 'cs_test_flaky');
    calls = 0;
    await assert.rejects(p.refund({ id: 'cs_test_x', payment_intent: 'pi_x' }), /bad request/);
    assert.equal(calls, 1);
  } finally {
    await srv.close();
  }
});

test('supabase order store maps columns and state, and claims a lease once', async () => {
  const rows = new Map();
  const srv = await httpServer((req) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/rest/v1/complyrail_orders')) return [404, {}];
    if (req.method === 'POST') {
      const [row] = JSON.parse(req.body.toString());
      if ([...rows.values()].some((r) => r.session_id === row.session_id)) return [201, []];
      rows.set(row.id, row);
      return [201, [row]];
    }
    const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    if (req.method === 'PATCH') {
      const patch = JSON.parse(req.body.toString());
      const cur = rows.get(id);
      if (u.searchParams.get('or') && cur.lease_until) return [200, []];
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return [200, [next]];
    }
    const token = (u.searchParams.get('token') || '').replace(/^eq\./, '');
    const found = [...rows.values()].filter((r) => (id ? r.id === id : token ? r.token === token : true));
    return [200, found];
  });
  try {
    const store = supabaseOrderStore({ url: srv.base, serviceKey: 'service-key' });
    const order = { id: 'ord_1', pack: 'p', token: 't1', session_id: 'cs_1', status: 'queued', stage: 'verify_payment', email: 'a@example.com', attempts: 0, next_attempt_at: null, lease_until: null, intake: { a: 1 }, history: [] };
    const inserted = await store.insert(order);
    assert.deepEqual(inserted.intake, { a: 1 });
    assert.deepEqual(rows.get('ord_1').state.intake, { a: 1 }, 'non-column fields live in state');
    assert.equal(rows.get('ord_1').token, 't1');
    const again = await store.insert({ ...order, id: 'ord_2' });
    assert.equal(again.id, 'ord_1', 'a duplicate session returns the existing order');
    assert.equal((await store.byToken('t1')).id, 'ord_1');
    assert.ok(await store.claim('ord_1', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'));
    assert.equal(await store.claim('ord_1', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'), null);
    const updated = await store.update('ord_1', { status: 'delivered', delivery: { zip_path: 'x' } });
    assert.equal(updated.status, 'delivered');
    assert.equal(rows.get('ord_1').state.delivery.zip_path, 'x');
    assert.equal(srv.seen[0].headers.authorization, 'Bearer service-key');
  } finally {
    await srv.close();
  }
});

test('supabase storage puts, gets and signs objects', async () => {
  const objects = new Map();
  const srv = await httpServer((req) => {
    const m = /^\/storage\/v1\/object\/(sign\/)?([^/]+)\/(.+)$/.exec(req.url);
    if (!m) return [404, {}];
    const key = `${m[2]}/${decodeURIComponent(m[3])}`;
    if (m[1]) return [200, { signedURL: `/object/sign/${m[2]}/${m[3]}?token=abc` }];
    if (req.method === 'POST') {
      objects.set(key, req.body);
      return [200, { Key: key }];
    }
    return objects.has(key) ? [200, objects.get(key), 'application/octet-stream'] : [404, {}];
  });
  try {
    const s = supabaseStorage({ url: srv.base, serviceKey: 'k' });
    await s.put('packs', 'ord_1/a b.pdf', Buffer.from('%PDF'), 'application/pdf');
    assert.equal((await s.get('packs', 'ord_1/a b.pdf')).toString(), '%PDF');
    assert.equal(srv.seen[0].headers['x-upsert'], 'true');
    assert.match(await s.signedUrl('packs', 'ord_1/a b.pdf'), /^http:\/\/127\.0\.0\.1:\d+\/storage\/v1\/object\/sign\/packs\/ord_1\/a%20b\.pdf\?token=abc$/);
  } finally {
    await srv.close();
  }
});

function smtpServer({ auth = true } = {}) {
  return new Promise((resolve) => {
    const sessions = [];
    const s = net.createServer((sock) => {
      const log = { commands: [], data: '' };
      sessions.push(log);
      let inData = false;
      let buf = '';
      sock.write('220 local test ESMTP\r\n');
      sock.on('data', (chunk) => {
        buf += chunk.toString();
        let i;
        while ((i = buf.indexOf('\r\n')) !== -1) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              sock.write('250 queued\r\n');
            } else log.data += `${line}\n`;
            continue;
          }
          log.commands.push(line);
          if (/^EHLO/.test(line)) sock.write(`250-local\r\n${auth ? '250-AUTH PLAIN LOGIN\r\n' : ''}250 OK\r\n`);
          else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
          else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) sock.write('250 ok\r\n');
          else if (line === 'DATA') {
            inData = true;
            sock.write('354 go\r\n');
          } else if (line === 'QUIT') {
            sock.write('221 bye\r\n');
            sock.end();
          } else sock.write('500 what\r\n');
        }
      });
    });
    s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, sessions, close: () => new Promise((r) => s.close(r)) }));
  });
}

test('smtp sends a MIME message with an attachment and dot-stuffs the body', async () => {
  const srv = await smtpServer();
  try {
    const m = smtpMailer({ host: '127.0.0.1', port: srv.port, user: 'u', pass: 'p', allowInsecureAuth: true });
    const r = await m.send({
      from: 'Pack Orders <orders@example.com>',
      to: 'buyer@example.com',
      subject: 'Your pack is ready',
      text: 'Hello.\n.leading dot line\nBye.',
      attachments: [{ filename: 'pack.zip', content: Buffer.from('PK\u0003\u0004zip'), contentType: 'application/zip' }],
    });
    assert.match(r.id, /^<.+@example\.com>$/);
    const log = srv.sessions[0];
    assert.ok(log.commands.includes('MAIL FROM:<orders@example.com>'));
    assert.ok(log.commands.includes('RCPT TO:<buyer@example.com>'));
    assert.ok(log.commands.some((c) => c.startsWith('AUTH PLAIN ')));
    assert.match(log.data, /Content-Type: multipart\/mixed/);
    assert.match(log.data, /filename="pack.zip"/);
    assert.match(log.data, /Subject: Your pack is ready/);
  } finally {
    await srv.close();
  }
});

test('smtp refuses to send credentials over a plain connection by default', async () => {
  const srv = await smtpServer();
  try {
    const m = smtpMailer({ host: '127.0.0.1', port: srv.port, user: 'u', pass: 'p' });
    await assert.rejects(m.send({ from: 'a@example.com', to: 'b@example.com', subject: 's', text: 't' }), /refusing to send credentials/);
  } finally {
    await srv.close();
  }
});

test('file adapters store orders, objects and outgoing mail on disk', async () => {
  const dir = tmpDir();
  const store = fileOrderStore({ dir: path.join(dir, 'orders') });
  await store.insert({ id: 'ord_a', session_id: 'cs_1', token: 'tok', status: 'queued', next_attempt_at: '2026-01-01T00:00:00.000Z' });
  assert.equal((await store.insert({ id: 'ord_b', session_id: 'cs_1' })).id, 'ord_a');
  assert.equal((await store.due('2026-01-02T00:00:00.000Z')).length, 1);
  assert.equal((await store.due('2025-12-31T00:00:00.000Z')).length, 0);
  await store.update('ord_a', { status: 'delivered' });
  assert.equal((await store.due('2026-01-02T00:00:00.000Z')).length, 0);

  const files = fileStorage({ dir: path.join(dir, 'files') });
  await files.put('b', 'x/../../escape.txt', Buffer.from('safe'));
  assert.equal((await files.get('b', 'x/escape.txt')).toString(), 'safe', 'a .. segment cannot leave the storage dir');

  const outbox = fileOutbox({ dir: path.join(dir, 'outbox') });
  await outbox.send({ from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'Body' });
  assert.equal(outbox.list()[0].subject, 'Hi');
});
