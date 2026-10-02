# ComplyRail

ComplyRail is an open-source compliance agent.
It reads a buyer's documents, applies a rule set, drafts grounded text and renders a filing pack.
You describe one product as a pack.
The engine runs every paid order for that pack, from the Stripe payment to the delivered files.

```bash
npm install complyrail
```

## What makes it different

**Every drafted sentence is grounded.**
The model drafts text only from a closed list of facts that the pack builds for each order.
The engine then checks the draft.
Every digit run, every number word, every written date and every capitalised multi-word phrase must appear in the facts or in the pack's vocabulary.
A number word counts as its value: "Three" needs a 3 in the facts, in digits or in words.
One ungrounded token rejects the whole draft.
After three rejected drafts the engine applies the pack's declared fallback: it omits the text, prints the buyer's own words, or asks the buyer for more detail.
The rule is fixed in the engine, and a pack cannot change it.

**Rules decide the outcome, not a model.**
A pack's `determine()` is a plain function from facts to a result.
The model has two jobs only.
It reads each uploaded document into typed fields, and it drafts text from facts.
Pack code compares every field the model read with what the buyer typed, and a disagreement goes back to the buyer as one sentence.

**A paid order is never dropped.**
Every stage returns `done`, `retry(reason)` or `needsInput(sentence)`.
A retry waits 2, 4, then 8 minutes, doubling up to a ceiling, and it never gives up.
A crash inside a stage is a retry.
A problem only the buyer can fix waits on the order page with one sentence.
A refusal by the rules refunds the payment through Stripe.
No order is delivered short while a retry can still succeed.

**A pack is data plus small functions.**
The pack holds the intake fields, the document schemas, the rules, the narrative slots, the templates and the email copy.
The engine owns payments, intake, retries, document reading, drafting, rendering, delivery, actions and monitoring.

**You bring your own model.**
One provider interface covers Gemini, OpenAI, Anthropic and any OpenAI-compatible base URL, including a local model.
The examples use Gemini Flash.
Tests use a stub provider that never touches the network.

## The stages

Each order moves through these stages. Each stage reads and writes one order row.

| Stage | What it does |
|---|---|
| `verify_payment` | Confirms the Stripe Checkout session is complete, paid and matched by the pack. Creates the order once. |
| `request_intake` | Emails the order page link. Sends one reminder after the pack's reminder delay. |
| `validate_intake` | Runs the pack's intake validator over the buyer's form. |
| `read_documents` | Reads each upload into the pack's schema, then runs the pack's validator against the typed answers. |
| `fetch_sources` | Calls the pack's source connectors. An outage is a retry. |
| `determine` | Runs the pack's rules. A refusal refunds the payment. |
| `draft` | Drafts each narrative slot from its facts and checks it against the grounding rule. |
| `render` | Fills the templates, prints PDFs, CSVs or HTML, and runs the pack's output checks. |
| `deliver` | Zips the files, stores them, and emails the buyer the archive and the order page link. |
| `act` | Optional. Runs the pack's external actions, each with its own state and retry. |
| `monitor` | Optional. Re-checks on a schedule while the subscription is active and emails a change report. |

## The Pack interface

```ts
interface Pack {
  id: string;                       // "goodstanding"
  matches(session: StripeSession): Tier | null;
  intake: { fields: Field[]; validate(form): Result<Intake> };
  documents?: DocSpec[];            // { slot, schema, mime, minConfidence, privacy, validate(read, intake) }
  sources?: Source[];               // { name, fetch(order) -> facts }, throws Retry on outage
  determine(ctx: Facts): Determination | Refusal | NeedsInput;
  narratives?: NarrativeSpec[];     // { slot, system, facts(ctx), vocabulary, fallback }
  render(ctx): Doc[];               // { name, template, format: "pdf" | "csv" | "html" }
  checks?: (files) => Problem[];
  actions?: ActionSpec[];           // { state, run(order) -> done | retry | needsInput }
  monitor?: { everyDays: number; run(order) -> ChangeReport | null };
  mail: { from: string; intake: Template; delivery: Template; reminderDays: number };
}
```

The engine gives every pack these services:

