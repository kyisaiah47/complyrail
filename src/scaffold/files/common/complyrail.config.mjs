// The engine for __APP_NAME__. The site and the worker both load this file.
//
// Every adapter has a local fallback, so the app runs on one machine with no accounts:
//   model     Gemini Flash on GEMINI_API_KEY, or any OpenAI-compatible server
//   payments  Stripe on STRIPE_SECRET_KEY, else none (development checkout only)
//   orders    Supabase on SUPABASE_URL, else JSON files in .complyrail/orders
//   files     Supabase Storage on SUPABASE_URL, else .complyrail/files
//   mail      SMTP on SMTP_HOST, else .eml files in .complyrail/outbox
import path from 'node:path';
import {
  createEngine,
  gemini,
  openaiCompatible,
  stripePayments,
  memoryPayments,
  supabaseOrderStore,
  supabaseStorage,
  fileOrderStore,
  fileStorage,
  smtpMailer,
  fileOutbox,
} from 'complyrail';
import pack from './pack/index.mjs';

export function engineOptions(env = process.env) {
  const data = env.COMPLYRAIL_DATA_DIR || path.join(process.cwd(), '.complyrail');
  const supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY } : null;
  return {
    pack,
    // Bring your own model. Gemini Flash is the default. Set COMPLYRAIL_MODEL_BASE_URL and
    // COMPLYRAIL_MODEL to use any OpenAI-compatible server, a local one included.
    provider: env.COMPLYRAIL_MODEL_BASE_URL
      ? openaiCompatible({ baseURL: env.COMPLYRAIL_MODEL_BASE_URL, apiKey: env.COMPLYRAIL_MODEL_API_KEY, model: env.COMPLYRAIL_MODEL || 'default' })
      : gemini({ apiKey: env.GEMINI_API_KEY }),
    payments: env.STRIPE_SECRET_KEY ? stripePayments({ secretKey: env.STRIPE_SECRET_KEY }) : memoryPayments(),
    store: supabase ? supabaseOrderStore(supabase) : fileOrderStore({ dir: path.join(data, 'orders') }),
    storage: supabase ? supabaseStorage(supabase) : fileStorage({ dir: path.join(data, 'files') }),
    mailer: env.SMTP_HOST
      ? smtpMailer({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS })
      : fileOutbox({ dir: path.join(data, 'outbox') }),
    siteUrl: env.SITE_URL || 'http://localhost:3000',
    bucket: env.COMPLYRAIL_BUCKET || pack.id,
    modelIntervalMs: Number(env.COMPLYRAIL_MODEL_INTERVAL_MS || 0),
  };
}

export default function createAppEngine() {
  return createEngine(engineOptions());
}
