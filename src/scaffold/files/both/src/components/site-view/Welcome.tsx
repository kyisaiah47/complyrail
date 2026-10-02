'use client';

/* START HERE. What the product does, one labelled illustration of an order, and the choice of view.
 * It opens by itself on `/` unless the visitor turned it off or `?welcome=0` is present. Closing or
 * choosing never turns it off; the checkbox does. The footer's Start here reopens it. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MIME_NAMES, type PackInfo } from '@/lib/pack-types';
import { useSiteView, WELCOME_EVENT, WELCOME_OFF_KEY, type SiteView } from './SiteViewProvider';

function readOff(): boolean {
  try {
    return localStorage.getItem(WELCOME_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Welcome({ info }: { info: PackInfo }) {
  const mode = useSiteView();
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [off, setOff] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const docs = [...new Set(info.documents.flatMap((d) => d.mime.map((m) => MIME_NAMES[m] ?? m)))];

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOff(readOff());
    const el = dialog.current;
    if (!el) return;
    setMounted(true);
    if (!el.open) {
      previous.current = document.activeElement as HTMLElement | null;
      el.showModal();
    }
    requestAnimationFrame(() => {
      setVisible(true);
      if (!el.contains(document.activeElement) || document.activeElement === el) el.querySelector<HTMLElement>('.sv-welcome-top > button')?.focus();
    });
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(
      () => {
        dialog.current?.close();
        setMounted(false);
        const back = previous.current;
        if (back && back.isConnected && back !== document.body) back.focus();
        else document.querySelector<HTMLElement>('#start button, .brand')?.focus({ preventScroll: true });
      },
      reduced ? 0 : 220,
    );
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // The dialog opens from browser-only facts (storage and the URL), so it opens after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (path === '/' && !readOff() && q.get('welcome') !== '0') show();
    window.addEventListener(WELCOME_EVENT, show);
    return () => {
      window.removeEventListener(WELCOME_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path, show]);

  function select(view: SiteView) {
    mode?.choose(view);
    close();
  }

  return (
    <dialog
      ref={dialog}
      className="sv-welcome"
      data-visible={visible}
      aria-labelledby="sv-welcome-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      {mounted ? (
        <>
          <header className="sv-welcome-top">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true" />
              {info.name} <small>/ START HERE</small>
            </span>
            <button type="button" aria-label="Close welcome" onClick={close} autoFocus>
              ×
            </button>
          </header>
          <div className="sv-welcome-intro">
            <h2 id="sv-welcome-title">Do you need your documents made from your own answers?</h2>
            <p>
              {info.name} asks you a short set of questions after you pay. {docs.length ? `You upload your documents as ${docs.join(', ')} files. ` : ''}It checks your answers, applies its rules and sends you the finished documents.
            </p>
          </div>
          <section className="sv-illustration" aria-label="Illustration of one order">
            <div>
              <span>ONE ORDER</span>
              <span>ILLUSTRATION</span>
            </div>
            <ol>
              {info.stages.slice(0, 5).map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
              {info.stages.length > 5 ? <li>{info.stages.length - 5} more steps, ending with your download</li> : null}
            </ol>
            <p>This shows the steps every order takes. It is not a real order.</p>
          </section>
          <section className="sv-welcome-choose">
            <div>
              <h3>How would you like to explore?</h3>
              <p>You can switch anytime.</p>
            </div>
            <div className="sv-choices">
              <button type="button" onClick={() => select('console')}>
                <span>
                  ▦ <b>Console</b>
                  <span aria-hidden="true">↗</span>
                </span>
                <strong>See more at once.</strong>
                <span>A compact layout with more data and controls on screen.</span>
              </button>
              <button type="button" onClick={() => select('simple')}>
                <span>
                  ☰ <b>Simple</b>
                  <span aria-hidden="true">↗</span>
                </span>
                <strong>Start with the essentials.</strong>
                <span>A roomier overview with details you can open as you go.</span>
              </button>
            </div>
          </section>
          <footer>
            <label>
              <input
                type="checkbox"
                checked={off}
                onChange={(e) => {
                  const value = e.target.checked;
                  setOff(value);
                  try {
                    if (value) localStorage.setItem(WELCOME_OFF_KEY, '1');
                    else localStorage.removeItem(WELCOME_OFF_KEY);
                  } catch {
                    /* storage blocked: the choice lasts this visit */
                  }
                }}
              />
              Don&rsquo;t open this when I come back
            </label>
          </footer>
        </>
      ) : null}
    </dialog>
  );
}
