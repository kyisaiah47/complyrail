'use client';
import type { PublicOrder } from 'complyrail';
import type { PackInfo } from '@/lib/pack-types';
import IntakeForm from '@/components/IntakeForm';
import StageList from '@/components/StageList';
import { useOrder, statusSentence, showsForm } from '@/components/useOrder';

/* THE CONSOLE ORDER PAGE. The status bar, then the stages, the form or the result, and the
 * order record side by side. */
export default function ConsoleOrder({ info, initial }: { info: PackInfo; initial: PublicOrder }) {
  const [order, setOrder] = useOrder(initial);
  const delivered = order.has_download;
  return (
    <main className="cx">
      <div className="cx-bar">
        <div>
          <span className="cx-label">ORDER {order.id.slice(-8).toUpperCase()}</span>
          <strong>{info.name}</strong>
        </div>
        <span className="cx-status" data-status={order.status}>
          {order.status.replace('_', ' ')}
        </span>
        <span className="cx-dim" aria-live="polite">
          {statusSentence(order)}
        </span>
      </div>
      <div className="cx-cols">
        <section className="cx-col" aria-label="Stages">
          <h2 className="cx-label">STAGES</h2>
          <StageList stages={order.stages} variant="console" />
        </section>
        <section className="cx-col cx-main">
          {order.problems.length ? (
            <div className="cx-problems" role="status">
              <h2 className="cx-label">TO FIX</h2>
              <ul>
                {order.problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {delivered ? (
            <div className="cx-result">
              <h2 className="cx-label">DELIVERED</h2>
              <p>{order.summary ?? 'Your documents are ready.'}</p>
              <ul className="cx-files">
                {order.files.map((f) => (
                  <li key={f.name}>
                    <span className="cx-mono">{f.name}</span>
                    <span className="cx-dim">{Math.max(1, Math.round(f.bytes / 1024))} KB</span>
                  </li>
                ))}
              </ul>
              <a className="cx-primary" href={`/api/order/${order.token}/download`}>
                Download all files
              </a>
            </div>
          ) : null}
          {showsForm(order) ? (
            <>
              <h2 className="cx-label">{delivered ? 'CORRECT AN ANSWER AND REBUILD' : 'YOUR ANSWERS'}</h2>
              <IntakeForm info={info} order={order} variant="console" onSent={setOrder} />
            </>
          ) : null}
        </section>
        <aside className="cx-col" aria-label="Order record">
          <h2 className="cx-label">RECORD</h2>
          <dl className="cx-dl">
            <div>
              <dt>Status</dt>
              <dd>{order.status.replace('_', ' ')}</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd className="cx-mono">{order.stage}</dd>
            </div>
            {order.next_attempt_at && order.status === 'retrying' ? (
              <div>
                <dt>Next try</dt>
                <dd className="cx-mono">{order.next_attempt_at.slice(11, 16)} UTC</dd>
              </div>
            ) : null}
            <div>
              <dt>Paid by</dt>
              <dd>{order.email ?? 'not given'}</dd>
            </div>
            <div>
              <dt>Opened</dt>
              <dd className="cx-mono">{order.created_at.slice(0, 16).replace('T', ' ')}</dd>
            </div>
            {order.delivered_at ? (
              <div>
                <dt>Delivered</dt>
                <dd className="cx-mono">{order.delivered_at.slice(0, 16).replace('T', ' ')}</dd>
              </div>
            ) : null}
            {order.uploads.length ? (
              <div>
                <dt>Uploads</dt>
                <dd>{order.uploads.map((u) => u.name).join(', ')}</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </main>
  );
}
