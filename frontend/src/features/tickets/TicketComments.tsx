import { FormEvent, useEffect, useState } from 'react';
import { addTicketComment, getTicketComments, Ticket, TicketComment } from '../../api/tickets';

const ROLE_LABELS: Record<string, string> = {
  helpdesk: 'Helpdesk',
  administrator: 'Admin',
};

interface TicketCommentsProps {
  ticket: Ticket;
}

// Comment thread shared by the requester, Helpdesk and assignee review panels.
export function TicketComments({ ticket }: TicketCommentsProps) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const isClosed = ticket.status === 'Resolved' || ticket.status === 'Rejected';

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);

    getTicketComments(ticket.id)
      .then((loaded) => isCurrent && setComments(loaded))
      .catch((loadError) => isCurrent && setError(loadError instanceof Error ? loadError.message : 'Comments could not be loaded.'))
      .finally(() => isCurrent && setIsLoading(false));

    return () => {
      isCurrent = false;
    };
  }, [ticket.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setError('');
    setIsPosting(true);
    try {
      const comment = await addTicketComment(ticket.id, body);
      setComments((current) => [...current, comment]);
      setDraft('');
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'The comment could not be added.');
    } finally {
      setIsPosting(false);
    }
  }

  function authorLabel(comment: TicketComment): string {
    const name = comment.authorName ?? comment.authorId;
    if (comment.authorId === ticket.assigneeId) return `${name} · Assignee`;
    if (comment.authorId === ticket.requesterId) return `${name} · Requester`;
    const role = comment.authorRole ? ROLE_LABELS[comment.authorRole] : undefined;
    return role ? `${name} · ${role}` : name;
  }

  return (
    <section className="ticket-comments" aria-labelledby={`comments-${ticket.id}`}>
      <p className="eyebrow" id={`comments-${ticket.id}`}>COMMENTS{comments.length > 0 ? ` (${comments.length})` : ''}</p>

      {isLoading && <p className="empty-state">Loading comments...</p>}
      {!isLoading && comments.length === 0 && <p className="empty-state">No comments yet.</p>}

      {comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className="comment-item">
              <div className="comment-meta">
                <strong>{authorLabel(comment)}</strong>
                <small>{new Date(comment.createdAt).toLocaleString()}</small>
              </div>
              <p>{comment.body}</p>
            </li>
          ))}
        </ol>
      )}

      {error && <p className="message error" role="alert">{error}</p>}

      {isClosed ? (
        <p className="comment-closed">Comments are closed because this ticket is {ticket.status.toLowerCase()}.</p>
      ) : (
        <form className="comment-form" onSubmit={handleSubmit}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Add a progress update or question..."
            aria-label="New comment"
          />
          <button type="submit" className="review-button review-button-active" disabled={isPosting || !draft.trim()}>
            {isPosting ? 'Posting...' : 'Post'}
          </button>
        </form>
      )}
    </section>
  );
}
