import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, htmlDocument, makeZip, readZip, renderPdf, findChrome, fillTemplate, renderMail } from '../src/index.js';

test('markdown covers headings, lists, tables, quotes and inline marks, and escapes input', () => {
  const html = markdownToHtml(
    [
      '# Title',
      '',
      'A **bold** and _quiet_ line with `code` and <script>.',
      '',
      '> The determination.',
      '',
      '1. First',
      '   continued',
      '2. Second',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '---',
      '- one',
      '- two',
    ].join('\n'),
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>quiet<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<blockquote><p>The determination\.<\/p><\/blockquote>/);
  assert.match(html, /<ol><li>First continued<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test('a link with a javascript: target renders as text', () => {
  assert.doesNotMatch(markdownToHtml('[x](javascript:alert)'), /href/);
});

test('htmlDocument sets the title and passes HTML bodies through', () => {
  const d = htmlDocument({ title: 'A & B', body: '<p>raw</p>' });
  assert.match(d, /<title>A &amp; B<\/title>/);
  assert.match(d, /<p>raw<\/p>/);
});

test('zip round-trips names and bytes', () => {
  const big = Buffer.alloc(5000, 'a');
  const zip = makeZip([
    { name: 'a.txt', bytes: Buffer.from('hello') },
    { name: 'dir/b.pdf', bytes: big },
  ]);
  const back = readZip(zip);
  assert.deepEqual(back.map((e) => e.name), ['a.txt', 'dir/b.pdf']);
  assert.equal(back[0].bytes.toString(), 'hello');
  assert.ok(back[1].bytes.equals(big));
  assert.ok(zip.length < 1000, 'repetitive content is deflated');
});

test('templates fail on an unresolved placeholder', () => {
  assert.equal(fillTemplate('Hi {{name}}', { name: 'Ana' }), 'Hi Ana');
  assert.throws(() => fillTemplate('Hi {{name}} {{other}}', { name: 'Ana' }), /unresolved fields \{\{other\}\}/);
  const m = renderMail('Subject: Ready for {{name}}\n\nBody for {{name}}.', { name: 'Ana' });
  assert.deepEqual([m.subject, m.text], ['Ready for Ana', 'Body for Ana.\n']);
  assert.throws(() => renderMail('No subject line', {}), /Subject:/);
});

const chrome = findChrome();
const requireChrome = process.env.COMPLYRAIL_REQUIRE_CHROME === '1';

test('renderPdf prints a real PDF through headless Chrome', { skip: !chrome && !requireChrome ? 'no Chrome on this machine; set CHROME_PATH' : false }, async () => {
  assert.ok(chrome, 'COMPLYRAIL_REQUIRE_CHROME=1 is set and no Chrome was found');
  const pdf = await renderPdf(htmlDocument({ title: 'Test', body: '# Readiness\n\nOne paragraph.' }));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});
