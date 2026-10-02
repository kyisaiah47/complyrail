'use client';
import type { PublicOrder } from 'complyrail';
import type { PackInfo } from '@/lib/pack-types';
import IntakeForm from '@/components/IntakeForm';
import StageList from '@/components/StageList';
import { useOrder, statusSentence, showsForm } from '@/components/useOrder';
import Disclosure from './Disclosure';

/* THE SIMPLE ORDER PAGE. Where the order is, in one sentence. Then the one thing to do next: fix
 * the answers, wait, or download. The stages and the record sit behind disclosures. */
export default function SimpleOrder({ info, initial }: { info: PackInfo; initial: PublicOrder }) {
  const [order, setOrder] = useOrder(initial);
  const delivered = order.has_download;
  const needsForm = order.status === 'awaiting_intake' || order.status === 'needs_input';
  return (
    <main className="sx sx-order">
      <section className="sx-section-intro">
        <span className="sx-eyebrow">
          {info.name} / ORDER {order.id.slice(-8).toUpperCase()}
        </span>
        <h1 aria-live="polite">{statusSentence(order)}</h1>
      </section>

      {order.problems.length > 1 ? (
        <div className="sx-problems" role="status">
          <h2>Fix these answers</h2>
          <ul>
            {order.problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {delivered ? (
        <div className="sx-card">
          <div className="sx-step">
            <span>YOUR DOCUMENTS</span>
            <span>{order.files.length} FILES</span>
          </div>
          <h2>{order.summary ?? 'Your documents are ready.'}</h2>
          <a className="sx-primary" href={`/api/order/${order.token}/download`}>
            Download your documents
          </a>
          <p className="sx-terms">The same files were sent to {order.email ?? 'your email address'}.</p>
        </div>
      ) : null}

      {needsForm ? (
        <div className="sx-card">
          <div className="sx-step">
            <span>{order.status === 'needs_input' ? 'FIX AND SEND AGAIN' : 'YOUR ANSWERS'}</span>
            <span>SAVED WHEN YOU SEND</span>
          </div>
          <IntakeForm info={info} order={order} variant="simple" onSent={setOrder} />
        </div>
      ) : null}

      <div className="sx-help-list">
        <Disclosure title="See every step of your order" initialOpen={!needsForm && !delivered}>
          <StageList stages={order.stages} variant="simple" />
        </Disclosure>
        {delivered && showsForm(order) ? (
          <Disclosure title="Correct an answer and rebuild your documents">
            <p>Change any answer and send the form again. Your documents are made again from the corrected answers.</p>
            <IntakeForm info={info} order={order} variant="simple" onSent={setOrder} />
          </Disclosure>
        ) : null}
        <Disclosure title="Order details">
          <dl className="sx-dl">
            <div>
              <dt>Paid by</dt>
              <dd>{order.email ?? 'not given'}</dd>
            </div>
            <div>
              <dt>Opened</dt>
              <dd>{order.created_at.slice(0, 10)}</dd>
            </div>
            {order.uploads.length ? (
              <div>
                <dt>Files you sent</dt>
                <dd>{order.uploads.map((u) => u.name).join(', ')}</dd>
              </div>
            ) : null}
          </dl>
        </Disclosure>
      </div>
    </main>
  );
}
