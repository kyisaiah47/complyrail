// Type declarations for ComplyRail.
//
// The Pack interface below is the engine's contract with a pack. Its fields are the ones the
// engine spec fixes, in the same order. PackExtras holds the optional fields from the spec's pack
// table (product, prices, privacy notes, corpus) and the engine's own tuning.

/* ── the pack ─────────────────────────────────────────────────────────────────────────────── */

export interface Pack {
  id: string;                       // "goodstanding"
  matches(session: StripeSession): Tier | null;
  intake: { fields: Field[]; validate(form: Form, context?: IntakeContext): Result<Intake> | Promise<Result<Intake>> };
  documents?: DocSpec[];            // { slot, schema, mime, minConfidence, privacy, validate(read, intake) }
  sources?: Source[];               // { name, fetch(order) -> facts }, throws Retry on outage
  determine(ctx: Facts): Determination | Refusal | NeedsInput | Promise<Determination | Refusal | NeedsInput>;
  narratives?: NarrativeSpec[];     // { slot, system, facts(ctx), vocabulary, fallback }
  render(ctx: Facts): Doc[] | Promise<Doc[]>; // { name, template, format: "pdf" | "csv" | "html" }
  checks?: (files: BuiltFile[]) => Problem[] | Promise<Problem[]>;
  actions?: ActionSpec[];           // { state, run(order) -> done | retry | needsInput }
  monitor?: { everyDays: number; run(order: PublicOrder, services?: Services): ChangeReport | null | Promise<ChangeReport | null> };
  mail: { from: string; intake: Template; delivery: Template; reminderDays: number };
}

export interface PackExtras {
  product?: { name: string; url?: string };
  prices?: Tier[];
  corpus?: unknown;
  css?: string;
  retryCeilingMinutes?: number;
  mail?: Pack['mail'] & { reminder?: Template; needsInput?: Template; refused?: Template };
}

export type PackDefinition = Pack & PackExtras;

export interface Tier {
  id: string;
  name?: string;
  amount?: number;
  mode?: 'payment' | 'subscription';
  /** Monitor a one-time order for this many days after it is created. */
  monitorDays?: number;
}

export interface StripeSession {
  id: string;
  status: string;
  payment_status: string;
  mode?: string;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string>;
  custom_fields?: Array<{ key: string; text?: { value: string | null }; numeric?: { value: string | null }; dropdown?: { value: string | null } }>;
  customer_details?: { email?: string | null; name?: string | null } | null;
  customer_email?: string | null;
  payment_intent?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  invoice?: string | { id: string } | null;
  [key: string]: unknown;
}

export type FieldType = 'text' | 'textarea' | 'email' | 'number' | 'integer' | 'select' | 'checkbox' | 'list' | 'file';

export interface Field {
  name: string;
  label?: string;
  type?: FieldType;
  required?: boolean;
  help?: string;
  max?: number;
  min?: number;
  minValue?: number;
  maxValue?: number;
  message?: string;
  minMessage?: string;
  options?: Array<string | { value: string; label: string }>;
  /** The sub-fields of one row of a list field. */
  of?: Field[];
  /** The document slot a file field uploads into. */
  slot?: string;
}

export type Form = Record<string, unknown>;
export type Intake = Record<string, unknown>;
export interface IntakeContext { uploads: Upload[]; order: PublicOrder }
export type Result<T> = { ok: true; value: T } | { ok: false; errors: Array<{ field?: string; message: string }> };

export interface Upload { slot: string; item: number; name: string; mimeType: string; path: string; sha256: string; bytes: number; at: string }

export type FieldSchemaType = 'string' | 'number' | 'boolean' | 'date' | 'string[]';
export interface ReadSchema {
  about?: string;
  fields: Record<string, FieldSchemaType | { type: FieldSchemaType; about?: string }>;
}

export interface DocumentRead {
  slot: string;
  item: number;
  name: string;
  value: Record<string, unknown>;
  confidence: number;
  model: string;
  at: string;
}

export type Privacy = 'full' | 'none' | ((file: InputFile) => { text: string } | Promise<{ text: string }>);

export interface DocSpec {
  slot: string;
  schema: ReadSchema;
  mime: string[];
  minConfidence: number;
  privacy: Privacy;
  validate(read: DocumentRead, intake: Intake): Array<Problem | string> | Promise<Array<Problem | string>>;
}

export interface Source {
  name: string;
  fetch(order: PublicOrder, services?: Services): unknown | Promise<unknown>;
}

