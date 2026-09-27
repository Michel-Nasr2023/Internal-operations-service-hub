interface AttachmentCountProps {
  count?: number;
}

// Small paperclip badge next to a ticket's subject in the tables; hidden when there are no files.
export function AttachmentCount({ count }: AttachmentCountProps) {
  if (!count) return null;
  const label = `${count} attachment${count === 1 ? '' : 's'}`;
  return (
    <span className="attachment-count" title={label} aria-label={label}>
      <span aria-hidden="true">📎</span> {count}
    </span>
  );
}
