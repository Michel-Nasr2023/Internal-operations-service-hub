import { useId, useRef, useState } from 'react';
import { ALLOWED_EXTENSIONS, formatFileSize, MAX_FILES_PER_UPLOAD, validateFiles } from '../../api/attachments';

interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  disabled?: boolean;
}

// Optional file selection for a form. Files are uploaded by the parent after the form is submitted.
export function AttachmentPicker({ files, onChange, label = 'Attachments (optional)', disabled = false }: AttachmentPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  function addFiles(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    // Adding the same file twice (same name and size) is ignored.
    const merged = [...files];
    for (const file of Array.from(selected)) {
      if (!merged.some((existing) => existing.name === file.name && existing.size === file.size)) merged.push(file);
    }

    const problem = validateFiles(merged);
    setError(problem ?? '');
    if (!problem) onChange(merged);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeFile(index: number) {
    setError('');
    onChange(files.filter((_, current) => current !== index));
  }

  return (
    <div className="attachment-picker">
      <span className="attachment-picker-label">{label}</span>
      <label htmlFor={inputId} className={disabled || files.length >= MAX_FILES_PER_UPLOAD ? 'attachment-drop attachment-drop-disabled' : 'attachment-drop'}>
        <span aria-hidden="true">📎</span> Attach files
        <small>Up to {MAX_FILES_PER_UPLOAD} files, 10 MB each · {ALLOWED_EXTENSIONS.join(', ')}</small>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="visually-hidden"
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
        disabled={disabled || files.length >= MAX_FILES_PER_UPLOAD}
        onChange={(event) => addFiles(event.target.files)}
      />

      {error && <p className="message error" role="alert">{error}</p>}

      {files.length > 0 && (
        <ul className="attachment-chips">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}`}>
              <span className="attachment-chip-name" title={file.name}>{file.name}</span>
              <small>{formatFileSize(file.size)}</small>
              <button type="button" className="attachment-remove" aria-label={`Remove ${file.name}`} onClick={() => removeFile(index)} disabled={disabled}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
