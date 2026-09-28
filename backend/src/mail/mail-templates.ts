// Branded transactional emails. Each has a plain-text and an HTML version; the HTML uses inline styles and
// tables because many email clients ignore stylesheets.

const BRAND = 'Internal Operations Service Hub';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

interface Layout {
  preheader: string;
  heading: string;
  intro: string;
  code?: string;
  codeNote?: string;
  buttonLabel: string;
  link: string;
  outro: string;
}

function renderHtml(layout: Layout): string {
  const code = layout.code
    ? `<tr><td style="padding:8px 32px 4px;">
         <div style="font:600 13px Arial,sans-serif;color:#586772;letter-spacing:.06em;text-transform:uppercase;">Your code</div>
         <div style="margin-top:8px;padding:16px;border-radius:10px;background:#f3faf6;border:1px solid #cfe3d8;text-align:center;font:700 34px 'Courier New',monospace;letter-spacing:10px;color:#1e4f48;">${escapeHtml(layout.code)}</div>
         ${layout.codeNote ? `<div style="margin-top:8px;font:13px Arial,sans-serif;color:#68767c;">${escapeHtml(layout.codeNote)}</div>` : ''}
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(layout.heading)}</title></head>
<body style="margin:0;padding:0;background:#e8edf0;">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(layout.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8edf0;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:24px 32px;background:#1e4f48;">
        <span style="display:inline-block;padding:6px 9px;border-radius:6px;background:#ffffff;color:#1e4f48;font:700 12px Arial,sans-serif;letter-spacing:.08em;">OPS</span>
        <span style="margin-left:10px;color:#ffffff;font:700 15px Arial,sans-serif;">${BRAND}</span>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <h1 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#18212b;">${escapeHtml(layout.heading)}</h1>
        <p style="margin:0;font:15px/1.6 Arial,sans-serif;color:#3f5660;">${escapeHtml(layout.intro)}</p>
      </td></tr>
      ${code}
      <tr><td style="padding:20px 32px 8px;">
        <a href="${escapeHtml(layout.link)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#1e8a4c;color:#ffffff;font:700 15px Arial,sans-serif;text-decoration:none;">${escapeHtml(layout.buttonLabel)}</a>
        <p style="margin:14px 0 0;font:12px/1.5 Arial,sans-serif;color:#68767c;">Or paste this link into your browser:<br><a href="${escapeHtml(layout.link)}" style="color:#1e4f48;word-break:break-all;">${escapeHtml(layout.link)}</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px 28px;">
        <p style="margin:0;padding-top:16px;border-top:1px solid #e3e9e6;font:13px/1.6 Arial,sans-serif;color:#68767c;">${escapeHtml(layout.outro)}</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font:12px Arial,sans-serif;color:#68767c;">${BRAND} · This is an automated message, please do not reply.</p>
  </td></tr>
</table>
</body></html>`;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function passwordResetEmail(input: { firstName: string; code: string; link: string; minutes: number }): RenderedEmail {
  const subject = `${input.code} is your password reset code`;
  const text = [
    `Hello ${input.firstName},`,
    '',
    `Your password reset code is: ${input.code}`,
    `Enter it on the reset page within ${input.minutes} minutes. It can only be used once.`,
    '',
    `Or open this link to choose a new password:`,
    input.link,
    '',
    'If you did not ask to reset your password, ignore this email. Your password will not change.',
  ].join('\n');

  const html = renderHtml({
    preheader: `Your code is ${input.code}. It expires in ${input.minutes} minutes.`,
    heading: 'Reset your password',
    intro: `Hello ${input.firstName}, we received a request to reset the password for your account. Enter this code on the reset page:`,
    code: input.code,
    codeNote: `Expires in ${input.minutes} minutes and works once. Never share it with anyone, including Helpdesk.`,
    buttonLabel: 'Choose a new password',
    link: input.link,
    outro: 'If you did not ask to reset your password, you can ignore this email; your password will not change.',
  });

  return { subject, text, html };
}

export function invitationEmail(input: { firstName: string; link: string; hours: number }): RenderedEmail {
  const subject = `Your ${BRAND} account is ready`;
  const text = [
    `Hello ${input.firstName},`,
    '',
    `An account has been created for you on the ${BRAND}.`,
    `Set your password within ${input.hours} hours using this link:`,
    input.link,
    '',
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');

  const html = renderHtml({
    preheader: `Set your password within ${input.hours} hours.`,
    heading: 'Welcome aboard',
    intro: `Hello ${input.firstName}, an account has been created for you. Choose your password to start submitting and tracking requests.`,
    buttonLabel: 'Set my password',
    link: input.link,
    outro: `This link expires in ${input.hours} hours. If you were not expecting this email, you can ignore it.`,
  });

  return { subject, text, html };
}
