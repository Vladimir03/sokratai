// LessonMaterialsDrawer — tutor drawer to attach materials to a lesson
// (schedule-materials, TASK-3). Opened from the lesson-details dialog in
// TutorSchedule. Three sections: recording URL, PDF upload (drag-drop), and a
// link to an existing homework. One primary CTA «Готово». Reuses the HWDrawer
// Sheet shell, useDragDropFiles, and the rule-97 client in lessonMaterialsApi.
//
// rule 80 (Safari): 16px inputs, touch-action:manipulation, URL.revokeObjectURL.
// rule 90: Lucide icons (no emoji), accent/socrat tokens, one primary CTA, memo rows.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  BookOpen,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useDragDropFiles } from '@/hooks/useDragDropFiles';
import { getSubjectLabel } from '@/types/homework';
import { listTutorHomeworkAssignments } from '@/lib/tutorHomeworkApi';
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

interface LessonMaterialsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
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

// ─── Material row (memoized) ────────────────────────────────────────────────────

interface MaterialRowProps {
  material: LessonMaterial;
  label: string;
  deleting: boolean;
  onRemove: () => void;
}

const MaterialRow = memo(function MaterialRow({ material, label, deleting, onRemove }: MaterialRowProps) {
  const kind = material.material_kind;
  const Icon = kind === 'recording' ? Video : kind === 'pdf' ? FileText : BookOpen;
  const iconColor =
    kind === 'recording'
      ? 'bg-socrat-accent-light text-socrat-accent'
      : kind === 'pdf'
        ? 'bg-socrat-primary-light text-socrat-primary'
        : 'bg-accent/10 text-accent';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-socrat-border bg-white px-3 py-2.5">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconColor)}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{label}</p>
        {kind === 'recording' && material.url && (
          <a
            href={material.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            style={{ touchAction: 'manipulation' }}
          >
            <ExternalLink className="h-3 w-3" /> Открыть
          </a>
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

// ─── Drawer ──────────────────────────────────────────────────────────────────

export function LessonMaterialsDrawer({ open, onOpenChange, lesson }: LessonMaterialsDrawerProps) {
  const lessonId = lesson?.id ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Notify-on-close (TASK-7): fire ONE digest when the drawer closes if a
  // material was added this session. notifiedRef = client idempotency.
  const materialsAddedRef = useRef(false);
  const notifiedRef = useRef(false);

  const materialsQuery = useQuery({
    queryKey: ['tutor', 'lesson-materials', lessonId],
    queryFn: () => listLessonMaterials(lessonId!),
    enabled: open && !!lessonId,
    refetchOnWindowFocus: false,
  });
  const materials = useMemo(() => materialsQuery.data ?? [], [materialsQuery.data]);

  const recordings = useMemo(() => materials.filter((m) => m.material_kind === 'recording'), [materials]);
  const pdfs = useMemo(() => materials.filter((m) => m.material_kind === 'pdf'), [materials]);
  const homeworkRef = useMemo(() => materials.find((m) => m.material_kind === 'homework_ref') ?? null, [materials]);

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

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Assignments — needed for the picker and to label the attached homework_ref row.
  const assignmentsQuery = useQuery({
    queryKey: ['tutor', 'homework', 'assignments', 'all'],
    queryFn: () => listTutorHomeworkAssignments({ filter: 'all' }),
    enabled: open && (pickerOpen || !!homeworkRef),
    refetchOnWindowFocus: false,
  });
  const assignmentTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignmentsQuery.data ?? []) map.set(a.id, a.title);
    return map;
  }, [assignmentsQuery.data]);

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

  // Reset transient form state when the drawer closes / lesson changes.
  useEffect(() => {
    if (!open) {
      setRecordingUrl('');
      setRecordingTitle('');
      setPickerOpen(false);
      materialsAddedRef.current = false;
      notifiedRef.current = false;
    }
  }, [open, lessonId]);

  const errMessage = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

  const handleAddRecording = useCallback(async () => {
    if (!lessonId) return;
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
      if (!lessonId) return;
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
    enabled: open && pdfSlotsLeft > 0,
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
      if (!lessonId) return;
      setAttachingId(assignmentId);
      try {
        await attachHomework(lessonId, assignmentId);
        materialsAddedRef.current = true;
        setPickerOpen(false);
        await invalidate();
        toast.success('ДЗ привязано к занятию');
      } catch (err) {
        if (err instanceof LessonMaterialsApiError && err.code === 'INVALID_HOMEWORK_REF') {
          toast.error('Это ДЗ не назначено ученику этого занятия');
        } else if (err instanceof LessonMaterialsApiError && err.code === 'HW_REF_EXISTS') {
          toast.error('К этому занятию уже привязано домашнее задание');
        } else {
          toast.error(errMessage(err, 'Не удалось привязать ДЗ'));
        }
      } finally {
        setAttachingId(null);
      }
    },
    [lessonId, invalidate],
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

  // TASK-7: close via «Готово» / overlay / Esc → one digest if materials added.
  const handleClose = useCallback(() => {
    if (lessonId && materialsAddedRef.current && !notifiedRef.current) {
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
    onOpenChange(false);
  }, [lessonId, onOpenChange]);

  // TASK-8: open the homework constructor prefilled with this lesson's subject
  // + recipients; on save the new ДЗ is auto-linked back (homework_ref). No
  // notify here — navigating away ≠ «Готово».
  const handleCreateHomework = useCallback(async () => {
    if (!lesson) return;
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
    onOpenChange(false);
    navigate(`/tutor/homework/create?${params.toString()}`);
  }, [lesson, navigate, onOpenChange]);

  if (!lesson) return null;

  const lessonDate = (() => {
    try {
      return format(parseISO(lesson.start_at), 'd MMMM, HH:mm', { locale: ru });
    } catch {
      return '';
    }
  })();
  const subtitle = [lesson.subject?.trim() || 'Занятие', lessonDate].filter(Boolean).join(' · ');

  const recordingLimitReached = recordings.length >= MAX_LESSON_RECORDINGS;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 bg-white p-0 sm:max-w-lg">
        <SheetTitle className="sr-only">Материалы занятия</SheetTitle>
        <SheetDescription className="sr-only">
          Прикрепите запись, конспект или домашнее задание к занятию
        </SheetDescription>

        {/* Header */}
        <div className="border-b border-socrat-border px-5 py-4">
          <h2 className="text-[17px] font-semibold text-slate-900">Материалы занятия</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
        </div>

        {/* Body */}
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
              />
            ))}
          </section>

          {/* ── Домашка ── */}
          <section className="space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <BookOpen className="h-4 w-4 text-accent" /> Домашка
            </h3>
            {homeworkRef ? (
              <MaterialRow
                material={homeworkRef}
                label={
                  (homeworkRef.homework_assignment_id
                    ? assignmentTitleById.get(homeworkRef.homework_assignment_id)
                    : null) || 'Домашнее задание'
                }
                deleting={deletingId === homeworkRef.id}
                onRemove={() => handleDelete(homeworkRef.id)}
              />
            ) : pickerOpen ? (
              <div className="space-y-1.5">
                {assignmentsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-4 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : (assignmentsQuery.data ?? []).length === 0 ? (
                  <p className="py-3 text-center text-sm text-slate-400">У вас пока нет домашних заданий</p>
                ) : (
                  (assignmentsQuery.data ?? []).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleAttach(a.id)}
                      disabled={attachingId !== null}
                      className="flex w-full items-center gap-3 rounded-lg border border-socrat-border bg-white px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
                      style={{ touchAction: 'manipulation' }}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                        {attachingId === a.id ? (
                          <Loader2 className="h-[18px] w-[18px] animate-spin" />
                        ) : (
                          <BookOpen className="h-[18px] w-[18px]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{a.title}</p>
                        <p className="truncate text-xs text-slate-500">{getSubjectLabel(a.subject as string)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-socrat-border bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  style={{ touchAction: 'manipulation' }}
                >
                  <BookOpen className="h-4 w-4" /> Выбрать ДЗ
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

        {/* Footer — one primary CTA */}
        <div className="border-t border-socrat-border px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
            style={{ touchAction: 'manipulation' }}
          >
            Готово
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
