# DoseTrace on ComplyRail

DoseTrace makes a DSCSA readiness binder for one pharmacy.
This folder runs DoseTrace's product logic as a ComplyRail pack.

## Files

- `pack.mjs` holds the whole product: the intake fields, the licence schema, the comparison with the typed answers, the 25-employee rule, the sunset gate, the readiness brief and the nine documents.
- `templates/` holds the nine binder documents and four emails, in Markdown.
- `sample/order.json` holds synthetic buyer answers for Alder Creek Family Pharmacy in Kelmore, WA. Neither exists.
- `sample/session.json` is a synthetic paid Stripe session. It never reaches Stripe.
- `sample/licences/` holds two synthetic wholesaler licences. Each one says on its face that it is not real. `sample/make-licences.mjs` prints them again.
- `stub-model.mjs` answers like a model with no network: it reads the two licences and drafts a paragraph from the facts it is given.
- `run.mjs` runs one order end to end.

## Run it

```bash
CHROME_PATH=/path/to/chrome node examples/dosetrace/run.mjs
CHROME_PATH=/path/to/chrome GEMINI_API_KEY=... node examples/dosetrace/run.mjs --provider gemini
```

The run does four things.
It turns the paid session into an order and writes the form email.
It sends the form with one mistyped licence number, and the order stops with one sentence for the buyer.
It sends the corrected form, and the order runs to a delivered binder of nine PDFs.
It shows the grounding check rejecting a draft that adds a number no fact holds.

Everything it makes lands in `examples/dosetrace/out/`: the orders, the stored files, the outbox, the unzipped binder and `report.json`.

## The rules in this pack

- A pharmacy whose owning entity has 25 or fewer licensed pharmacists and technicians is a small dispenser under the FDA exemption. Above 25, the determination says not exempt.
- After November 27, 2027 the pre-sunset binder is refused and the payment is refunded.
- Each licence must name the wholesaler the buyer typed, show the typed licence number, and be in date.
- A licence from another state, or a letter that does not state authorized trading partner status, may be kept by the buyer. The trading partner log then prints that row as not yet verified.

This example is documentation, not legal advice.