export interface Facts {
  order: PublicOrder;
  tier: Tier;
  session: Record<string, unknown>;
  form: Form | null;
  intake: Intake;
  documents: Record<string, DocumentRead[]>;
  sources: Record<string, unknown>;
  determination: Record<string, unknown> | null;
  drafts: Record<string, string | null>;
  now: Date;
  today: string;
  services: Services;
}

export interface Determination { kind: 'determination'; value: Record<string, unknown> }
export interface Refusal { kind: 'refusal'; reason: string; refund: boolean }
export interface NeedsInput { kind: 'needs_input'; sentence: string; problems: Problem[]; recheckAt: string | Date | null; patch: Record<string, unknown> }
export interface Done { kind: 'done'; patch: Record<string, unknown>; halt: string | null; rescheduleAt: Date | string | null }
export interface RetryResult { kind: 'retry'; reason: string; patch: Record<string, unknown>; waitReason: string | null }
export type StageResult = Done | RetryResult | NeedsInput;

export type NarrativeFallback = 'omit' | { print(ctx: Facts): string | Promise<string> } | { ask: string };

export interface NarrativeSpec {
  slot: string;
  system: string;
  facts(ctx: Facts): string[] | Record<string, unknown> | Promise<string[] | Record<string, unknown>>;
  vocabulary: string[];
  fallback: NarrativeFallback;
}

export interface Doc {
  name: string;
  /** Markdown (or HTML starting with "<") for pdf and html, CSV text for csv. May hold {{placeholders}}. */
  template: string;
  format: 'pdf' | 'csv' | 'html';
  fields?: Record<string, string | number | boolean | null | undefined>;
  title?: string;
  css?: string;
}

export interface BuiltFile { name: string; format: 'pdf' | 'csv' | 'html'; contentType: string; bytes: Buffer }

export interface Problem {
  message: string;
  field?: string;
  kind?: string;
  slot?: string;
  item?: number;
  [key: string]: unknown;
}

export interface ActionSpec {
  state: string;
  run(order: PublicOrder, services?: Services): StageResult | Promise<StageResult>;
}

export interface ChangeReport { subject: string; text: string; attach?: Attachment[] }

export type Template =
  | string
  | { subject: string; text: string; html?: string }
  | ((fields: Record<string, unknown>, order: unknown) => string | { subject: string; text: string; html?: string });

/* ── the services the engine gives a pack ─────────────────────────────────────────────────── */

export interface InputFile { name: string; mimeType: string; bytes: Buffer }
export interface Attachment { filename: string; content: Buffer; contentType?: string }

export type ReadResult =
  | { ok: true; value: Record<string, unknown>; confidence: number; model: string }
  | { ok: false; code: 'no_inference' | 'parse_failed' | 'bad_input' | 'privacy'; error: string; transient: boolean };

export type DraftResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: 'ungrounded'; kind: 'number' | 'date' | 'phrase' | 'empty'; token: string; text: string; model: string }
  | { ok: false; reason: 'call_failed'; error: string; transient: boolean };

export interface Services {
  readDocument(file: InputFile, schema: ReadSchema, options?: { privacy?: Privacy }): Promise<ReadResult>;
  draftGrounded(system: string, facts: string[] | Record<string, unknown>, vocabulary?: string[]): Promise<DraftResult>;
  renderPdf(html: string): Promise<Buffer>;
  upload(bucket: string, path: string, bytes: Buffer, contentType?: string): Promise<string>;
  send(template: Template, fields: Record<string, unknown>, attach?: Attachment[]): Promise<{ id: string }>;
  stripe: { refund(session: Record<string, unknown>): Promise<{ id: string }> };
}

/* ── the adapters ─────────────────────────────────────────────────────────────────────────── */

export interface Provider {
  name: string;
  model: string;
  complete(request: {
    system?: string;
    prompt: string;
    file?: InputFile | null;
    json?: boolean;
    maxTokens?: number;
    temperature?: number;
    purpose?: 'read' | 'draft';
  }): Promise<{ ok: true; text: string; model: string } | { ok: false; reason: string; transient: boolean }>;
}

export interface Payments {
  name: string;
  listPaidSessions(options?: { days?: number }): Promise<StripeSession[]>;
  getSession(id: string): Promise<StripeSession | null>;
  refund(session: Record<string, unknown>): Promise<{ id: string }>;
  subscriptionActive(order: Record<string, unknown>): Promise<boolean>;
}

