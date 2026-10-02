# __APP_NAME__

This app runs paid orders through the ComplyRail engine.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev        # the site, on http://localhost:3000
npm run worker     # the order worker, in a second terminal
```

Without a Stripe key, the start button opens a development order and takes no payment.
Without Supabase settings, orders and files are kept in `.complyrail/`.
Without an SMTP host, email is written to `.complyrail/outbox/`.
PDFs need Chrome or Chromium. Set `CHROME_PATH` when the browser is not on the PATH.

## Where things are

- `pack/index.mjs` is the product: the form, the document schema, the rules, the summary and the templates.
- `complyrail.config.mjs` picks the model, the payments, the order store, the file store and the mailer.
- `scripts/worker.mjs` advances every due order every two minutes.
- `src/app/order/[token]/page.tsx` is the buyer's order page.
- `src/app/api/` holds checkout, the form submit, the order status and the download.

Read the ComplyRail README for every pack field: https://github.com/kyisaiah47/complyrail
