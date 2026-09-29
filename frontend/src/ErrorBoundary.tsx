import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  // When this changes (e.g. the user switches tab), the error is cleared and the content is shown again.
  resetKey?: unknown;
  // Shown instead of the default message; `null` hides the broken part quietly (e.g. the notification bell).
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Plan B for the interface: if a part of the page crashes while drawing (for example on unexpected data),
// only that part is replaced by a message; the top bar, tabs and the rest of the hub keep working.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Part of the page could not be displayed:', error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <section className="tickets-card error-fallback" role="alert">
        <p className="eyebrow">SOMETHING WENT WRONG</p>
        <h2>This page could not be displayed</h2>
        <p>The rest of the hub still works, and nothing you saved was lost. Try again, or reload the page if the problem continues.</p>
        <div className="error-fallback-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="settings-button settings-button-secondary" onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      </section>
    );
  }
}