export interface OrderStore {
  name: string;
  insert(order: Order): Promise<Order>;
  get(id: string): Promise<Order | null>;
  bySession(sessionId: string): Promise<Order | null>;
  byToken(token: string): Promise<Order | null>;
  update(id: string, patch: Partial<Order>): Promise<Order>;
  claim(id: string, untilIso: string, nowIso: string): Promise<Order | null>;
  due(nowIso: string, limit?: number): Promise<Order[]>;
  list(limit?: number): Promise<Order[]>;
}

export interface FileStore {
  name: string;
  put(bucket: string, path: string, bytes: Buffer, contentType?: string): Promise<string>;
  get(bucket: string, path: string): Promise<Buffer>;
  signedUrl(bucket: string, path: string, expiresIn?: number): Promise<string>;
}

export interface Mailer {
  name: string;
  send(message: { from: string; to: string | string[]; subject: string; text: string; html?: string | null; replyTo?: string; attachments?: Attachment[] }): Promise<{ id: string }>;
}

export type OrderStatus = 'queued' | 'retrying' | 'awaiting_intake' | 'needs_input' | 'delivered' | 'monitoring' | 'refused';
export type StageName =
  | 'verify_payment' | 'request_intake' | 'validate_intake' | 'read_documents' | 'fetch_sources'
  | 'determine' | 'draft' | 'render' | 'deliver' | 'act' | 'monitor';

export interface Order {
  id: string;
  pack: string;
  token: string;
  session_id: string;
  status: OrderStatus;
  stage: StageName | 'complete';
  email: string | null;
  attempts: number;
  next_attempt_at: string | null;
  lease_until: string | null;
  [key: string]: unknown;
}

export interface PublicOrder {
  id: string;
  token: string;
  pack: string;
  tier: { id: string; name: string; mode: string } | null;
  email: string | null;
  customer_name: string | null;
  status: OrderStatus;
  stage: StageName | 'complete';
  stages: Array<{ id: StageName; label: string; state: 'done' | 'current' | 'waiting' | 'todo' }>;
  form: Form | null;
  intake: Intake | null;
  uploads: Array<{ slot: string; item: number; name: string; id: string }>;
  problems: Problem[];
  wait_reason: string | null;
  next_attempt_at: string | null;
  determination: Record<string, unknown> | null;
  summary: string | null;
  refusal: string | null;
  files: Array<{ name: string; format: string; bytes: number }>;
  has_download: boolean;
  delivered_at: string | null;
  created_at: string;
  session_fields: Record<string, unknown>;
}

/* ── the engine ───────────────────────────────────────────────────────────────────────────── */

export interface EngineOptions {
  pack: PackDefinition;
  provider: Provider;
  payments: Payments;
  store: OrderStore;
  storage: FileStore;
  mailer: Mailer;
  siteUrl?: string;
  bucket?: string;
  modelIntervalMs?: number;
  retryCeilingMinutes?: number;
  renderPdf?: (html: string) => Promise<Buffer>;
  now?: () => Date;
  log?: ((event: { order: string; stage: string; result: string; note?: string }) => void) | false;
  leaseMinutes?: number;
  attachLimitBytes?: number;
  uploadLimitBytes?: number;
}

export interface Engine {
  pack: PackDefinition;
  services: Services;
  stages: StageName[];
  stagesFor(tier?: Tier | null): Array<{ id: StageName; label: string }>;
  syncPayments(options?: { days?: number }): Promise<Order[]>;
  openOrder(sessionId: string): Promise<PublicOrder | null>;
  acceptSession(session: StripeSession): Promise<PublicOrder | null>;
  submitIntake(token: string, form: Form, files?: Array<{ slot: string; item?: number; name: string; mimeType: string; bytes: Buffer }>): Promise<PublicOrder>;
  runOrder(id: string): Promise<Order | null>;
  tick(options?: { limit?: number }): Promise<PublicOrder[]>;
  view(token: string): Promise<PublicOrder | null>;
  download(token: string, expiresIn?: number): Promise<string | null>;
  publicOrder(order: Order): PublicOrder;
}

export function createEngine(options: EngineOptions): Engine;
export const STAGES: StageName[];
export const STAGE_LABELS: Record<StageName, string>;
export function backoffMinutes(attempts: number, ceiling?: number): number;
export class InputError extends Error { status: number }
export class Retry extends Error {}

export function definePack<T extends PackDefinition>(pack: T): T;
export function validateFields(fields: Field[], form: Form, context?: { uploads?: Upload[] }): Result<Intake>;

