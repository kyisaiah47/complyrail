import type { PublicOrder } from 'complyrail';

const MARK: Record<string, string> = { done: '✓', current: '•', waiting: '!', todo: '' };
const STATE: Record<string, string> = { done: 'done', current: 'in progress', waiting: 'waiting for you', todo: 'not started' };

/* The stages this order passes through, each with its state. */
export default function StageList({ stages, variant }: { stages: PublicOrder['stages']; variant: 'console' | 'simple' }) {
  const cls = variant === 'console' ? 'cx' : 'sx';
  return (
    <ol className={`${cls}-stages`}>
      {stages.map((s, i) => (
        <li key={s.id} data-state={s.state}>
          <span className={`${cls}-stage-n`} aria-hidden="true">
            {MARK[s.state] || String(i + 1).padStart(2, '0')}
          </span>
          <span>{s.label}</span>
          <span className="visually-hidden">, {STATE[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}
