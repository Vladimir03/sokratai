// LessonMaterialsPanel — the BODY of the lesson-materials UI (recording / PDF /
// homework), extracted from LessonMaterialsDrawer so BOTH the standalone drawer
// AND the guided PostLessonSheet render the same UI + logic (no duplication).
//
// The panel owns the TASK-7 "notify-on-close" digest (rule 98): it fires ONE
// notification when the host sheet closes via «Готово»/overlay/Esc, IF a material
// was added this session. Hosts trigger it through the ref handle
// `flushNotifyOnClose()`; the Create-ДЗ navigation path uses `onRequestClose()`
// (raw close, NO notify — navigating away ≠ «Готово»).
//
// rule 80 (Safari): 16px inputs, touch-action:manipulation, URL.revokeObjectURL.
// rule 90: Lucide icons (no emoji), accent/socrat tokens, memo rows.

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';
import { useDragDropFiles } from '@/hooks/useDragDropFiles';
import { getSubjectLabel } from '@/types/homework';
import { listTutorHomeworkAssignments } from '@/lib/tutorHomeworkApi';
import { useHomeworkFolders } from '@/hooks/useHomeworkFolders';
import { collectDescendantIds, flattenTreeWithDepth } from '@/lib/homeworkFolderTree';
import { useTutorStudents } from '@/hooks/useTutor';
import type { TutorLessonWithStudent } from '@/types/tutor';
import {
  addRecording,
  attachHomework,
  deleteMaterial,
  listLessonMaterials,
  notifyLessonMaterials,
  uploadLessonPdf,
  LessonMaterialsApiError,
  MAX_LESSON_PDF_BYTES,
  MAX_LESSON_PDFS,
  MAX_LESSON_RECORDINGS,
  type LessonMaterial,
} from '@/lib/lessonMaterialsApi';

/** Subtitle shared by both shells: «Физика · 1 июня, 18:30». */
export function lessonSubtitle(lesson: TutorLessonWithStudent): string {
  let lessonDate = '';
  try {
    lessonDate = format(parseISO(lesson.start_at), 'd MMMM, HH:mm', { locale: ru });
  } catch {
    lessonDate = '';
  }
  return [lesson.subject?.trim() || 'Занятие', lessonDate].filter(Boolean).join(' · ');
}

export interface LessonMaterialsPanelHandle {
  /** Fire the TASK-7 notify digest once (host calls this before a «Готово»/Esc close). */
  flushNotifyOnClose: () => void;
}

interface LessonMaterialsPanelProps {
  lesson: TutorLessonWithStudent;
  /** = host sheet `open`. Gates queries + resets transient form state on close. */
  active: boolean;
  /** Raw close (NO notify) — used by the Create-ДЗ navigation path. */
  onRequestClose: () => void;
}

