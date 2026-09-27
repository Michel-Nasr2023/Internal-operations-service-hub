import { useEffect, useState } from 'react';
import { downloadAttachment, formatFileSize, listAttachments, TicketAttachment } from '../../api/attachments';
import { Ticket } from '../../api/tickets';

const STAGE_LABELS: Record<TicketAttachment['stage'], string> = {
  submission: 'From the employee',
  resolution: 'From the assignee (resolution)',
};

interface TicketAttachmentsProps {
  ticket: Ticket;
}

// Files attached to a ticket, grouped by who added them. Hidden when there are none.
export function TicketAttachments({ ticket }: TicketAttachmentsProps) {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setError('');

    listAttachments(ticket.id)
      .then((loaded) => isCurrent && setAttachments(loaded))
      .catch((loadError) => isCurrent && setError(loadError instanceof Error ? loadError.message : 'Attachments could not be loaded.'));

    return () => {
      isCurrent = false;
    };
    // Reload when the status changes, e.g. after the assignee resolves with new files.
  }, [ticket.id, ticket.status]);

  async function handleDownload(attachment: TicketAttachment) {
    setError('');
    setDownloadingId(attachment.id);
    try {
      await downloadAttachment(attachment);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The file could not be downloaded.');
    } finally {
      setDownloadingId(null);
    }
  }

  if (attachments.length === 0 && !error) return null;

  const groups = (['submission', 'resolution'] as const)
    .map((stage) => ({ stage, items: attachments.filter((attachment) => attachment.stage === stage) }))
    .filter((group) => group.items.length > 0);

  return (
    <section className="ticket-attachments" aria-label="Attachments">
      <p className="eyebrow">ATTACHMENTS ({attachments.length})</p>
      {error && <p className="message error" role="alert">{error}</p>}

      {groups.map((group) => (
        <div key={group.stage} className="attachment-group">
          <p className="attachment-group-title">{STAGE_LABELS[group.stage]}</p>
          <ul className="attachment-list">
            {group.items.map((attachment) => (
              <li key={attachment.id}>
                <span aria-hidden="true">📄</span>
                <div>
                  <strong title={attachment.fileName}>{attachment.fileName}</strong>
                  <small>
                    {formatFileSize(attachment.size)} · {attachment.uploaderName ?? attachment.uploaderId} · {new Date(attachment.createdAt).toLocaleString()}
                  </small>
                </div>
                <button
                  type="button"
                  className="review-button review-button-outline"
                  onClick={() => void handleDownload(attachment)}
                  disabled={downloadingId === attachment.id}
                >
                  {downloadingId === attachment.id ? 'Downloading...' : 'Download'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
