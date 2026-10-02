// The order worker. It turns new paid Checkout sessions into orders and advances every due order.
//
//   npm run worker                          # every 120 seconds
//   COMPLYRAIL_TICK_SECONDS=30 npm run worker
//
// Run it under a process manager in production. Every step it takes is safe to repeat.
import { loadEnvFile } from 'node:process';
import createAppEngine from '../complyrail.config.mjs';

for (const f of ['.env.local', '.env']) {
  try {
    loadEnvFile(f);
  } catch {
    /* no such file */
  }
}

const every = Math.max(10, Number(process.env.COMPLYRAIL_TICK_SECONDS || 120)) * 1000;
const engine = createAppEngine();
console.log(`[worker] ${engine.pack.id}: every ${every / 1000} s`);

for (;;) {
  try {
    const created = await engine.syncPayments();
    const touched = await engine.tick();
    if (created.length || touched.length) console.log(`[worker] ${created.length} new, ${touched.length} advanced`);
  } catch (err) {
    console.error(`[worker] tick failed, retrying next round: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, every));
}
