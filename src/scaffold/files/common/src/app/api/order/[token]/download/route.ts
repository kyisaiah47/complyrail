import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

/* The delivered archive. Hosted storage answers with a short-lived signed link. Local file
 * storage is streamed from disk. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ error: 'No order at this link.' }, { status: 404 });
  const url = await (await getEngine()).download(token);
  if (!url) return NextResponse.json({ error: 'Your documents are not ready yet.' }, { status: 404 });
  if (url.startsWith('file:')) {
    const file = new URL(url);
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${path.basename(file.pathname)}"`, 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.redirect(url, 303);
}
