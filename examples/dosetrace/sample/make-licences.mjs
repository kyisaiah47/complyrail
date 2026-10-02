// Prints the two synthetic wholesaler licences the example uploads.
//
//   CHROME_PATH=<chrome binary> node examples/dosetrace/sample/make-licences.mjs
//
// Both documents are invented and say so on their face. No real licence, licensee or issuer is
// shown. The PDFs are committed, so the example runs without this step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPdf, escapeHtml } from 'complyrail';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LICENCES = [
  {
    file: 'kelmore-drug-supply-licence.pdf',
    holder: 'Kelmore Drug Supply, Inc.',
    number: 'WA-WD-0002218',
    address: '1200 Foundry Way, Kelmore, WA',
    issued: '2025-07-01',
    expires: '2027-06-30',
    atp: true,
  },
  {
    file: 'torvald-pharmaceutical-licence.pdf',
    holder: 'Torvald Pharmaceutical Distribution LLC',
    number: 'WA-WD-0007740',
    address: '88 Quarry Road, Kelmore, WA',
    issued: '2025-04-01',
    expires: '2027-03-31',
    atp: true,
  },
];

function html(l) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sample licence: ${escapeHtml(l.holder)}</title>
<style>
@page { size: Letter; margin: 18mm; }
body { font-family: Georgia, serif; color: #1d1d1d; }
.stamp { border: 2px solid #b3261e; color: #b3261e; font: 700 11pt Helvetica, Arial, sans-serif; padding: 8pt 10pt; margin-bottom: 18pt; }
.frame { border: 3px double #1d1d1d; padding: 26pt 30pt; }
h1 { font-size: 20pt; font-weight: 400; margin: 0 0 4pt; }
h2 { font-size: 12pt; font-weight: 400; margin: 0 0 22pt; color: #555; }
dl { display: grid; grid-template-columns: 150pt 1fr; row-gap: 8pt; font-size: 11.5pt; margin: 0 0 22pt; }
dt { color: #555; }
dd { margin: 0; font-weight: 700; }
p { font-size: 11pt; line-height: 1.5; }
</style></head><body>
<div class="stamp">SAMPLE DOCUMENT. This licence is synthetic. It was made to test ComplyRail and is not a real licence.</div>
<div class="frame">
<h1>Wholesale Drug Distributor Licence</h1>
<h2>Issued by the Board of Pharmacy, State of Washington (sample issuer)</h2>
<dl>
<dt>Licensee</dt><dd>${escapeHtml(l.holder)}</dd>
<dt>Licence number</dt><dd>${escapeHtml(l.number)}</dd>
<dt>Premises</dt><dd>${escapeHtml(l.address)}</dd>
<dt>Issued</dt><dd>${l.issued}</dd>
<dt>Expires</dt><dd>${l.expires}</dd>
<dt>Issuing state</dt><dd>Washington</dd>
</dl>
<p>This licence authorises the licensee to distribute prescription drugs at wholesale from the premises named above.${
    l.atp ? ' The licensee is a licensed wholesale distributor and an authorized trading partner under the Drug Supply Chain Security Act, 21 U.S.C. 360eee.' : ''
  }</p>
<p>This licence must be displayed at the premises and renewed before it expires.</p>
</div>
</body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.join(HERE, 'licences');
  fs.mkdirSync(dir, { recursive: true });
  for (const l of LICENCES) {
    const pdf = await renderPdf(html(l));
    fs.writeFileSync(path.join(dir, l.file), pdf);
    console.log(`${l.file}: ${pdf.length} bytes`);
  }
}
