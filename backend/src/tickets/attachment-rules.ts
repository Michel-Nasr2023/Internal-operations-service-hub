// Upload limits and the file types accepted as ticket attachments.
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;
export const MAX_FILES_PER_TICKET = 10;

// The stored/served content type comes from this table, never from what the browser claimed.
const ALLOWED_TYPES: Record<string, { mimeType: string; signature: (bytes: Buffer) => boolean }> = {
  png: { mimeType: 'image/png', signature: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mimeType: 'image/jpeg', signature: isJpeg },
  jpeg: { mimeType: 'image/jpeg', signature: isJpeg },
  gif: { mimeType: 'image/gif', signature: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  webp: { mimeType: 'image/webp', signature: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  pdf: { mimeType: 'application/pdf', signature: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  txt: { mimeType: 'text/plain', signature: isText },
  log: { mimeType: 'text/plain', signature: isText },
  csv: { mimeType: 'text/csv', signature: isText },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: isZip },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: isZip },
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_TYPES);

function isJpeg(bytes: Buffer): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isZip(bytes: Buffer): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// Plain text: no NUL bytes in the first 4 KB.
function isText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 4096).includes(0);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

// Returns the content type to store, or an error message. The file's first bytes must match its extension,
// so a renamed executable or script is refused.
export function checkAttachment(fileName: string, bytes: Buffer): { mimeType: string } | { error: string } {
  const type = ALLOWED_TYPES[extensionOf(fileName)];
  if (!type) {
    return { error: `"${fileName}" is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.` };
  }
  if (bytes.length === 0) {
    return { error: `"${fileName}" is empty.` };
  }
  if (!type.signature(bytes)) {
    return { error: `"${fileName}" does not look like a real .${extensionOf(fileName)} file.` };
  }
  return { mimeType: type.mimeType };
}

// Keeps the name readable but safe to display and to put in a download header.
export function cleanFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim();
  return (cleaned || 'file').slice(0, 150);
}