| Service | What it does |
|---|---|
| `readDocument(file, schema)` | One model read of one file into the schema's typed fields, with a confidence. |
| `draftGrounded(system, facts, vocabulary)` | One draft, checked against the grounding rule. |
| `renderPdf(html)` | Prints HTML to PDF with a local headless Chrome or Chromium. |
| `upload(bucket, path, bytes)` | Stores a file through the storage adapter. |
| `send(template, fields, attach)` | Sends one email through the mail adapter. |
| `stripe.refund(session)` | Refunds the payment behind a Checkout session, once. |

Full TypeScript declarations ship in `src/index.d.ts`.
`determine()`, `render()` and the other pack functions may also return a promise.

## A small pack

```js
import { definePack, validateFields, determination, refusal } from 'complyrail';

const FIELDS = [
  { name: 'business', label: 'the business name', required: true },
  { name: 'staff', label: 'the number of staff', type: 'integer', required: true },
  { name: 'licence', label: 'your business licence', type: 'file', slot: 'licence', required: true },
];

export default definePack({
  id: 'smallbiz',
  matches: (s) => (s.metadata?.product === 'smallbiz' ? { id: 'standard', amount: 1900, mode: 'payment' } : null),
  intake: { fields: FIELDS, validate: (form, ctx) => validateFields(FIELDS, form, ctx) },
  documents: [{
    slot: 'licence',
    schema: { fields: { holder: 'string', number: 'string', expires: 'date' } },
    mime: ['application/pdf', 'image/png', 'image/jpeg'],
    minConfidence: 0.7,
    privacy: 'full',
    validate: (read, intake) => (read.value.holder === intake.business ? [] : [`The licence names ${read.value.holder}. Upload the licence for ${intake.business}.`]),
  }],
  determine: (ctx) => (ctx.intake.staff > 100 ? refusal('This product covers businesses with 100 staff or fewer.') : determination({ summary: `${ctx.intake.business} is in scope.` })),
  narratives: [{
    slot: 'summary',
    system: 'Write two plain sentences for the owner.',
    facts: (ctx) => ({ Business: ctx.intake.business, Staff: ctx.intake.staff }),
    vocabulary: [],
    fallback: 'omit',
  }],
  render: (ctx) => [{ name: 'record', format: 'pdf', template: '# {{business}}\n\n{{summary}}', fields: { business: ctx.intake.business, summary: ctx.drafts.summary ?? '' } }],
  mail: {
    from: 'Small Biz Records <orders@example.com>',
    intake: 'Subject: Fill in your form\n\nOpen {{order_url}} and fill in the form.',
    delivery: 'Subject: Your record is ready\n\nYour files are attached. They are also at {{order_url}}.',
    reminderDays: 3,
  },
});
```

Run it with an engine:

```js
import { createEngine, gemini, stripePayments, supabaseOrderStore, supabaseStorage, smtpMailer } from 'complyrail';
import pack from './pack.mjs';

const engine = createEngine({
  pack,
  provider: gemini({ apiKey: process.env.GEMINI_API_KEY }),
  payments: stripePayments({ secretKey: process.env.STRIPE_SECRET_KEY }),
  store: supabaseOrderStore({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY }),
  storage: supabaseStorage({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY }),
  mailer: smtpMailer({ host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }),
  siteUrl: 'https://your-site.example',
});

await engine.syncPayments(); // new paid sessions become orders
await engine.tick();         // every due order moves as far as it can
```

Your site calls three more methods.
`engine.openOrder(sessionId)` runs on the Stripe success redirect.
`engine.submitIntake(token, form, files)` takes the buyer's form.
`engine.view(token)` and `engine.download(token)` serve the order page.

## The DoseTrace example

`examples/dosetrace` is a complete pack built from DoseTrace, a product that makes a DSCSA readiness binder for one pharmacy.
The buyer answers a form about the pharmacy and uploads one licence or authorized trading partner letter per wholesaler.
The model reads each letter.
Pack code compares the holder name and licence number with the typed answers, applies the 25-employee rule and the sunset date, and fills nine document templates.
The model drafts one readiness paragraph from a closed fact list, and the binder ships without it after three rejected drafts.

Every name, number and document in the example is synthetic.
Both licence PDFs in the sample folder are marked on their face as not real.

