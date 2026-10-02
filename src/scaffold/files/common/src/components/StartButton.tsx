'use client';
import { useState } from 'react';

/* Starts checkout. One request per press; the button stays disabled until it answers. */
export default function StartButton({ className, children }: { className: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await fetch('/api/checkout', { method: 'POST' });
            const d = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
            if (!r.ok || !d.url) throw new Error(d.error || 'Checkout could not start. Try again in a minute.');
            window.location.assign(d.url);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Opening checkout' : children}
      </button>
      {error ? (
        <p className="start-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
