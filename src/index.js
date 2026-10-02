// ComplyRail: an open-source compliance agent.
//
// A pack describes one filing product as data plus small functions. The engine runs every paid
// order through the same stages, drafts only grounded text, and never drops a paid order.
export { createEngine, STAGES, STAGE_LABELS, backoffMinutes, InputError } from './engine.js';
export { definePack, validateFields } from './pack.js';
export { done, retry, needsInput, determination, refusal, Retry } from './results.js';
export { checkGrounded, buildHaystack, factLines, numberWords, GROUNDING_INSTRUCTIONS } from './grounding.js';
export { readDocument, extractJson, normaliseRead, schemaPrompt } from './services/read-document.js';
export { draftGrounded, draftPrompt } from './services/draft.js';
export { fillTemplate, renderMail } from './template.js';
export { markdownToHtml, escapeHtml } from './render/markdown.js';
export { htmlDocument, PRINT_CSS } from './render/document.js';
export { renderPdf, findChrome } from './render/pdf.js';
export { makeZip, readZip } from './render/zip.js';
export { gemini, openai, openaiCompatible, anthropic, stub, paced, GEMINI_FLASH_CHAIN } from './providers/index.js';
export { stripePayments } from './adapters/stripe.js';
export { supabaseOrderStore, supabaseStorage, SUPABASE_SCHEMA } from './adapters/supabase.js';
export { fileOrderStore, fileStorage, fileOutbox } from './adapters/file.js';
export { smtpMailer } from './adapters/smtp.js';
export { memoryPayments } from './adapters/memory.js';
