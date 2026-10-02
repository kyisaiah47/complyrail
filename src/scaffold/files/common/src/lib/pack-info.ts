import { getEngine } from './engine';
import type { FieldInfo, PackInfo } from './pack-types';

export type { FieldInfo, PackInfo } from './pack-types';

/* Reads the pack the engine runs, so the pages never restate a field, a price or a stage. */
export async function packInfo(): Promise<PackInfo> {
  const engine = await getEngine();
  const pack = engine.pack;
  const name = pack.product?.name || pack.id;
  return {
    id: pack.id,
    name,
    tagline: `${name} makes your documents from your own answers and the documents you upload.`,
    url: pack.product?.url ?? null,
    fields: JSON.parse(JSON.stringify(pack.intake.fields)) as FieldInfo[],
    documents: (pack.documents ?? []).map((d) => ({ slot: d.slot, mime: d.mime })),
    prices: (pack.prices ?? []).map((p) => ({ id: p.id, name: p.name ?? p.id, amount: p.amount ?? 0, mode: p.mode ?? 'payment' })),
    stages: engine.stagesFor(pack.prices?.[0] ?? null),
    narratives: (pack.narratives ?? []).map((n) => n.slot),
    devCheckout: !process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== 'production',
  };
}
