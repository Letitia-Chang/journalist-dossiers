import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { setup as setupApi } from '../api';
import { applyBrandColor } from '../lib/brand';
import type { SetupStatus } from '../types';

const FALLBACK: SetupStatus = {
  needsAdmin: false,
  needsProfile: false,
  demo: false,
  brand: { appName: 'Press Dossier', brandColor: '#4f46e5', logoUrl: '', companyName: '' },
};

/** Seconds to wait after each failed attempt: gives a sleeping free-tier host about 2 minutes to wake. */
export const RETRY_DELAYS_S = [1, 2, 3, 5, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10];

interface SetupContextValue {
  status: SetupStatus;
  /** False until the first status response arrives, or until we give up waiting for the server. */
  ready: boolean;
  /** Failed attempts so far while the server is unreachable (0 once it answers). */
  attempts: number;
  /** True after every retry failed. */
  gaveUp: boolean;
  /** Re-read the status once (e.g. after saving the company profile). */
  refresh: () => Promise<void>;
  /** Start over after giving up. */
  retry: () => void;
}

const SetupContext = createContext<SetupContextValue | null>(null);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function SetupProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus>(FALLBACK);
  const [ready, setReady] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const run = useRef(0);

  const refresh = useCallback(async () => {
    const res = await setupApi.status();
    setStatus(res.data);
  }, []);

  // Retry with backoff so a cold-starting API (free hosts sleep when idle) wakes up
  // without the visitor having to do anything.
  const load = useCallback(async () => {
    const mine = ++run.current;
    setGaveUp(false);
    setAttempts(0);
    for (let i = 0; i <= RETRY_DELAYS_S.length; i++) {
      try {
        const res = await setupApi.status();
        if (mine !== run.current) return;
        setStatus(res.data);
        setAttempts(0);
        setReady(true);
        return;
      } catch {
        if (mine !== run.current) return;
        if (i === RETRY_DELAYS_S.length) break;
        setAttempts(i + 1);
        await sleep(RETRY_DELAYS_S[i] * 1000);
      }
    }
    if (mine === run.current) {
      setGaveUp(true);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the initial fetch
    load();
    return () => { run.current++; };
  }, [load]);

  // Re-theme and retitle whenever the brand changes.
  useEffect(() => {
    applyBrandColor(status.brand.brandColor);
    document.title = status.brand.appName;
  }, [status.brand.brandColor, status.brand.appName]);

  return (
    <SetupContext.Provider value={{ status, ready, attempts, gaveUp, refresh, retry: load }}>
      {children}
    </SetupContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSetup() {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error('useSetup must be used within a SetupProvider');
  return ctx;
}
