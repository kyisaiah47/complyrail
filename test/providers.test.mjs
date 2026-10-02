// Every provider is exercised against a local HTTP server that records the request and answers
// like the real API. No test reaches a hosted model.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gemini, openai, openaiCompatible, anthropic, readDocument, stub, paced } from '../src/index.js';

function server(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const entry = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
        seen.push(entry);
        const [status, json] = handler(entry, seen.length);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${s.address().port}`, seen, close: () => new Promise((r) => s.close(r)) }));
  });
}

const PDF_FILE = { name: 'licence.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 sample') };

test('gemini sends the system prompt, the file inline and the key in a header', async () => {
  const srv = await server(() => [200, { candidates: [{ content: { parts: [{ text: '{"holder":"A","confidence":0.9}' }] } }] }]);
  try {
    const p = gemini({ apiKey: 'test-key', baseURL: srv.base });
    const r = await p.complete({ system: 'sys', prompt: 'read it', file: PDF_FILE, json: true, maxTokens: 300 });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'gemini-2.5-flash');
    const req = srv.seen[0];
    assert.equal(req.url, '/models/gemini-2.5-flash:generateContent');
    assert.equal(req.headers['x-goog-api-key'], 'test-key');
    assert.equal(req.body.systemInstruction.parts[0].text, 'sys');
    assert.equal(req.body.contents[0].parts[1].inlineData.mimeType, 'application/pdf');
    assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(req.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  } finally {
    await srv.close();
  }
});

test('gemini walks the Flash chain on 429 and reports which model answered', async () => {
  const srv = await server((req, n) => (n < 3 ? [429, { error: { message: 'quota exceeded' } }] : [200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }]));
  try {
    const r = await gemini({ apiKey: 'k', baseURL: srv.base }).complete({ prompt: 'p' });
    assert.equal(r.ok, true);
    assert.deepEqual(srv.seen.map((s) => s.url.split('/')[2].split(':')[0]), ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']);
    assert.equal(r.model, 'gemini-3-flash-preview');
    assert.deepEqual(srv.seen[1].body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  } finally {
    await srv.close();
  }
});

test('gemini stops on a bad key and marks a quota outage transient', async () => {
  const bad = await server(() => [403, { error: { message: 'API key not valid' } }]);
  try {
    const r = await gemini({ apiKey: 'k', baseURL: bad.base }).complete({ prompt: 'p' });
    assert.equal(r.ok, false);
    assert.equal(bad.seen.length, 1);
    assert.equal(r.transient, false);
  } finally {
    await bad.close();
  }
  const busy = await server(() => [429, { error: { message: 'quota' } }]);
  try {
    const r = await gemini({ apiKey: 'k', baseURL: busy.base, chain: ['m1', 'm2'], model: 'm1' }).complete({ prompt: 'p' });
    assert.equal(r.ok, false);
    assert.equal(r.transient, true);
    assert.equal(busy.seen.length, 2);
  } finally {
    await busy.close();
  }
});

test('a missing Gemini key is a transient failure, so the order waits instead of failing', async () => {
  const r = await gemini({ apiKey: undefined }).complete({ prompt: 'p' });
  assert.deepEqual([r.ok, r.transient], [false, true]);
});

test('openaiCompatible posts chat completions to any base URL, with no key for a local server', async () => {
  const srv = await server(() => [200, { model: 'llama3', choices: [{ message: { content: 'hello' } }] }]);
  try {
    const p = openaiCompatible({ baseURL: `${srv.base}/v1`, model: 'llama3' });
    const r = await p.complete({ system: 's', prompt: 'p', file: PDF_FILE, maxTokens: 50 });
    assert.deepEqual([r.ok, r.text, r.model], [true, 'hello', 'llama3']);
    const req = srv.seen[0];
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.body.messages[0].role, 'system');
    assert.equal(req.body.messages[1].content[1].type, 'file');
    assert.equal(req.body.max_tokens, 50);
  } finally {
    await srv.close();
  }
});

test('openai sends a bearer key, JSON mode and max_completion_tokens', async () => {
  const srv = await server(() => [200, { choices: [{ message: { content: '{}' } }] }]);
  try {
    const p = openai({ apiKey: 'test-only', model: 'test-model', baseURL: srv.base });
    await p.complete({ prompt: 'p', json: true, maxTokens: 10, file: { name: 'a.png', mimeType: 'image/png', bytes: Buffer.from('x') } });
    const req = srv.seen[0];
    assert.equal(req.headers.authorization, 'Bearer test-only');
    assert.deepEqual(req.body.response_format, { type: 'json_object' });
    assert.equal(req.body.max_completion_tokens, 10);
    assert.equal(req.body.messages[0].content[1].type, 'image_url');
  } finally {
    await srv.close();
  }
});

test('anthropic sends a document block, the version header and the system prompt', async () => {
  const srv = await server(() => [200, { model: 'test-model', content: [{ type: 'text', text: 'done' }] }]);
  try {
    const p = anthropic({ apiKey: 'test-only', model: 'test-model', baseURL: srv.base });
    const r = await p.complete({ system: 'sys', prompt: 'p', file: PDF_FILE });
    assert.equal(r.text, 'done');
    const req = srv.seen[0];
    assert.equal(req.url, '/messages');
    assert.equal(req.headers['x-api-key'], 'test-only');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    assert.equal(req.body.system, 'sys');
    assert.equal(req.body.messages[0].content[0].type, 'document');
  } finally {
    await srv.close();
  }
});

test('a 5xx from any provider is transient', async () => {
  const srv = await server(() => [503, { error: { message: 'overloaded' } }]);
  try {
    const r = await openaiCompatible({ baseURL: srv.base, model: 'm' }).complete({ prompt: 'p' });
    assert.deepEqual([r.ok, r.transient], [false, true]);
  } finally {
    await srv.close();
  }
});

test('readDocument coerces the answer to the schema types and strips fences', async () => {
  const provider = stub(() => '```json\n{"holder":" Kelmore Drug Supply, Inc. ","number":12,"expires":"June 30 2027","isATP":"yes","count":"1,200","confidence":3}\n```');
  const r = await readDocument({ provider, file: PDF_FILE, schema: { fields: { holder: 'string', number: 'string', expires: 'date', isATP: 'boolean', count: 'number', missing: 'string' } } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { holder: 'Kelmore Drug Supply, Inc.', number: '12', expires: null, isATP: null, count: 1200, missing: null });
  assert.equal(r.confidence, 1);
});

test('readDocument retries once on unparseable output, then reports parse_failed', async () => {
  let n = 0;
  const provider = stub(() => (++n === 1 ? 'sorry' : '{"holder":"A","confidence":0.8}'));
  const ok = await readDocument({ provider, file: PDF_FILE, schema: { fields: { holder: 'string' } } });
  assert.equal(ok.ok, true);
  const never = await readDocument({ provider: stub(() => 'no json here'), file: PDF_FILE, schema: { fields: { holder: 'string' } } });
  assert.deepEqual([never.ok, never.code], [false, 'parse_failed']);
});

test('readDocument honours privacy: a function sends only what it returns, none sends nothing', async () => {
  const provider = stub((req) => {
    assert.equal(req.file.mimeType, 'text/plain');
    assert.equal(req.file.bytes.toString(), 'Name,Hours');
    return '{"columns":["Name","Hours"],"confidence":1}';
  });
  const r = await readDocument({ provider, file: { name: 'register.csv', mimeType: 'text/csv', bytes: Buffer.from('Name,Hours\nA. Person,40') }, schema: { fields: { columns: 'string[]' } }, privacy: (f) => ({ text: f.bytes.toString().split('\n')[0] }) });
  assert.deepEqual(r.value.columns, ['Name', 'Hours']);
  const none = await readDocument({ provider: stub(() => assert.fail('must not be called')), file: PDF_FILE, schema: { fields: {} }, privacy: 'none' });
  assert.equal(none.code, 'privacy');
});

test('paced spaces calls apart', async () => {
  const p = paced(stub(() => 'x'), 60);
  const t0 = Date.now();
  await p.complete({ prompt: 'a' });
  await p.complete({ prompt: 'b' });
  assert.ok(Date.now() - t0 >= 55);
});
