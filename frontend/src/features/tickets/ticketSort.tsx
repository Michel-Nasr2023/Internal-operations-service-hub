import { Ticket } from '../../api/tickets';

export type SortOrder = 'newest' | 'oldest';

// Returns a sorted copy. `dateOf` picks the date to sort by (submission date by default).
export function sortTickets(tickets: Ticket[], order: SortOrder, dateOf: (ticket: Ticket) => string | undefined = (ticket) => ticket.createdAt): Ticket[] {
  const direction = order === 'newest' ? -1 : 1;
  return [...tickets].sort((a, b) => direction * (new Date(dateOf(a) ?? 0).getTime() - new Date(dateOf(b) ?? 0).getTime()));
}

interface SortSelectProps {
  value: SortOrder;
  onChange: (order: SortOrder) => void;
}

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <label>
      Sort
      <select value={value} onChange={(event) => onChange(event.target.value as SortOrder)}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </label>
  );
}
