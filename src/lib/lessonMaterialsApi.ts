import { supabase } from '@/lib/supabaseClient';
import { extractEdgeFunctionError } from '@/lib/edgeFunctionError';

// ─── lesson-materials-api client (schedule-materials, tutor side) ──────────────
//
// Thin client over the path-routed edge function `lesson-materials-api`
// (verify_jwt=true). Uses `supabase.functions.invoke` with a subpath — the
// FunctionsClient builds `new URL(`${functionsUrl}/${name}`)`, and our
// functionsUrl derives from the hardcoded `api.sokratai.ru` (RU-safe). Errors are
// parsed via `extractEdgeFunctionError` (rule 97 flat shape `{ error, code }`).

export type LessonMaterialKind = 'recording' | 'pdf' | 'homework_ref';

export interface LessonMaterial {
  id: string;
  lesson_id: string;
  group_session_id: string | null;
  material_kind: LessonMaterialKind;
  /** recording → generic URL; pdf → `storage://lesson-materials/...` ref; homework_ref → null. */
  url: string | null;
  homework_assignment_id: string | null;
  title: string | null;
  sort_order: number;
  created_at: string;
}

// Client mirror of backend limits (lesson-materials-api).
export const MAX_LESSON_RECORDINGS = 3;
export const MAX_LESSON_PDFS = 5;
export const MAX_LESSON_PDF_BYTES = 20 * 1024 * 1024;
export const LESSON_MATERIAL_BUCKET = 'lesson-materials';

/** rule 97 flat-shape error carrier — exposes `code` for branching (e.g. INVALID_HOMEWORK_REF). */
export class LessonMaterialsApiError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'LessonMaterialsApiError';
    this.code = code;
  }
}

const FN = 'lesson-materials-api';

async function invokeLessonMaterials<T>(
  subpath: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown },
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`${FN}${subpath}`, {
    method: init.method,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(
      error,
      data,
      'Не удалось выполнить операцию. Попробуйте ещё раз.',
    );
    throw new LessonMaterialsApiError(message, code);
  }
  return data as T;
}

/** GET /lessons/:lessonId/materials */
export async function listLessonMaterials(lessonId: string): Promise<LessonMaterial[]> {
  const res = await invokeLessonMaterials<{ items: LessonMaterial[] }>(
    `/lessons/${encodeURIComponent(lessonId)}/materials`,
    { method: 'GET' },
  );
  return res.items ?? [];
}

/** POST /lessons/:lessonId/materials { kind: 'recording', url, title } */
export async function addRecording(
  lessonId: string,
  url: string,
  title?: string | null,
): Promise<LessonMaterial> {
  const res = await invokeLessonMaterials<{ material: LessonMaterial }>(
    `/lessons/${encodeURIComponent(lessonId)}/materials`,
    { method: 'POST', body: { kind: 'recording', url, title: title ?? null } },
  );
  return res.material;
}

/**
 * Upload a PDF to bucket `lesson-materials` then attach it.
 * Path: `tutor/{auth.uid()}/{lessonId}/{id}.pdf` — id via `Date.now()-Math.random()`
 * (NOT crypto.randomUUID — Safari rule 80). No compression (PDF). On attach
 * failure the just-uploaded blob is removed best-effort (avoid orphan).
 */
export async function uploadLessonPdf(
  file: File,
  lessonId: string,
  title?: string | null,
): Promise<LessonMaterial> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new LessonMaterialsApiError(sessionError.message);
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new LessonMaterialsApiError('Нет активной сессии', 'NO_SESSION');

  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const objectPath = `tutor/${uid}/${lessonId}/${fileId}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(LESSON_MATERIAL_BUCKET)
    .upload(objectPath, file, { contentType: 'application/pdf', upsert: false });
  if (uploadError) {
    throw new LessonMaterialsApiError(`Не удалось загрузить файл: ${uploadError.message}`, 'UPLOAD_FAILED');
  }

  const ref = `storage://${LESSON_MATERIAL_BUCKET}/${objectPath}`;
  try {
    const res = await invokeLessonMaterials<{ material: LessonMaterial }>(
      `/lessons/${encodeURIComponent(lessonId)}/materials`,
      { method: 'POST', body: { kind: 'pdf', url: ref, title: title ?? file.name } },
    );
    return res.material;
  } catch (err) {
    await supabase.storage.from(LESSON_MATERIAL_BUCKET).remove([objectPath]).catch(() => undefined);
    throw err;
  }
}

/** POST /lessons/:lessonId/materials { kind: 'homework_ref', homework_assignment_id } */
export async function attachHomework(
  lessonId: string,
  assignmentId: string,
): Promise<LessonMaterial> {
  const res = await invokeLessonMaterials<{ material: LessonMaterial }>(
    `/lessons/${encodeURIComponent(lessonId)}/materials`,
    { method: 'POST', body: { kind: 'homework_ref', homework_assignment_id: assignmentId } },
  );
  return res.material;
}

/** DELETE /materials/:id */
export async function deleteMaterial(materialId: string): Promise<void> {
  await invokeLessonMaterials<{ ok: true }>(
    `/materials/${encodeURIComponent(materialId)}`,
    { method: 'DELETE' },
  );
}

/** Result of a notify-digest call (channel counters; rule 70 cascade). */
export interface LessonNotifyResult {
  ok: boolean;
  notify: {
    recipients: number;
    sent_push: number;
    sent_telegram: number;
    sent_email: number;
    failed: number;
    failed_no_channel: number;
  };
}

/**
 * POST /lessons/:lessonId/materials/notify — one digest notification per call
 * (push→telegram→email) to the lesson's student(s). Called once by the drawer
 * on close when materials were added this session (client-idempotent).
 */
export async function notifyLessonMaterials(lessonId: string): Promise<LessonNotifyResult> {
  return invokeLessonMaterials<LessonNotifyResult>(
    `/lessons/${encodeURIComponent(lessonId)}/materials/notify`,
    { method: 'POST' },
  );
}
