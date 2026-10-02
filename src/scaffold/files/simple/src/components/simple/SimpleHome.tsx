import { MIME_NAMES, money, type PackInfo } from '@/lib/pack-types';
import StartButton from '@/components/StartButton';
import Disclosure from './Disclosure';

/* THE SIMPLE HOME. The outcome in one sentence, one primary action, a labelled example of an
 * order's progress, and the details behind disclosures. Every fact is read from the pack. */
export default function SimpleHome({ info }: { info: PackInfo }) {
  const tier = info.prices[0];
  const docs = info.documents.flatMap((d) => d.mime.map((m) => MIME_NAMES[m] ?? m));
  const example = info.stages.map((s, i) => ({ ...s, state: i < Math.ceil(info.stages.length / 2) ? 'done' : i === Math.ceil(info.stages.length / 2) ? 'current' : 'todo' }));
  return (
    <main className="sx">
      <section className="sx-hero">
        <div className="sx-pitch">
          <span className="sx-eyebrow">{info.name}</span>
          <h1>Answer a short form. Get your finished documents back.</h1>
          <p>{info.tagline}</p>
        </div>
        <div className="sx-card" id="start">
          <div className="sx-step">
            <span>01 / START</span>
            <span>{tier?.mode === 'subscription' ? 'BILLED MONTHLY' : 'PAID ONCE'}</span>
          </div>
          <h2>{tier ? `${tier.name}, ${money(tier.amount)}${tier.mode === 'subscription' ? ' a month' : ''}` : info.name}</h2>
          <p className="sx-card-sub">You pay first. Then you fill in the form and upload {docs.length ? `your documents (${[...new Set(docs)].join(', ')})` : 'nothing else'}.</p>
          <StartButton className="sx-primary">Start your order</StartButton>
          <p className="sx-terms">{info.devCheckout ? 'Development mode: no payment is taken.' : 'Payment is handled by Stripe.'}</p>
        </div>
      </section>

      <section className="sx-section" id="how">
        <div className="sx-section-intro">
          <span className="sx-eyebrow">02 / WHAT HAPPENS NEXT</span>
          <h2>Your order moves through these steps on its own.</h2>
        </div>
        <div className="sx-result">
          <div className="sx-step">
            <span>EXAMPLE</span>
            <span>NOT A REAL ORDER</span>
          </div>
          <ol className="sx-stages">
            {example.map((s) => (
              <li key={s.id} data-state={s.state}>
                <span className="sx-dot" aria-hidden="true" />
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
          <p className="sx-note">This shows an order halfway through. Your own order page shows where yours is.</p>
        </div>
        <div className="sx-help-list">
          <Disclosure title="What does a model do with my order?">
            <p>A model reads each document you upload into named fields. Plain code then checks every field against what you typed. Rules written in code decide the result, never the model.</p>
            {info.narratives.length ? <p>A model also writes a short summary from a fixed list of facts about your order. A summary that adds any number, date or name is thrown away and written again.</p> : null}
          </Disclosure>
          <Disclosure title="What if something I typed does not match my document?">
            <p>Your order stops and your order page says exactly what to fix, in one sentence for each problem. You get the same list by email.</p>
          </Disclosure>
          <Disclosure title="What if something fails on your side?">
            <p>The step tries again on its own, 2, 4 and then 8 minutes later, and up to an hour apart after that. Your order is never dropped and you do not need to do anything.</p>
          </Disclosure>
          <Disclosure title="Can I get a refund?">
            <p>If the rules cannot make your order, your payment is refunded in full and your order page says why.</p>
          </Disclosure>
        </div>
      </section>
    </main>
  );
}