interface PendingPdf {
  id: string;
  name: string;
  size: number;
  objectUrl: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// PDF-конспекты лежат в bucket `lesson-materials` (rule 98). Репетитор имеет
// `tutor read own` SELECT-политику (миграция 20260602140100) → может подписать
// СВОИ PDF клиентом. URL уже RU-safe: client `supabase` хардкодит api.sokratai.ru
// (rule 95) → rewriteToProxy не нужен (паттерн MockExamVariantPreviewSheet, rule 45).
const LESSON_MATERIAL_BUCKET = 'lesson-materials';
const PDF_SIGNED_URL_TTL_SEC = 3600;

/** `storage://<bucket>/<objectPath>` → { bucket, objectPath } | null. */
function parseStorageRef(ref: string): { bucket: string; objectPath: string } | null {
  const m = /^storage:\/\/([^/]+)\/(.+)$/.exec(ref.trim());
  if (!m) return null;
  return { bucket: m[1], objectPath: m[2] };
}

// ─── Material row (memoized) ────────────────────────────────────────────────────

interface MaterialRowProps {
  material: LessonMaterial;
  label: string;
  deleting: boolean;
  onRemove: () => void;
  /** External href to open: recording → material.url; pdf → signed URL (may be null while resolving). */
  openUrl?: string | null;
  /** SPA navigation (homework_ref → /tutor/homework/:id). Mutually exclusive with openUrl in practice. */
  onOpen?: () => void;
}

const MaterialRow = memo(function MaterialRow({
  material,
  label,
  deleting,
  onRemove,
  openUrl,
  onOpen,
}: MaterialRowProps) {
  const kind = material.material_kind;
  const Icon = kind === 'recording' ? Video : kind === 'pdf' ? FileText : BookOpen;
  const iconColor =
    kind === 'recording'
      ? 'bg-socrat-accent-light text-socrat-accent'
      : kind === 'pdf'
        ? 'bg-socrat-primary-light text-socrat-primary'
        : 'bg-accent/10 text-accent';
  // recording → material.url; pdf → resolved signed URL (openUrl).
  const externalHref = kind === 'recording' ? material.url : kind === 'pdf' ? (openUrl ?? null) : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-socrat-border bg-white px-3 py-2.5">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconColor)}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{label}</p>
        {externalHref && (
          <a
            href={externalHref}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            style={{ touchAction: 'manipulation' }}
          >
            <ExternalLink className="h-3 w-3" /> Открыть
          </a>
        )}
        {kind === 'homework_ref' && onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            style={{ touchAction: 'manipulation' }}
          >
            <ExternalLink className="h-3 w-3" /> Открыть
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={deleting}
        aria-label="Удалить материал"
        className="shrink-0 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
        style={{ touchAction: 'manipulation' }}
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
      </button>
    </div>
  );
});

// ─── Panel ──────────────────────────────────────────────────────────────────

export const LessonMaterialsPanel = forwardRef<LessonMaterialsPanelHandle, LessonMaterialsPanelProps>(
  function LessonMaterialsPanel({ lesson, active, onRequestClose }, ref) {
    const lessonId = lesson.id;
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    // Notify-on-close (TASK-7): fire ONE digest when the host closes if a
    // material was added this session. notifiedRef = client idempotency.
    const materialsAddedRef = useRef(false);
    const notifiedRef = useRef(false);

    const materialsQuery = useQuery({
      queryKey: ['tutor', 'lesson-materials', lessonId],
      queryFn: () => listLessonMaterials(lessonId),
      enabled: active,
      refetchOnWindowFocus: false,
    });
    const materials = useMemo(() => materialsQuery.data ?? [], [materialsQuery.data]);

    const recordings = useMemo(() => materials.filter((m) => m.material_kind === 'recording'), [materials]);
    const pdfs = useMemo(() => materials.filter((m) => m.material_kind === 'pdf'), [materials]);
    // Несколько ДЗ на урок (запрос Елены 2026-06-17): filter, не find.
    const homeworkRefs = useMemo(
      () => materials.filter((m) => m.material_kind === 'homework_ref'),
      [materials],
    );
    const attachedAssignmentIds = useMemo(
      () => new Set(homeworkRefs.map((m) => m.homework_assignment_id).filter(Boolean) as string[]),
      [homeworkRefs],
    );

    // PDF-конспекты: подписываем storage-рефы клиентом, чтобы репетитор открывал
    // СВОИ PDF так же, как ученик (скрин 3, паритет). Батч по всем PDF занятия.
    const pdfObjectPaths = useMemo(() => {
      const paths = new Set<string>();
      for (const m of pdfs) {
        const ref = parseAttachmentUrls(m.url)[0];
        const parsed = ref ? parseStorageRef(ref) : null;
        if (parsed && parsed.bucket === LESSON_MATERIAL_BUCKET) paths.add(parsed.objectPath);
      }
      return [...paths];
    }, [pdfs]);

    const pdfSignedQuery = useQuery({
      queryKey: ['tutor', 'lesson-materials', 'pdf-signed', lessonId, pdfObjectPaths],
      queryFn: async () => {
        const map: Record<string, string> = {};
        if (pdfObjectPaths.length === 0) return map;
        const { data, error } = await supabase.storage
          .from(LESSON_MATERIAL_BUCKET)
          .createSignedUrls(pdfObjectPaths, PDF_SIGNED_URL_TTL_SEC);
        if (error || !data) return map;
        for (const item of data) {
          if (item.signedUrl && item.path) map[item.path] = item.signedUrl;
        }
        return map;
      },
      enabled: active && pdfObjectPaths.length > 0,
      staleTime: (PDF_SIGNED_URL_TTL_SEC - 300) * 1000, // refetch чуть раньше истечения TTL
      // Drawer может быть открыт > 1ч → переподписываем до истечения, иначе «Открыть»
      // даст просроченный URL (review P3).
      refetchInterval:
        active && pdfObjectPaths.length > 0 ? (PDF_SIGNED_URL_TTL_SEC - 600) * 1000 : false,
      refetchOnWindowFocus: false,
    });

    const pdfUrlByMaterialId = useMemo(() => {
      const signed = pdfSignedQuery.data ?? {};
      const map = new Map<string, string>();
      for (const m of pdfs) {
        const ref = parseAttachmentUrls(m.url)[0];
        const parsed = ref ? parseStorageRef(ref) : null;
        if (parsed && signed[parsed.objectPath]) map.set(m.id, signed[parsed.objectPath]);
      }
      return map;
    }, [pdfs, pdfSignedQuery.data]);

    // Recording form
    const [recordingUrl, setRecordingUrl] = useState('');
    const [recordingTitle, setRecordingTitle] = useState('');
    const [addingRecording, setAddingRecording] = useState(false);

    // PDF upload
    const [pendingPdfs, setPendingPdfs] = useState<PendingPdf[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);
    const urlsRef = useRef<Map<string, string>>(new Map());

    // Homework picker
    const [pickerOpen, setPickerOpen] = useState(false);
    const [attachingId, setAttachingId] = useState<string | null>(null);
    // Фильтр пикера по папкам (синергия #1↔#2, запрос Елены 2026-06-17):
    // 'all' | '__none__' (без папки) | folderId. Вложенность (2026-07-20):
    // options с отступами, фильтр SUBTREE-inclusive (папка = её поддерево).
    const [pickerFolderId, setPickerFolderId] = useState<string>('all');
    const { folders: homeworkFolders, tree: homeworkFolderTree } = useHomeworkFolders();
    const folderOptions = useMemo(
      () => flattenTreeWithDepth(homeworkFolderTree),
      [homeworkFolderTree],
    );
    const pickerFolderSubtree = useMemo(
      () =>
        pickerFolderId === 'all' || pickerFolderId === '__none__'
          ? null
          : collectDescendantIds(homeworkFolders, pickerFolderId),
      [pickerFolderId, homeworkFolders],
    );

    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Assignments — needed for the picker and to label the attached homework_ref row.
    const assignmentsQuery = useQuery({
      queryKey: ['tutor', 'homework', 'assignments', 'all'],
      queryFn: () => listTutorHomeworkAssignments({ filter: 'all' }),
      enabled: active && (pickerOpen || homeworkRefs.length > 0),
      refetchOnWindowFocus: false,
    });
    const assignmentTitleById = useMemo(() => {
      const map = new Map<string, string>();
      for (const a of assignmentsQuery.data ?? []) map.set(a.id, a.title);
      return map;
    }, [assignmentsQuery.data]);
    // Список пикера, отфильтрованный по выбранной папке (папка = subtree).
    const pickerAssignments = useMemo(() => {
      const all = assignmentsQuery.data ?? [];
      if (pickerFolderId === 'all') return all;
      if (pickerFolderId === '__none__') return all.filter((a) => !a.folder_id);
      return all.filter((a) => a.folder_id && pickerFolderSubtree?.has(a.folder_id));
    }, [assignmentsQuery.data, pickerFolderId, pickerFolderSubtree]);

    // ── Attach = assign (запрос Егора, 2026-07-20) ──────────────────────────────
    // Прикрепление ДЗ к занятию авто-назначает недостающих учеников (edge).
    // Здесь — best-effort подсказка «будет назначено {имя}» на карточках пикера:
    // сбой любого из запросов просто прячет подсказку, attach работает всё равно.
    // Fail-closed резолв получателей остаётся ТОЛЬКО в handleCreateHomework.
    const lessonStudentsQuery = useQuery({
      queryKey: ['tutor', 'lesson-students', lessonId],
      queryFn: async () => {
        const ids = new Set<string>();
        if (lesson.student_id) ids.add(lesson.student_id);
        // Группа (unified: student_id IS NULL) — участники из junction (mirror handleCreateHomework).
        if (!lesson.student_id || lesson.group_session_id) {
          const { data, error } = await supabase
            .from('tutor_lesson_participants')
            .select('student_id')
            .eq('lesson_id', lessonId);
          if (error) throw error;
          for (const p of data ?? []) {
            if (p.student_id) ids.add(p.student_id);
          }
        }
        return [...ids];
      },
      enabled: active && pickerOpen,
      refetchOnWindowFocus: false,
    });
    const lessonStudentIds = useMemo(
      () => lessonStudentsQuery.data ?? [],
      [lessonStudentsQuery.data],
    );

    // Кто из учеников занятия уже назначен на какие ДЗ (RLS: tutor видит свои
    // назначения — policy «HW tutor student assignments select by owner»).
    // Ids в ключе — как pdfSignedQuery (поздняя загрузка участников меняет ключ).
    const assignedMapQuery = useQuery({
      queryKey: ['tutor', 'hw-assigned-map', lessonId, lessonStudentIds],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('homework_tutor_student_assignments')
          .select('assignment_id, student_id')
          .in('student_id', lessonStudentIds);
        if (error) throw error;
        return (data ?? []) as { assignment_id: string; student_id: string }[];
      },
      enabled: active && pickerOpen && lessonStudentIds.length > 0,
      refetchOnWindowFocus: false,
    });
    const assignedByAssignment = useMemo(() => {
      const map = new Map<string, Set<string>>();
      for (const row of assignedMapQuery.data ?? []) {
        let set = map.get(row.assignment_id);
        if (!set) {
          set = new Set();
          map.set(row.assignment_id, set);
        }
        set.add(row.student_id);
      }
      return map;
    }, [assignedMapQuery.data]);

    // Имена учеников — из общего кэша ['tutor','students'] (schedule уже грузит);
    // индивидуальное занятие имеет fallback из самой строки занятия.
    const { students: tutorStudents } = useTutorStudents();
    const nameByStudentId = useMemo(() => {
      const map = new Map<string, string>();
      for (const s of tutorStudents) {
        const name =
          s.display_name?.trim() || s.profiles?.full_name?.trim() || s.profiles?.username?.trim();
        if (name) map.set(s.student_id, name);
      }
      if (lesson.student_id && !map.has(lesson.student_id)) {
        const fallback =
          lesson.tutor_students?.profiles?.username ?? lesson.profiles?.username ?? null;
        if (fallback) map.set(lesson.student_id, fallback);
      }
      return map;
    }, [tutorStudents, lesson]);

    /** Ученики занятия, которых авто-назначит attach этого ДЗ (пусто = подсказка не нужна). */
    const missingIdsFor = useCallback(
      (assignmentId: string): string[] => {
        if (lessonStudentIds.length === 0 || assignedMapQuery.data === undefined) return [];
        const assigned = assignedByAssignment.get(assignmentId);
        return lessonStudentIds.filter((id) => !assigned?.has(id));
      },
      [lessonStudentIds, assignedMapQuery.data, assignedByAssignment],
    );

    const assignHintText = useCallback(
      (missingIds: string[]): string => {
        const names = missingIds
          .map((id) => nameByStudentId.get(id))
          .filter(Boolean) as string[];
        return names.length > 0
          ? `будет назначено: ${names.join(', ')}`
          : 'будет назначено ученикам занятия';
      },
      [nameByStudentId],
    );

    const invalidate = useCallback(
      () => queryClient.invalidateQueries({ queryKey: ['tutor', 'lesson-materials', lessonId] }),
      [queryClient, lessonId],
    );

    // Revoke all pending-PDF object URLs on unmount.
    useEffect(() => {
      const urls = urlsRef.current;
      return () => {
        urls.forEach((u) => URL.revokeObjectURL(u));
        urls.clear();
      };
    }, []);

    // Reset transient form state when the host closes / lesson changes.
    useEffect(() => {
      if (!active) {
        setRecordingUrl('');
        setRecordingTitle('');
        setPickerOpen(false);
        materialsAddedRef.current = false;
        notifiedRef.current = false;
      }
    }, [active, lessonId]);

    // TASK-7: host triggers the notify digest exactly once on a «Готово»/Esc close.
    useImperativeHandle(
      ref,
      () => ({
        flushNotifyOnClose() {
          if (materialsAddedRef.current && !notifiedRef.current) {
            notifiedRef.current = true;
            notifyLessonMaterials(lessonId)
              .then((res) => {
                if (res?.notify && res.notify.recipients > 0) {
                  toast.success('Ученик получит уведомление о материалах');
                }
              })
              .catch(() => {
                toast.error('Не удалось отправить уведомление ученику');
              });
          }
        },
      }),
      [lessonId],
    );

    const errMessage = (err: unknown, fallback: string) =>
      err instanceof Error && err.message ? err.message : fallback;

    const handleAddRecording = useCallback(async () => {
      const url = recordingUrl.trim();
      if (!/^https?:\/\/.+/i.test(url)) {
        toast.error('Ссылка должна начинаться с http:// или https://');
        return;
      }
      setAddingRecording(true);
      try {
        await addRecording(lessonId, url, recordingTitle.trim() || null);
        materialsAddedRef.current = true;
        setRecordingUrl('');
        setRecordingTitle('');
        await invalidate();
        toast.success('Ссылка добавлена');
      } catch (err) {
        toast.error(errMessage(err, 'Не удалось добавить ссылку'));
      } finally {
        setAddingRecording(false);
      }
    }, [lessonId, recordingUrl, recordingTitle, invalidate]);

    const uploadOnePdf = useCallback(
      async (file: File) => {
        const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const objectUrl = URL.createObjectURL(file);
        urlsRef.current.set(pendingId, objectUrl);
        setPendingPdfs((prev) => [...prev, { id: pendingId, name: file.name, size: file.size, objectUrl }]);
        try {
          await uploadLessonPdf(file, lessonId);
          materialsAddedRef.current = true;
          await invalidate();
        } catch (err) {
          toast.error(errMessage(err, 'Не удалось загрузить PDF'));
        } finally {
          setPendingPdfs((prev) => prev.filter((p) => p.id !== pendingId));
          const url = urlsRef.current.get(pendingId);
          if (url) {
            URL.revokeObjectURL(url);
            urlsRef.current.delete(pendingId);
          }
        }
      },
      [lessonId, invalidate],
    );

    const handlePdfFiles = useCallback(
      (files: File[]) => {
        const slots = MAX_LESSON_PDFS - (pdfs.length + pendingPdfs.length);
        if (slots <= 0) {
          toast.error(`Можно добавить не более ${MAX_LESSON_PDFS} PDF-конспектов`);
          return;
        }
        for (const file of files.slice(0, slots)) {
          if (file.size > MAX_LESSON_PDF_BYTES) {
            toast.error(`Файл «${file.name}» больше 20 МБ`);
            continue;
          }
          void uploadOnePdf(file);
        }
      },
      [pdfs.length, pendingPdfs.length, uploadOnePdf],
    );

    const pdfSlotsLeft = MAX_LESSON_PDFS - (pdfs.length + pendingPdfs.length);
    const dragDrop = useDragDropFiles({
      enabled: active && pdfSlotsLeft > 0,
      acceptedTypes: ['application/pdf'],
      maxFiles: MAX_LESSON_PDFS,
      currentCount: pdfs.length + pendingPdfs.length,
      compress: false,
      onFilesDropped: handlePdfFiles,
      successToast: null,
      telemetryTag: 'lesson_materials_pdf',
    });

    const handleAttach = useCallback(
      async (assignmentId: string) => {
        setAttachingId(assignmentId);
        try {
          const res = await attachHomework(lessonId, assignmentId);
          materialsAddedRef.current = true;
          // Несколько ДЗ на урок: пикер НЕ закрываем — можно привязать ещё.
          // Новая строка появится над пикером после invalidate().
          await invalidate();
          // Attach = assign: edge сообщает, кого авто-назначил (старый edge — undefined).
          const assignedIds = res.assigned_student_ids ?? [];
          if (assignedIds.length > 0) {
            const names = assignedIds
              .map((id) => nameByStudentId.get(id))
              .filter(Boolean) as string[];
            toast.success(
              names.length > 0
                ? `ДЗ привязано и назначено: ${names.join(', ')}`
                : 'ДЗ привязано и назначено ученикам занятия',
            );
            // Назначения изменились → освежить подсказки пикера и списки ДЗ.
            void queryClient.invalidateQueries({ queryKey: ['tutor', 'hw-assigned-map', lessonId] });
            void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'assignments'] });
            void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'detail', assignmentId] });
          } else {
            toast.success('ДЗ привязано к занятию');
          }
        } catch (err) {
          if (err instanceof LessonMaterialsApiError && err.code === 'INVALID_HOMEWORK_REF') {
            // После attach=assign этот код остаётся для ownership-отказа / занятия
            // без учеников / старого edge (deploy-skew).
            toast.error('Это ДЗ нельзя привязать к занятию');
          } else if (
            err instanceof LessonMaterialsApiError &&
            (err.code === 'HW_REF_DUPLICATE' || err.code === 'HW_REF_EXISTS')
          ) {
            // HW_REF_EXISTS оставлен для backward-compat со старым edge до деплоя.
            toast.error('Это ДЗ уже привязано к занятию');
          } else {
            // LIMIT_REACHED и прочее — серверная рус-фраза через errMessage.
            toast.error(errMessage(err, 'Не удалось привязать ДЗ'));
          }
        } finally {
          setAttachingId(null);
        }
      },
      [lessonId, invalidate, queryClient, nameByStudentId],
    );

    const handleDelete = useCallback(
      async (materialId: string) => {
        setDeletingId(materialId);
        try {
          await deleteMaterial(materialId);
          await invalidate();
        } catch (err) {
          toast.error(errMessage(err, 'Не удалось удалить материал'));
        } finally {
          setDeletingId(null);
        }
      },
      [invalidate],
    );

    // TASK-8: open the homework constructor prefilled with this lesson's subject
    // + recipients; on save the new ДЗ is auto-linked back (homework_ref). No
    // notify here — navigating away ≠ «Готово» (so use onRequestClose, not flush).
    const handleCreateHomework = useCallback(async () => {
      const params = new URLSearchParams();
      if (lesson.subject?.trim()) params.set('subject', lesson.subject.trim());
      params.set('lesson_id', lesson.id);
      const ids = new Set<string>();
      if (lesson.student_id) ids.add(lesson.student_id);
      // Group lessons: recipients come from participants (unified group has
      // student_id IS NULL). FAIL CLOSED on query error — navigating with an
      // empty recipient set would prefill a ДЗ for nobody (review fix #2).
      if (!lesson.student_id || lesson.group_session_id) {
        let parts: { student_id: string | null }[];
        try {
          const { data, error } = await supabase
            .from('tutor_lesson_participants')
            .select('student_id')
            .eq('lesson_id', lesson.id);
          if (error) throw error;
          parts = data ?? [];
        } catch (err) {
          console.warn('lesson_participants_load_failed', err);
          toast.error('Не удалось загрузить участников группы. Попробуйте снова.');
          return;
        }
        for (const p of parts) {
          if (p.student_id) ids.add(p.student_id);
        }
      }
      if (ids.size === 0) {
        toast.error('У занятия нет получателей для назначения ДЗ.');
        return;
      }
      params.set('students', [...ids].join(','));
      onRequestClose();
      navigate(`/tutor/homework/create?${params.toString()}`);
    }, [lesson, navigate, onRequestClose]);

    // Открыть привязанное ДЗ на экране репетитора (скрин 3, паритет с учеником).
    // Навигация ≠ «Готово» → raw close без notify (mirror handleCreateHomework).
    const openHomework = useCallback(
      (assignmentId: string) => {
        onRequestClose();
        navigate(`/tutor/homework/${assignmentId}`);
      },
      [navigate, onRequestClose],
    );

    const recordingLimitReached = recordings.length >= MAX_LESSON_RECORDINGS;

    return (
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {/* ── Запись ── */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Video className="h-4 w-4 text-socrat-accent" /> Запись
            </h3>
            <span className="text-xs text-slate-400">{recordings.length}/{MAX_LESSON_RECORDINGS}</span>
          </div>
          {!recordingLimitReached && (
            <div className="space-y-2">
              <input
                type="url"
                inputMode="url"
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
                placeholder="Drive · Яндекс.Диск · VK Video · YouTube"
                className="w-full rounded-md border border-socrat-border px-3 py-2 text-base text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                style={{ touchAction: 'manipulation' }}
              />
              <input
                type="text"
                value={recordingTitle}
                onChange={(e) => setRecordingTitle(e.target.value)}
                placeholder="Название (необязательно)"
                className="w-full rounded-md border border-socrat-border px-3 py-2 text-base text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                style={{ touchAction: 'manipulation' }}
              />
              <button
                type="button"
                onClick={handleAddRecording}
                disabled={addingRecording || !recordingUrl.trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-socrat-border bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ touchAction: 'manipulation' }}
              >
                {addingRecording ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Добавить ссылку
              </button>
            </div>
          )}
          {recordings.map((m) => (
            <MaterialRow
              key={m.id}
              material={m}
              label={m.title?.trim() || m.url || 'Запись'}
              deleting={deletingId === m.id}
              onRemove={() => handleDelete(m.id)}
            />
          ))}
        </section>

        {/* ── Конспект ── */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <FileText className="h-4 w-4 text-socrat-primary" /> Конспект
            </h3>
            <span className="text-xs text-slate-400">{pdfs.length}/{MAX_LESSON_PDFS}</span>
          </div>
          {pdfSlotsLeft > 0 && (
            <div
              className={cn(
                'relative rounded-md border-[1.5px] border-dashed border-socrat-border transition-colors',
                dragDrop.isDragging && 'border-accent bg-accent/5',
              )}
              {...dragDrop.dragHandlers}
            >
              {dragDrop.isDragging && (
                <div
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-accent/10 backdrop-blur-[1px]"
                  aria-hidden="true"
                >
                  <p className="text-sm font-medium text-accent">Отпустите для добавления</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 px-4 py-6 text-center"
                style={{ touchAction: 'manipulation' }}
              >
                <Upload className="h-5 w-5 text-slate-400" />
                <span className="text-sm font-medium text-slate-600">Перетащите PDF или нажмите, чтобы выбрать</span>
                <span className="text-xs text-slate-400">до 20 МБ · до {MAX_LESSON_PDFS} файлов</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  handlePdfFiles(Array.from(e.target.files ?? []));
                  if (fileRef.current) fileRef.current.value = '';
                }}
              />
            </div>
          )}
          {pendingPdfs.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-socrat-border bg-slate-50 px-3 py-2.5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-socrat-primary-light text-socrat-primary">
                <FileText className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                <a
                  href={p.objectUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  style={{ touchAction: 'manipulation' }}
                >
                  <ExternalLink className="h-3 w-3" /> {formatFileSize(p.size)}
                </a>
              </div>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
            </div>
          ))}
          {pdfs.map((m) => (
            <MaterialRow
              key={m.id}
              material={m}
              label={m.title?.trim() || 'PDF-конспект'}
              deleting={deletingId === m.id}
              onRemove={() => handleDelete(m.id)}
              openUrl={pdfUrlByMaterialId.get(m.id) ?? null}
            />
          ))}
        </section>

        {/* ── Домашка ── */}
        <section className="space-y-2.5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <BookOpen className="h-4 w-4 text-accent" /> Домашка
          </h3>
          {/* Привязанные ДЗ — список, каждое удаляемо. */}
          {homeworkRefs.map((m) => (
            <MaterialRow
              key={m.id}
              material={m}
              label={
                (m.homework_assignment_id
                  ? assignmentTitleById.get(m.homework_assignment_id)
                  : null) || 'Домашнее задание'
              }
              deleting={deletingId === m.id}
              onRemove={() => handleDelete(m.id)}
              onOpen={
                m.homework_assignment_id
                  ? () => openHomework(m.homework_assignment_id!)
                  : undefined
              }
            />
          ))}

          {/* Пикер ИЛИ кнопки действий (secondary — один primary на экран, rule 90). */}
          {pickerOpen ? (
            <div className="space-y-2">
              {/* Фильтр по папкам (синергия #1↔#2) — только если папки есть. */}
              {homeworkFolders.length > 0 && (
                <select
                  value={pickerFolderId}
                  onChange={(e) => setPickerFolderId(e.target.value)}
                  aria-label="Фильтр ДЗ по папке"
                  className="w-full rounded-lg border border-socrat-border bg-white px-3 py-2 text-base focus:outline-none"
                  style={{ touchAction: 'manipulation' }}
                >
                  <option value="all">Все папки</option>
                  <option value="__none__">Без папки</option>
                  {folderOptions.map(({ folder: f, depth }) => (
                    <option key={f.id} value={f.id}>{'— '.repeat(depth) + f.name}</option>
                  ))}
                </select>
              )}

              <div className="space-y-1.5">
                {assignmentsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-4 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : pickerAssignments.length === 0 ? (
                  <p className="py-3 text-center text-sm text-slate-400">
                    {(assignmentsQuery.data ?? []).length === 0
                      ? 'У вас пока нет домашних заданий'
                      : 'В этой папке нет заданий'}
                  </p>
                ) : (
                  pickerAssignments.map((a) => {
                    const already = attachedAssignmentIds.has(a.id);
                    // Attach = assign: кого авто-назначит привязка этого ДЗ.
                    const missingIds = already ? [] : missingIdsFor(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => handleAttach(a.id)}
                        disabled={already || attachingId !== null}
                        className="flex w-full items-center gap-3 rounded-lg border border-socrat-border bg-white px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
                        style={{ touchAction: 'manipulation' }}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                          {attachingId === a.id ? (
                            <Loader2 className="h-[18px] w-[18px] animate-spin" />
                          ) : already ? (
                            <Check className="h-[18px] w-[18px]" />
                          ) : (
                            <BookOpen className="h-[18px] w-[18px]" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{a.title}</p>
                          <p className="truncate text-xs text-slate-500">{getSubjectLabel(a.subject as string)}</p>
                          {missingIds.length > 0 && (
                            <p className="truncate text-xs text-slate-400">{assignHintText(missingIds)}</p>
                          )}
                        </div>
                        {already && <span className="shrink-0 text-xs text-slate-400">Привязано</span>}
                      </button>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
                style={{ touchAction: 'manipulation' }}
              >
                Готово
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-socrat-border bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                style={{ touchAction: 'manipulation' }}
              >
                <BookOpen className="h-4 w-4" /> {homeworkRefs.length > 0 ? 'Добавить ещё ДЗ' : 'Выбрать ДЗ'}
              </button>
              <button
                type="button"
                onClick={handleCreateHomework}
                className="inline-flex items-center gap-1.5 rounded-md border border-socrat-border bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                style={{ touchAction: 'manipulation' }}
              >
                <Plus className="h-4 w-4" /> Создать ДЗ
              </button>
            </div>
          )}
        </section>
      </div>
    );
  },
);
