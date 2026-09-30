// Sends email through Mailjet's web API (HTTPS) instead of SMTP. Used where the host blocks outgoing SMTP
// connections (Railway's trial and Hobby plans do). It has the same two methods MailService uses from
// Nodemailer, and its errors carry the same codes, so retries treat both the same way:
// ECONNECTION = temporary (unreachable, busy, 5xx) · EAUTH = wrong keys · EENVELOPE = message refused.

const API = 'https://api.mailjet.com';
const TIMEOUT_MS = 20_000;

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
  verify(): Promise<unknown>;
}

// "Service Hub <hub@example.com>" -> { Name: 'Service Hub', Email: 'hub@example.com' }
export function parseAddress(address: string): { Email: string; Name?: string } {
  const match = address.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { Email: match[2].trim(), ...(match[1].trim() ? { Name: match[1].trim() } : {}) } : { Email: address.trim() };
}

function mailError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function createMailjetTransport(apiKey: string, secretKey: string, from: string): MailTransport {
  const authorization = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;

  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw mailError('ECONNECTION', 'Mailjet could not be reached.');
    }
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw mailError('EAUTH', 'Mailjet refused the API key or secret key.');
    if (response.status === 429 || response.status >= 500) throw mailError('ECONNECTION', `Mailjet is busy or unavailable (${response.status}).`);
    return { status: response.status, body };
  }

  return {
    async sendMail(message) {
      const { status, body } = await call('/v3.1/send', {
        method: 'POST',
        body: JSON.stringify({
          Messages: [
            {
              From: parseAddress(message.from),
              To: [{ Email: message.to }],
              Subject: message.subject,
              TextPart: message.text,
              ...(message.html ? { HTMLPart: message.html } : {}),
            },
          ],
        }),
      });
      const result = body?.Messages?.[0];
      if (status >= 400 || result?.Status !== 'success') {
        const reason = result?.Errors?.[0]?.ErrorMessage ?? body?.ErrorMessage ?? `Mailjet answered ${status}.`;
        throw mailError('EENVELOPE', `Mailjet refused the email: ${reason}`);
      }
      return result;
    },

    // At start-up: are the keys right, and is the sender address confirmed in Mailjet?
    async verify() {
      const sender = parseAddress(from).Email.toLowerCase();
      const { body } = await call('/v3/REST/sender?Limit=1000');
      const match = (body?.Data ?? []).find((entry: { Email?: string }) => entry.Email?.toLowerCase() === sender);
      if (!match) throw mailError('EENVELOPE', `${sender} is not a sender in Mailjet yet: add it under Account > Senders.`);
      if (match.Status !== 'Active') throw mailError('EENVELOPE', `${sender} is not confirmed in Mailjet yet: open the confirmation email Mailjet sent to it.`);
      return true;
    },
  };
}
