import { authFetch } from './auth';
import { TRANSFER_TIMEOUT_MS } from './http';

export interface TicketAttachment {
  id: string;
  ticketId: string;
  stage: 'submission' | 'resolution';
  fileName: string;
  mimeType: string;
  size: number;
  uploaderId: string;
  uploaderName?: string;
  createdAt: string;
}

// Mirrors the backend rules so problems are caught before uploading.
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;
export const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'log', 'csv', 'docx', 'xlsx'];

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export async function listAttachments(ticketId: string): Promise<TicketAttachment[]> {
  const response = await authFetch(`${apiUrl}/tickets/${ticketId}/attachments`);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'Attachments could not be loaded.');
  }

  return response.json() as Promise<TicketAttachment[]>;
}

export async function uploadAttachments(ticketId: string, files: File[]): Promise<TicketAttachment[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);

  // No Content-Type header: the browser sets the multipart boundary itself.
  const response = await authFetch(`${apiUrl}/tickets/${ticketId}/attachments`, { method: 'POST', body: form }, TRANSFER_TIMEOUT_MS);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = response.status === 413 ? 'A file is larger than the 10 MB limit.' : error?.message;
    throw new Error(message ?? 'The files could not be uploaded.');
  }

  return response.json() as Promise<TicketAttachment[]>;
}

// Downloads go through the API (the file needs the user's session), then are handed to the browser as a file.
export async function downloadAttachment(attachment: TicketAttachment): Promise<void> {
  const response = await authFetch(`${apiUrl}/tickets/${attachment.ticketId}/attachments/${attachment.id}/download`, {}, TRANSFER_TIMEOUT_MS);

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? 'The file could not be downloaded.');
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Returns an error message for the first problem found, or null if the selection can be uploaded.
export function validateFiles(files: File[]): string | null {
  if (files.length > MAX_FILES_PER_UPLOAD) return `You can attach up to ${MAX_FILES_PER_UPLOAD} files.`;
  for (const file of files) {
    const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.includes(extension)) return `"${file.name}" is not an allowed file type.`;
    if (file.size > MAX_FILE_SIZE_BYTES) return `"${file.name}" is larger than 10 MB.`;
    if (file.size === 0) return `"${file.name}" is empty.`;
  }
  return null;
}
