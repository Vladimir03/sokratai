/**
 * KB Storage API — upload / delete / signed-URL for task images.
 *
 * Follows the same storage:// ref pattern used in tutorHomeworkApi.ts.
 * Primary bucket: kb-attachments.
 */
import { supabase } from '@/lib/supabaseClient';

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_REF_PREFIX = 'storage://';
const KB_ATTACHMENTS_BUCKET = 'kb-attachments';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Helpers (mirror tutorHomeworkApi.ts) ─────────────────────────────────────

function sanitizeObjectPath(path: string): string {
  return path.replace(/^\/+/, '').trim();
}

function toStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${sanitizeObjectPath(objectPath)}`;
}

export function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = KB_ATTACHMENTS_BUCKET,
): { bucket: string; objectPath: string } | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(STORAGE_REF_PREFIX)) {
    const raw = trimmed.slice(STORAGE_REF_PREFIX.length);
    const slashIdx = raw.indexOf('/');
    if (slashIdx <= 0 || slashIdx === raw.length - 1) return null;

    const bucket = raw.slice(0, slashIdx);
    const objectPath = sanitizeObjectPath(raw.slice(slashIdx + 1));
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const objectPath = sanitizeObjectPath(trimmed);
  if (!objectPath) return null;
  return { bucket: defaultBucket, objectPath };
}

// ─── Multi-image helpers ─────────────────────────────────────────────────────

export { parseAttachmentUrls, serializeAttachmentUrls } from './attachmentRefs';

function generateFileExt(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return ext;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Допустимы только изображения (JPG, PNG, GIF, WebP)';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Максимальный размер файла — 10 МБ';
  }
  return null;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface UploadKBImageResult {
  storageRef: string;
  bucket: string;
  objectPath: string;
}

export async function uploadKBTaskImage(file: File): Promise<UploadKBImageResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Нет активной сессии');

  const ext = generateFileExt(file);
  const uuid = crypto.randomUUID();
  const primaryPath = `${userId}/${uuid}.${ext}`;

  // Try primary bucket
  const { error: primaryError } = await supabase.storage
    .from(KB_ATTACHMENTS_BUCKET)
    .upload(primaryPath, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (primaryError) {
    throw new Error(`Ошибка загрузки: ${primaryError.message}`);
  }

  return {
    storageRef: toStorageRef(KB_ATTACHMENTS_BUCKET, primaryPath),
    bucket: KB_ATTACHMENTS_BUCKET,
    objectPath: primaryPath,
  };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteKBTaskImage(storageRef: string): Promise<void> {
  const parsed = parseStorageRef(storageRef);
  if (!parsed) return;

  await supabase.storage
    .from(parsed.bucket)
    .remove([parsed.objectPath])
    .catch((err) => {
      console.warn('kb_task_image_delete_failed', {
        bucket: parsed.bucket,
        objectPath: parsed.objectPath,
        error: String(err),
      });
    });
}

// ─── Signed URL ──────────────────────────────────────────────────────────────

export async function getKBImageSignedUrl(
  storageRef: string,
): Promise<string | null> {
  const parsed = parseStorageRef(storageRef);
  if (!parsed) return null;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 3600); // 1 hour

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ─── Moderation RPCs (V2) ────────────────────────────────────────────────────

/**
 * Unpublish a catalog task (moderator-only).
 * Sets moderation_status = 'unpublished' on the canonical copy.
 */
export async function kbModUnpublish(publishedTaskId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)('kb_mod_unpublish', {
    p_published_task_id: publishedTaskId,
  });
  if (error) throw error;
}

/**
 * Reassign a catalog task to a new source (moderator-only).
 * Relinks the canonical copy to a different source task.
 */
export async function kbModReassign(
  publishedTaskId: string,
  newSourceTaskId: string,
): Promise<void> {
  const { error } = await (supabase.rpc as any)('kb_mod_reassign', {
    p_published_task_id: publishedTaskId,
    p_new_source_task_id: newSourceTaskId,
  });
  if (error) throw error;
}
