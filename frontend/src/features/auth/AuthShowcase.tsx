// Branded panel beside the sign-in, sign-up and password pages (hidden on small screens).
const FEATURES = [
  { title: 'Ask for help in seconds', text: 'Describe the problem once; the AI assistant turns it into a clear request for Helpdesk.' },
  { title: 'Always know where it stands', text: 'Follow every step, from review to resolution, with live notifications.' },
  { title: 'Work together', text: 'Comments, attachments and a full history keep everyone on the same page.' },
];

export function AuthShowcase() {
  return (
    <aside className="auth-showcase" aria-hidden="true">
      <div className="auth-showcase-inner">
        <div className="auth-showcase-brand">
          <span className="brand-mark">OPS</span>
          <span>Internal Operations Service Hub</span>
        </div>

        <h2>Everyday requests, handled beautifully.</h2>
        <p className="auth-showcase-lead">One calm place for every IT, facilities and finance request in the company.</p>

        <ShowcaseIllustration />

        <ul className="auth-showcase-features">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <span className="auth-showcase-check">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <strong>{feature.title}</strong>
                <small>{feature.text}</small>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// A small, abstract product illustration: a ticket card, a status chip and a chat bubble.
function ShowcaseIllustration() {
  return (
    <svg className="auth-showcase-art" viewBox="0 0 420 230" role="presentation">
      <defs>
        <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity=".78" />
        </linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#04241f" floodOpacity=".28" />
        </filter>
      </defs>

      <g filter="url(#soft)">
        <rect x="18" y="26" width="270" height="170" rx="18" fill="url(#card)" />
      </g>
      <rect x="42" y="50" width="42" height="42" rx="12" fill="#1e8a4c" opacity=".14" />
      <path d="M55 71l7 7 14-15" stroke="#1e8a4c" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="98" y="54" width="130" height="11" rx="5.5" fill="#18212b" opacity=".82" />
      <rect x="98" y="74" width="90" height="9" rx="4.5" fill="#586772" opacity=".45" />
      <rect x="42" y="112" width="222" height="8" rx="4" fill="#586772" opacity=".22" />
      <rect x="42" y="128" width="190" height="8" rx="4" fill="#586772" opacity=".22" />
      <rect x="42" y="158" width="78" height="22" rx="11" fill="#e1f1e9" />
      <rect x="54" y="166" width="54" height="6" rx="3" fill="#245849" />
      <rect x="130" y="158" width="66" height="22" rx="11" fill="#e3edfb" />
      <rect x="142" y="166" width="42" height="6" rx="3" fill="#2a4f83" />

      <g filter="url(#soft)">
        <rect x="236" y="120" width="164" height="84" rx="18" fill="url(#card)" />
      </g>
      <circle cx="264" cy="148" r="13" fill="#2f6fd6" opacity=".9" />
      <text x="264" y="152.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Arial">LW</text>
      <rect x="285" y="141" width="92" height="8" rx="4" fill="#18212b" opacity=".75" />
      <rect x="285" y="155" width="62" height="7" rx="3.5" fill="#586772" opacity=".4" />
      <rect x="256" y="176" width="124" height="8" rx="4" fill="#586772" opacity=".25" />

      <g filter="url(#soft)">
        <rect x="300" y="18" width="104" height="46" rx="23" fill="#f7c873" />
      </g>
      <circle cx="324" cy="41" r="8" fill="#fff" opacity=".9" />
      <rect x="338" y="36" width="50" height="10" rx="5" fill="#fff" opacity=".85" />
    </svg>
  );
}
