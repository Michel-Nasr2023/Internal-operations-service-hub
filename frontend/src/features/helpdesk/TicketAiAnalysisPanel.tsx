import { useEffect, useState } from 'react';
import { getTicket, retryTicketAnalysis, Ticket } from '../../api/tickets';

const PENDING_POLL_MS = 5000;
// While an automatic retry is scheduled, check less often: it is minutes away.
const RETRY_POLL_MS = 30000;

interface TicketAiAnalysisPanelProps {
  ticket: Ticket;
  // Called with the refreshed ticket when a pending analysis finishes or a retry is requested.
  onTicketUpdated?: (ticket: Ticket) => void;
  // Helpdesk only: show "Retry AI analysis" when the AI failed.
  canRetry?: boolean;
}

export function TicketAiAnalysisPanel({ ticket, onTicketUpdated, canRetry = false }: TicketAiAnalysisPanelProps) {
  const analysis = ticket.aiResult;
  const source = analysis?.source;
  const isPending = source === 'pending';
  const isAi = source === 'ai';
  // 'fallback' is the old rule-based guess stored on earlier tickets; it is treated as a failed analysis.
  const isFailed = source === 'failed' || source === 'fallback';
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const questions = (isAi && analysis?.missingInformation) || [];
  const requester = ticket.requesterName ?? ticket.requesterId;

  const retryAt = source === 'failed' ? analysis?.retryAt : undefined;

  // While the AI is working (or an automatic retry is scheduled), check back so the result appears on its own.
  useEffect(() => {
    if ((!isPending && !retryAt) || !onTicketUpdated) return;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      try {
        const latest = await getTicket(ticket.id);
        if (latest.aiResult?.source !== source || latest.aiResult?.retryAt !== retryAt) onTicketUpdated(latest);
      } catch {
        // Try again on the next tick.
      }
    }, isPending ? PENDING_POLL_MS : RETRY_POLL_MS);
    return () => clearInterval(interval);
  }, [isPending, retryAt, source, ticket.id, onTicketUpdated]);

  async function handleRetry() {
    setRetryError('');
    setIsRetrying(true);
    try {
      onTicketUpdated?.(await retryTicketAnalysis(ticket.id));
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'The AI analysis could not be restarted.');
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <>
      {isPending && (
        <section className="ai-analysis ai-analysis-pending" aria-live="polite">
          <p className="eyebrow">AI INTAKE ANALYSIS</p>
          <p><span className="ai-spinner" aria-hidden="true" /> The AI assistant is analysing this ticket. The result will appear here automatically.</p>
        </section>
      )}

      {isFailed && (
        <section className="ai-analysis ai-analysis-failed" role="status">
          <p className="eyebrow">⚠ AI ANALYSIS FAILED</p>
          <p>
            The AI assistant ran into a problem and could not analyse this ticket.
            {source === 'failed' && analysis?.failureReason ? <> <strong>Reason:</strong> {analysis.failureReason}</> : ' It did not return a usable answer.'}
          </p>
          {retryAt && (
            <p>
              The AI service seems to be temporarily unavailable. The hub will try again automatically at{' '}
              <strong>{new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>.
            </p>
          )}
          <p>Please read the employee's original description below.</p>
          {retryError && <p className="message error" role="alert">{retryError}</p>}
          {canRetry && (
            <button type="button" className="review-button review-button-outline ai-retry-button" onClick={() => void handleRetry()} disabled={isRetrying}>
              {isRetrying ? 'Restarting...' : 'Retry AI analysis'}
            </button>
          )}
        </section>
      )}

      {isAi && analysis?.clarifiedDescription && (
        <section className="ai-analysis" aria-labelledby={`ai-analysis-title-${ticket.id}`}>
          <div className="ai-analysis-header">
            <p className="eyebrow" id={`ai-analysis-title-${ticket.id}`}>AI INTAKE ANALYSIS</p>
            <div className="ai-analysis-tags">
              {analysis.isUnclear && <span className="ai-tag ai-tag-unclear">Unclear request</span>}
              {analysis.issueType && <span className="ai-tag capitalize">{analysis.issueType}</span>}
              {analysis.severity && <span className={`ai-tag ai-tag-${analysis.severity}`}>{analysis.severity} severity</span>}
            </div>
          </div>

          {analysis.summary && <h3>{analysis.summary}</h3>}
          <p>{analysis.clarifiedDescription}</p>

          {analysis.recommendedAction && (
            <div className="ai-analysis-block">
              <p className="eyebrow">RECOMMENDED FIRST STEP</p>
              <p>{analysis.recommendedAction}</p>
            </div>
          )}

          {questions.length > 0 && (
            <div className="ai-analysis-block">
              <p className="eyebrow">ASK THE EMPLOYEE</p>
              <ul>
                {questions.map((question) => <li key={question}>{question}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      <details className="original-submission" open={!isAi}>
        <summary>Original submission from {requester}</summary>
        <p>{ticket.description}</p>
      </details>
    </>
  );
}
