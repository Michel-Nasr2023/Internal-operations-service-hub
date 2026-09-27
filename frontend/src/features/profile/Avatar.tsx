import { useEffect, useState } from 'react';
import { loadAvatarUrl } from '../../api/profile';

// Calm colours for initials, picked from the name so each person always gets the same one.
const PALETTE = ['#1e4f48', '#2f6fd6', '#8a5a1a', '#5b3a9b', '#863d2a', '#245849', '#2a4f83', '#6b4f2a'];

interface AvatarProps {
  userId: string;
  firstName: string;
  lastName: string;
  avatarUpdatedAt?: string | null;
  size?: number;
}

export function Avatar({ userId, firstName, lastName, avatarUpdatedAt, size = 36 }: AvatarProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '?';
  const name = `${firstName} ${lastName}`.trim();
  const colour = PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];

  useEffect(() => {
    let isCurrent = true;
    setPhotoUrl(null);
    if (avatarUpdatedAt) {
      void loadAvatarUrl(userId, avatarUpdatedAt).then((url) => isCurrent && setPhotoUrl(url));
    }
    return () => {
      isCurrent = false;
    };
  }, [userId, avatarUpdatedAt]);

  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: photoUrl ? undefined : colour }} aria-hidden="true">
      {photoUrl ? <img src={photoUrl} alt="" /> : initials}
    </span>
  );
}
