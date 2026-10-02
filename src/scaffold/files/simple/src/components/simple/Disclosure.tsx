'use client';
import { useId, useState, type ReactNode } from 'react';

/* One animated disclosure. The collapsed body is inert, so it leaves the tab order and the tree. */
export default function Disclosure({ title, children, initialOpen = false }: { title: ReactNode; children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  return (
    <div className="sx-disclosure">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="sx-sign" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      <div id={id} className="sx-reveal" data-open={open} inert={!open}>
        <div>
          <div className="sx-answer">{children}</div>
        </div>
      </div>
    </div>
  );
}
