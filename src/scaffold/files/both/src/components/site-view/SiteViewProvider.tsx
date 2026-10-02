'use client';

/* WHICH VIEW THIS VISITOR IS READING: Console or Simple.
 *
 * Console is the clean-visitor default. A valid `?view=simple|console` wins over the saved choice,
 * and a valid explicit choice is saved. Only the preference goes to localStorage. Form drafts,
 * chosen files and the live order live in the in-memory map below, so a view switch remounts the
 * markup without losing them. */
import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import type { PackInfo } from '@/lib/pack-types';
import Welcome from './Welcome';

export type SiteView = 'console' | 'simple';
export const VIEW_KEY = '__APP_SLUG__:view';
export const WELCOME_OFF_KEY = '__APP_SLUG__:welcome-off';
export const WELCOME_EVENT = '__APP_SLUG__:welcome';

interface ViewContext {
  view: SiteView;
  choose: (view: SiteView) => void;
  welcome: () => void;
}

const Context = createContext<ViewContext | null>(null);
const Memory = createContext<Map<string, unknown> | null>(null);

export function useSiteView() {
  return useContext(Context);
}

/** State that survives a view switch and a route change, and never reaches browser storage. */
export function useViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(Memory);
  const [value, setValue] = useState<T>(() => (memory?.has(key) ? (memory.get(key) as T) : initial));
  const update: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(previous) : next;
        memory?.set(key, resolved);
        return resolved;
      });
    },
    [key, memory],
  );
  return [value, update];
}

function readSaved(): SiteView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'simple' ? 'simple' : 'console';
  } catch {
    return 'console';
  }
}

export default function SiteViewProvider({ info, children }: { info: PackInfo; children: ReactNode }) {
  const [view, setView] = useState<SiteView>('console');
  const [memory] = useState(() => new Map<string, unknown>());
  const path = usePathname();

  const choose = useCallback((next: SiteView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* a blocked store never breaks the switch */
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) {
      url.searchParams.set('view', next);
      window.history.replaceState(window.history.state, '', url.href);
    }
  }, []);

  useEffect(() => {
    const explicit = new URLSearchParams(window.location.search).get('view');
    /* The URL and localStorage are unknown during the server render, so the view is read from
     * them after mount. Console renders until then. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (explicit === 'simple' || explicit === 'console') choose(explicit);
    else setView(readSaved());
  }, [path, choose]);

  useEffect(() => {
    document.documentElement.dataset.view = view;
  }, [view]);

  const welcome = useCallback(() => window.dispatchEvent(new Event(WELCOME_EVENT)), []);

  return (
    <Context.Provider value={{ view, choose, welcome }}>
      <Memory.Provider value={memory}>
        {children}
        <Welcome info={info} />
      </Memory.Provider>
    </Context.Provider>
  );
}
