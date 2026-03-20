const STORAGE_REF_PREFIX = 'storage://';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp']);
const PDF_EXTENSIONS = new Set(['pdf']);

export const MAX_GUIDED_CHAT_ATTACHMENTS = 3;

function normalizeRefs(refs: string[]): string[] {
  return refs
    .map((ref) => ref.trim())
    .filter(Boolean)
    .filter((ref, index, values) => values.indexOf(ref) === index);
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeRefs(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return [];
  }
}

function getAttachmentPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith(STORAGE_REF_PREFIX)) {
    const raw = trimmed.slice(STORAGE_REF_PREFIX.length);
    const slashIdx = raw.indexOf('/');
    return slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname;
  } catch {
    return trimmed;
  }
}

function getAttachmentExtension(value: string): string {
  const path = getAttachmentPath(value);
  const cleanPath = path.split('?')[0].split('#')[0];
  const lastSegment = cleanPath.split('/').filter(Boolean).pop() ?? '';
  const dotIdx = lastSegment.lastIndexOf('.');
  return dotIdx >= 0 ? lastSegment.slice(dotIdx + 1).toLowerCase() : '';
}

export function parseThreadAttachmentRefs(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    return parseJsonArray(trimmed);
  }

  return [trimmed];
}

export function serializeThreadAttachmentRefs(refs: string[]): string | null {
  const normalized = normalizeRefs(refs);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0];
  return JSON.stringify(normalized);
}

export function getThreadAttachmentKind(ref: string): 'image' | 'pdf' | 'file' {
  const extension = getAttachmentExtension(ref);
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return 'file';
}

export function getImageThreadAttachmentRefs(refs: string[]): string[] {
  return normalizeRefs(refs).filter((ref) => getThreadAttachmentKind(ref) === 'image');
}

export function getThreadAttachmentLabel(ref: string, fallbackIndex = 1): string {
  const path = getAttachmentPath(ref);
  const lastSegment = path.split('/').filter(Boolean).pop();
  if (lastSegment) return decodeURIComponent(lastSegment);

  const kind = getThreadAttachmentKind(ref);
  if (kind === 'pdf') return `document-${fallbackIndex}.pdf`;
  if (kind === 'image') return `image-${fallbackIndex}`;
  return `attachment-${fallbackIndex}`;
}

export function buildGuidedAttachmentPlaceholder(
  files: Array<Pick<File, 'name' | 'type'>>,
): string {
  if (files.length === 0) return '';

  const kinds = files.map((file) => getThreadAttachmentKind(file.name || file.type || ''));
  const onlyPdf = kinds.every((kind) => kind === 'pdf');
  const onlyImages = kinds.every((kind) => kind === 'image');

  if (files.length === 1) {
    if (onlyPdf) return '(PDF)';
    if (onlyImages) return '(фото)';
  }

  if (onlyPdf) return `(PDF x${files.length})`;
  if (onlyImages) return `(фото x${files.length})`;
  return `(вложения x${files.length})`;
}
