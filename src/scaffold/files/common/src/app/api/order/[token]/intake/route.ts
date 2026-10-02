import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

/* The buyer's form. `answers` is the form as JSON. Each new file arrives as upload:<slot>:<row>.
 * A file sent earlier is kept by the answers holding { upload: <id> } in its field. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let form: FormData;
  let answers: Record<string, unknown>;
  try {
    form = await req.formData();
    answers = JSON.parse(String(form.get('answers') ?? '{}'));
  } catch {
    return NextResponse.json({ error: 'The form did not arrive. Send it again.' }, { status: 400 });
  }
  const files: Array<{ slot: string; item: number; name: string; mimeType: string; bytes: Buffer }> = [];
  for (const [key, value] of form.entries()) {
    const m = /^upload:([A-Za-z0-9_-]+):(\d+)$/.exec(key);
    if (!m || typeof value === 'string' || value.size === 0) continue;
    files.push({ slot: m[1], item: Number(m[2]), name: value.name, mimeType: value.type, bytes: Buffer.from(await value.arrayBuffer()) });
  }
  try {
    const order = await (await getEngine()).submitIntake(token, answers, files);
    return NextResponse.json({ order });
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.name === 'InputError') return NextResponse.json({ error: e.message }, { status: e.status ?? 400 });
    console.error('[intake]', e.message);
    return NextResponse.json({ error: 'Your answers could not be saved. Nothing was lost on your side. Send the form again.' }, { status: 502 });
  }
}
