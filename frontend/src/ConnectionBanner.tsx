import { useEffect, useState } from 'react';
import { API_URL, CONNECTION_EVENT, reportConnection } from './api/http';

type ConnectionState = 'connected' | 'lost' | 'restored';

const FIRST_CHECK_MS = 3000;
const LONGEST_WAIT_MS = 30000;

// Plan B when the server is unreachable: a small notice instead of silent failures. While the connection is
// lost it asks the server's health check again (a little less often each time), and says when it is back.
export function ConnectionBanner() {
  const [state, setState] = useState<ConnectionState>('connected');

  useEffect(() => {
    function onConnectionChange(event: Event) {
      const reachable = (event as CustomEvent<boolean>).detail;
      setState((current) => (!reachable ? 'lost' : current === 'lost' ? 'restored' : current));
    }
    function onBrowserOffline() {
      reportConnection(false);
    }
    window.addEventListener(CONNECTION_EVENT, onConnectionChange);
    window.addEventListener('offline', onBrowserOffline);
    return () => {
      window.removeEventListener(CONNECTION_EVENT, onConnectionChange);
      window.removeEventListener('offline', onBrowserOffline);
    };
  }, []);

  useEffect(() => {
    if (state !== 'lost') return;
    let wait = FIRST_CHECK_MS;
    let timer = 0;
    let stopped = false;

    async function check() {
      try {
        const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          reportConnection(true);
          return;
        }
      } catch {
        // Still unreachable.
      }
      if (stopped) return;
      wait = Math.min(wait * 2, LONGEST_WAIT_MS);
      timer = window.setTimeout(() => void check(), wait);
    }

    function checkNow() {
      window.clearTimeout(timer);
      void check();
    }

    timer = window.setTimeout(() => void check(), wait);
    window.addEventListener('online', checkNow);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', checkNow);
    };
  }, [state]);

  useEffect(() => {
    if (state !== 'restored') return;
    const timer = window.setTimeout(() => setState('connected'), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (state === 'connected') return null;
  return (
    <div className={`connection-banner${state === 'restored' ? ' connection-banner-restored' : ''}`} role="status" aria-live="polite">
      {state === 'lost' ? (
        <>
          <span className="ai-spinner" aria-hidden="true" />
          Can't reach the server. Reconnecting automatically; what you have typed stays on the page.
        </>
      ) : (
        <>✓ Connection restored.</>
      )}
    </div>
  );
}
