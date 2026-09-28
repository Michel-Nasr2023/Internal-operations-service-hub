import { Ticket } from '../../api/tickets';
import { AttachmentCount } from './AttachmentCount';

// Subject in bold with the (AI-clarified) description as a muted, truncated second line.
export function SubjectCell({ ticket, showDescription = true }: { ticket: Ticket; showDescription?: boolean }) {
  const description = ticket.aiResult?.clarifiedDescription ?? ticket.description;
  return (
    <div className="subject-cell">
      <span className="subject-title">
        {ticket.title}
        <AttachmentCount count={ticket.attachmentCount} />
      </span>
      {showDescription && <span className="subject-description" title={description}>{description}</span>}
    </div>
  );
}

// "hardware" -> "Hardware" (issue types are stored in lower case).
export function labelCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Primary value with a muted second line, e.g. team over issue type.
export function StackedCell({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="stacked-cell">
      <span>{primary}</span>
      {secondary && <small>{secondary}</small>}
    </div>
  );
}

// "28 Sep" over "8:14 PM"; the full date and time on hover.
export function DateCell({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <div className="stacked-cell nowrap" title={date.toLocaleString()}>
      <span>{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      <small>{date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small>
    </div>
  );
}
