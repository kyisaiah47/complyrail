import { MIME_NAMES, money, sentenceCase, type FieldInfo, type PackInfo } from '@/lib/pack-types';
import StartButton from '@/components/StartButton';

function fieldRows(fields: FieldInfo[], prefix = ''): Array<{ name: string; label: string; type: string; required: boolean }> {
  return fields.flatMap((f) =>
    f.type === 'list'
      ? [{ name: prefix + f.name, label: sentenceCase(f.label || f.name), type: `list of ${f.min ?? 0} or more`, required: (f.min ?? 0) > 0 }, ...fieldRows(f.of ?? [], `${prefix}${f.name}[].`)]
      : [{ name: prefix + f.name, label: sentenceCase(f.label || f.name), type: f.type === 'file' ? `upload (${f.slot})` : f.type || 'text', required: Boolean(f.required) }],
  );
}

/* THE CONSOLE HOME. One full-width bar with the price and the start button, then three columns:
 * the stages, what the buyer sends, and the rules every order runs under. Everything is read from
 * the pack. */
export default function ConsoleHome({ info }: { info: PackInfo }) {
  const tier = info.prices[0];
  const rows = fieldRows(info.fields);
  return (
    <main className="cx" id="start">
      <div className="cx-bar">
        <div>
          <span className="cx-label">ORDER</span>
          <strong>{tier ? `${tier.name}, ${money(tier.amount)}${tier.mode === 'subscription' ? ' a month' : ''}` : info.name}</strong>
        </div>
        <span className="cx-dim">You pay first. The form opens after payment.{info.devCheckout ? ' Development mode: no payment is taken.' : ''}</span>
        <StartButton className="cx-primary">Start an order</StartButton>
      </div>
      <div className="cx-cols" id="how">
        <section className="cx-col" aria-labelledby="cx-stages">
          <h2 id="cx-stages" className="cx-label">
            STAGES
          </h2>
          <ol className="cx-stages">
            {info.stages.map((s, i) => (
              <li key={s.id} data-state="todo">
                <span className="cx-stage-n">{String(i + 1).padStart(2, '0')}</span>
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="cx-col cx-main" aria-labelledby="cx-send">
          <h2 id="cx-send" className="cx-label">
            WHAT YOU SEND
          </h2>
          <table className="cx-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Kind</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.label}</td>
                  <td className="cx-mono">{r.type}</td>
                  <td>{r.required ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {info.documents.length ? (
            <>
              <h2 className="cx-label">DOCUMENTS READ</h2>
              <ul className="cx-list">
                {info.documents.map((d) => (
                  <li key={d.slot}>
                    <span className="cx-mono">{d.slot}</span>: {d.mime.map((m) => MIME_NAMES[m] ?? m).join(', ')}. A model reads each file into typed fields. Plain code checks every field against your answers.
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <aside className="cx-col" aria-labelledby="cx-rules">
          <h2 id="cx-rules" className="cx-label">
            RULES
          </h2>
          <ul className="cx-list">
            <li>Rules written in code decide the result. A model never decides it.</li>
            {info.narratives.length ? <li>Any written summary uses only facts from your order. A draft that adds a number, a date or a name is rejected.</li> : null}
            <li>A failed step on our side tries again on its own, 2, 4 and then 8 minutes apart, up to an hour apart.</li>
            <li>A paid order is never dropped. It waits for you only when an answer of yours needs fixing.</li>
            <li>If the rules cannot make your order, your payment is refunded.</li>
          </ul>
        </aside>
      </div>
    </main>
  );
}
