import { Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Response } from 'express';
import { FileHandle, open } from 'node:fs/promises';
import { pipeline } from 'node:stream';

export interface StoredFile {
  handle: FileHandle;
  size: number;
}

// Opens a stored file (attachment, profile photo) before anything is sent. A missing, locked or unreadable
// file becomes a clear error for this one request; left to a stream, the same problem would surface as an
// unhandled 'error' event, which stops the whole server.
export async function openStoredFile(path: string, missingMessage: string): Promise<StoredFile> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile()) throw Object.assign(new Error(`${path} is not a file`), { code: 'EISDIR' });
    return { handle, size: info.size };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') throw new NotFoundException(missingMessage);
    // e.g. EBUSY / EPERM while a sync client or antivirus holds the file: worth trying again shortly.
    throw new ServiceUnavailableException('The file cannot be read right now. Please try again in a moment.');
  }
}

// Sends an opened file. A read error or a cancelled download ends only this response, and the file is
// always closed (pipe() would leave it open when the browser disconnects).
export function sendStoredFile(response: Response, file: StoredFile, logger: Logger, label: string): void {
  pipeline(file.handle.createReadStream(), response, (error) => {
    if (error && (error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      logger.error(`Could not send ${label}: ${error.message}`);
    }
  });
}
