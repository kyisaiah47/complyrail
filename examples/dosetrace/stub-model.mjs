// A stub model for the DoseTrace example. It never touches the network.
//
// For a read it answers with what the two synthetic licences print on their face. For a draft it
// writes a paragraph from the facts it was given and nothing else, the way a well-behaved model
// should. `invent` makes the draft add a number no fact holds, so the grounding check can be seen
// rejecting it.
import { stub } from 'complyrail';
import { LICENCES } from './sample/make-licences.mjs';

const READS = Object.fromEntries(
  LICENCES.map((l) => [
    l.file,
    { wholesalerName: l.holder, licenseNumber: l.number, state: 'Washington', expirationDate: l.expires, isATP: l.atp, confidence: 0.96 },
  ]),
);

export function dosetraceStub({ invent = false } = {}) {
  return stub((req) => {
    if (req.purpose === 'read') {
      const known = READS[req.file?.name];
      return known ?? { wholesalerName: null, licenseNumber: null, state: null, expirationDate: null, isATP: false, confidence: 0.2 };
    }
    const f = req.facts || {};
    const fte = String(f['Licensed FTE across the corporate entity'] || '').split(' ')[0];
    const incomplete = Object.entries(f).find(([k]) => k.startsWith('Wholesalers with an incomplete'))?.[1] || 'none';
    const wholesalers = String(f['Wholesalers on file'] || '');
    const count = wholesalers.split(':')[0];
    const pharmacy = String(f.Pharmacy || '').replace(/ \(d\/b\/a .*\)$/, '');
    const sunset = String(f['Exemption sunset'] || '').split(' (')[0];
    const sentences = [
      `${pharmacy} has ${invent ? '14' : fte} licensed pharmacists and technicians on record, which places you at or under the small-dispenser line.`,
      `You have ${count} wholesalers on file, and each licence you uploaded matched what you typed.`,
      incomplete.startsWith('none')
        ? 'Every verification row is complete.'
        : `${incomplete} still needs a written answer on where your EPCIS data lives and how long it is kept, so ask for it in writing.`,
      `Your exemption ends on ${sunset}, so sign the training attestation and run the tracing dry run before then.`,
    ];
    return sentences.join(' ');
  });
}
