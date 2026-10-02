// One HTML document per output file, with a print stylesheet the pack can extend.
import { escapeHtml, markdownToHtml } from './markdown.js';

export const PRINT_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
@page { size: Letter; margin: 20mm 18mm 22mm; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1c1a15; }
h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 22pt; line-height: 1.15; margin: 0 0 10pt; padding-bottom: 8pt; border-bottom: 1.2pt solid #1c1a15; }
h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 13.5pt; margin: 18pt 0 6pt; }
h3 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #56524a; margin: 14pt 0 4pt; }
p { margin: 0 0 8pt; }
strong { font-weight: 600; }
em { color: #56524a; }
a { color: inherit; }
blockquote { margin: 10pt 0 14pt; padding: 10pt 14pt; background: #f4f1ea; border-left: 3pt solid #1c1a15; }
blockquote p { margin: 0; }
pre { background: #f4f1ea; padding: 10pt 12pt; font-size: 8.5pt; white-space: pre-wrap; }
code { font-family: Menlo, Consolas, monospace; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0 12pt; font-size: 8.5pt; line-height: 1.45; page-break-inside: avoid; }
th { text-align: left; font-weight: 700; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; color: #56524a; border-bottom: 1pt solid #1c1a15; padding: 0 7pt 5pt 0; }
td { padding: 6pt 7pt 6pt 0; vertical-align: top; border-bottom: 0.6pt solid #d8d3c7; }
ol, ul { padding-left: 15pt; }
li { margin: 0 0 4pt; }
hr { border: 0; height: 10pt; }
h2, h3 { page-break-after: avoid; }
`;

/** A complete HTML page for one document. `body` is Markdown unless it starts with "<". */
export function htmlDocument({ title, body, css = '' }) {
  const content = String(body ?? '').trimStart().startsWith('<') ? String(body) : markdownToHtml(body);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || 'Document')}</title>
<style>${PRINT_CSS}${css}</style>
</head>
<body>
${content}
</body>
</html>
`;
}
