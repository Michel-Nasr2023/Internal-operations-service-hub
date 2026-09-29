// What server logs and the audit log may contain: IDs, error codes and plain failure reasons. Never ticket
// text, file names, names, passwords, codes, tokens, prompts, provider URLs or file paths. These helpers keep
// log lines useful as evidence without leaking any of that.

// "ticket 2ad75e8a": the short ID shown in the tables, enough to find the ticket.
export function ticketRef(id: string): string {
  return `ticket ${id.slice(0, 8)}`;
}

// "ma***@company.com": enough to recognise which account was involved, without storing the full address.
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

// A short description of an error for the server log: its code and message, with file paths, web addresses
// and email addresses removed (file-system and network errors often include them).
export function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    .replace(/'[^']*[\\/][^']*'/g, "'<path>'")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@-]+){2,}[\\/]?/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return typeof code === 'string' && !message.includes(code) ? `${code}: ${message}` : message;
}