export function done(patch?: Record<string, unknown>, options?: { halt?: string; rescheduleAt?: Date | string }): Done;
export function retry(reason: string, patch?: Record<string, unknown>, options?: { waitReason?: string }): RetryResult;
export function needsInput(sentence: string, options?: { problems?: Array<Problem | string>; recheckAt?: Date | string | null; patch?: Record<string, unknown> }): NeedsInput;
export function determination(value: Record<string, unknown>): Determination;
export function refusal(reason: string, options?: { refund?: boolean }): Refusal;

export function checkGrounded(draft: string, facts: unknown, vocabulary?: string[]): { ok: true; text: string } | { ok: false; kind: 'number' | 'date' | 'phrase' | 'empty'; token: string };
export function buildHaystack(facts: unknown, vocabulary?: string[]): { text: string; numbers: Set<string> };
export function factLines(facts: unknown): string[];
export const GROUNDING_INSTRUCTIONS: string;

export function readDocument(options: { provider: Provider; file: InputFile; schema: ReadSchema; privacy?: Privacy; maxBytes?: number }): Promise<ReadResult>;
export function draftGrounded(options: { provider: Provider; system: string; facts: unknown; vocabulary?: string[]; maxTokens?: number; temperature?: number }): Promise<DraftResult>;
export function extractJson(text: string): string;
export function normaliseRead(raw: unknown, schema: ReadSchema): { value: Record<string, unknown>; confidence: number };
export function schemaPrompt(schema: ReadSchema): string;
export function draftPrompt(facts: unknown): string;

export function fillTemplate(template: string, fields?: Record<string, unknown>, name?: string): string;
export function renderMail(template: Template, fields?: Record<string, unknown>, order?: unknown, name?: string): { subject: string; text: string; html: string | null };
export function markdownToHtml(markdown: string): string;
export function escapeHtml(text: string): string;
export function htmlDocument(options: { title?: string; body: string; css?: string }): string;
export const PRINT_CSS: string;
export function renderPdf(html: string, options?: { chromePath?: string; timeoutMs?: number; env?: Record<string, string | undefined> }): Promise<Buffer>;
export function findChrome(env?: Record<string, string | undefined>): string | null;
export function makeZip(entries: Array<{ name: string; bytes: Buffer | Uint8Array | string }>, options?: { date?: Date }): Buffer;
export function readZip(buffer: Buffer): Array<{ name: string; bytes: Buffer }>;

export const GEMINI_FLASH_CHAIN: string[];
export function gemini(options: { apiKey: string | undefined; model?: string; chain?: string[]; baseURL?: string; timeoutMs?: number; fetch?: typeof fetch }): Provider;
export function openai(options: { apiKey: string; model: string; baseURL?: string; organization?: string; timeoutMs?: number; fetch?: typeof fetch }): Provider;
export function openaiCompatible(options: { baseURL: string; model: string; apiKey?: string; headers?: Record<string, string>; jsonMode?: boolean; tokenField?: string; timeoutMs?: number; name?: string; fetch?: typeof fetch }): Provider;
export function anthropic(options: { apiKey: string; model: string; baseURL?: string; version?: string; timeoutMs?: number; fetch?: typeof fetch }): Provider;
export function stub(respond?: (request: Record<string, unknown>) => unknown): Provider & { calls: Array<Record<string, unknown>> };
export function paced(provider: Provider, intervalMs?: number): Provider;

export function stripePayments(options: { secretKey: string; baseURL?: string; fetch?: typeof fetch; tries?: number; timeoutMs?: number }): Payments;
export function memoryPayments(options?: { sessions?: StripeSession[]; subscriptions?: Record<string, string> }): Payments & {
  refunds: Array<{ id: string; session: string; amount: number | null }>;
  addSession(session: StripeSession): StripeSession;
  setSubscription(id: string, status: string): void;
};
export const SUPABASE_SCHEMA: string;
export function supabaseOrderStore(options: { url: string; serviceKey: string; table?: string; fetch?: typeof fetch }): OrderStore;
export function supabaseStorage(options: { url: string; serviceKey: string; fetch?: typeof fetch }): FileStore;
export function fileOrderStore(options: { dir: string }): OrderStore;
export function fileStorage(options: { dir: string }): FileStore & { pathOf(bucket: string, path: string): string };
export function fileOutbox(options: { dir: string }): Mailer & { list(): Array<Record<string, unknown>> };
export function smtpMailer(options: { host: string; port?: number; secure?: boolean; user?: string; pass?: string; name?: string; timeoutMs?: number; rejectUnauthorized?: boolean; allowInsecureAuth?: boolean }): Mailer;