```bash
CHROME_PATH=/path/to/chrome node examples/dosetrace/run.mjs                    # stub model, no network
CHROME_PATH=/path/to/chrome GEMINI_API_KEY=... node examples/dosetrace/run.mjs --provider gemini
```

On macOS the Chrome binary is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
A stub run prints this:

```text
2. The buyer sends the form with a mistyped licence number.
  read_documents   needs_input  You typed licence number WA-WD-0007741 for Torvald Pharmaceutical ...
3. The buyer corrects the number and keeps both uploaded licences.
  read_documents   done
  determine        done
  draft            done
  render           done
  deliver          done
   determination: Small dispenser under the FDA exemption. 9 licensed pharmacists and technicians
   across one location, at or under the 25-employee threshold.
   9 files in examples/dosetrace/out/.../dosetrace-2026-10-02.zip
4. The grounding check rejects an invented number.
   checkGrounded on the delivered brief plus "You also employ 14 delivery drivers.": rejected, ungrounded number "14"
```

With `--provider gemini`, Gemini Flash reads the two PDF licences and drafts the paragraph.
The output files and a `report.json` land in `examples/dosetrace/out`.

## Adapters

| Concern | Adapters |
|---|---|
| Payments | `stripePayments({ secretKey })`, and `memoryPayments()` for development |
| Order store | `supabaseOrderStore({ url, serviceKey })`, `fileOrderStore({ dir })` |
| File storage | `supabaseStorage({ url, serviceKey })`, `fileStorage({ dir })` |
| Mail | `smtpMailer({ host, port, user, pass })`, `fileOutbox({ dir })` |

The file adapters keep everything on one machine, so a pack runs end to end with no accounts.
`SUPABASE_SCHEMA` holds the SQL for the order table.
Turn on row level security and add no policies, so only the service role reads orders.
An adapter is a plain object, so you can write your own for another database, store or mail service.

## Models

```js
import { gemini, openai, anthropic, openaiCompatible } from 'complyrail';

gemini({ apiKey });                                              // Gemini Flash, with a fallback chain on 429
openai({ apiKey, model });
anthropic({ apiKey, model });
openaiCompatible({ baseURL: 'http://localhost:11434/v1', model: 'llama3.1' }); // a local model
```

`gemini()` walks a chain of Flash models when one answers 429, 404 or 503.
A failed call never throws.
It comes back as `{ ok: false, transient }`, and the engine turns it into a retry.
`modelIntervalMs` on the engine spaces calls apart for a free tier.
A document schema's `privacy` setting controls what reaches the model: the whole file, only the text a function returns, or nothing.

## Scaffold a site

```bash
npx complyrail new-app my-site --app both     # or --app console, or --app simple
cd my-site && npm install && npm run dev      # the site
npm run worker                                # the order worker, in a second terminal
```

`--app console` gives one dense working view: the stages, the form and the order record side by side.
`--app simple` gives one roomy view: the outcome, one primary action, and details behind disclosures.
`--app both` gives both views, a first-visit welcome that explains the product and offers the choice, and footer controls to switch.
The app is a Next.js tree with checkout, the order page, the form, the order status, the download and a worker script.
It runs with no accounts in development: the start button opens an order without a payment, and files and email stay in `.complyrail/`.

## Command line

```bash
complyrail new-app [dir] --app console|simple|both [--name "Product name"]
complyrail tick   --config complyrail.config.mjs    # advance every due order once
complyrail sync   --config complyrail.config.mjs    # turn new paid sessions into orders
complyrail worker --config complyrail.config.mjs --every 120
```

## Limits

The grounding rule checks digit runs, number words from two upward, written dates and capitalised phrases.
It does not check "one" or "a", because both are more often a pronoun or an article than a count.
It does not check ordinals such as "third".
It does not judge whether a grounded sentence is true: "Three of your staff signed" passes when the facts hold 3 staff, whether or not they signed.
PDFs need a local Chrome or Chromium.
The engine processes orders one at a time per worker, and a lease stops two workers from running the same order.

## Development

```bash
npm test                     # node --test, with a stub model and local servers only
node scripts/scrub-gate.mjs  # fails on personal data, private ids, keys and bot-detection bypass code
```

CI runs both on every push.

## License

MIT. Copyright Compound Labs.
ComplyRail is built by [Compound Labs](https://thecompound.tech).
