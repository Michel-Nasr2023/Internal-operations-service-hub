import { useEffect, useState } from 'react';

function partOfDay(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// "Good afternoon, Leo · Monday 28 September" beside the section tabs.
export function Greeting({ firstName }: { firstName: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="greeting">
      <strong>{partOfDay(now.getHours())}, {firstName}</strong>
      <span>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </p>
  );
}
