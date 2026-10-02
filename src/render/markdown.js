// A small Markdown to HTML converter for pack templates. It covers what filing documents use:
// headings, paragraphs, bold, italics, inline code, links, ordered and unordered lists with
// continuation lines, blockquotes, fenced code, tables and horizontal rules. It escapes every
// character of input text first, so a buyer's answer cannot inject markup into a document.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?![\w])/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => (/^(https?:|mailto:|#|\/)/.test(href.replace(/&amp;/g, '&')) ? `<a href="${href}">${text}</a>` : text));
}

const BLOCK_START = /^(#{1,6} |\||```|[-*] |\d+\. |> |---\s*$)/;

export function markdownToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(escapeHtml(lines[i++]));
      i++;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(rows[0]);
      const hasRule = rows[1] && /^\|?\s*:?-{2,}/.test(rows[1].trim().replace(/^\|/, ''));
      const body = rows.slice(hasRule ? 2 : 1).map(cells);
      const headHtml = head.some((h) => h !== '') ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` : '';
      out.push(`<table>${headHtml}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,6}) (.*)/.exec(l);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^---\s*$/.test(l)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^> ?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^> ?/.test(lines[i])) buf.push(inline(lines[i++].replace(/^> ?/, '')));
      out.push(`<blockquote><p>${buf.join('<br>')}</p></blockquote>`);
      continue;
    }
    if (/^[-*] /.test(l) || /^\d+\. /.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items = [];
      while (i < lines.length && (/^[-*] /.test(lines[i]) || /^\d+\. /.test(lines[i]) || /^ {2,}\S/.test(lines[i]) || (lines[i].trim() === '' && i + 1 < lines.length && /^( {2,}\S|[-*] |\d+\. )/.test(lines[i + 1]) && items.length))) {
        const cur = lines[i];
        if (cur.trim() === '') {
          i++;
          continue;
        }
        if (/^ {2,}[-*] /.test(cur)) items[items.length - 1] += `<br>${inline(cur.trim().replace(/^[-*] /, ''))}`;
        else if (/^ {2,}\S/.test(cur)) items[items.length - 1] += ` ${inline(cur.trim())}`;
        else items.push(inline(cur.replace(/^([-*]|\d+\.) /, '')));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((b) => `<li>${b}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (l.trim() === '') {
      i++;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !BLOCK_START.test(lines[i])) buf.push(inline(lines[i++]));
    out.push(`<p>${buf.join(' ')}</p>`);
  }
  return out.join('\n');
}
