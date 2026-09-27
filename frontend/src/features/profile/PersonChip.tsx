import { Avatar } from './Avatar';

interface PersonChipProps {
  userId: string;
  // Full display name; falls back to the user ID when unknown.
  name?: string;
  avatarUpdatedAt?: string | null;
  size?: number;
  bold?: boolean;
}

// A person's photo (or initials) followed by their name, for tables, panels and comments.
export function PersonChip({ userId, name, avatarUpdatedAt, size = 24, bold = false }: PersonChipProps) {
  const label = name ?? userId;
  const [firstName, ...rest] = label.split(' ');
  return (
    <span className="person-chip">
      <Avatar userId={userId} firstName={firstName ?? ''} lastName={rest.join(' ')} avatarUpdatedAt={avatarUpdatedAt} size={size} />
      {bold ? <strong>{label}</strong> : <span>{label}</span>}
    </span>
  );
}
