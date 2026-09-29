import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConnectionBanner } from './ConnectionBanner';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';
import './theme.css';

// Last resort, for errors outside the individual pages (each page has its own boundary inside App).
const appCrashed = (
  <main className="auth-shell">
    <section className="auth-card" role="alert">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h1>The hub could not be displayed</h1>
      <p>Nothing you saved was lost. Reload the page to continue.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload the page</button>
    </section>
  </main>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={appCrashed}>
      <App />
      <ConnectionBanner />
    </ErrorBoundary>
  </StrictMode>,
);
