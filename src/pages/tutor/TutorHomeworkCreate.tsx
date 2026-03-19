// Job: P0.1 — Собрать ДЗ по теме после урока
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, ChevronDown, ChevronUp, AlertCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useTutor, useTutorStudents, useTutorGroups, useTutorGroupMemberships } from '@/hooks/useTutor';
import {
  createTutorHomeworkAssignment,
  assignTutorHomeworkStudents,
  notifyTutorHomeworkStudents,
  uploadTutorHomeworkMaterial,
  addTutorHomeworkMaterial,
  deleteTutorHomeworkMaterial,
  deleteTutorHomeworkTaskImage,
  getTutorHomeworkAssignment,
  updateTutorHomeworkAssignment,
  getTutorHomeworkTemplate,
  createTutorHomeworkTemplate,
  type HomeworkSubject,
  type CreateAssignmentTask,
  type UpdateAssignmentTask,
  type HomeworkTemplateListItem,
} from '@/lib/tutorHomeworkApi';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import { supabase } from '@/lib/supabaseClient';

// ─── Extracted components ────────────────────────────────────────────────────
import {
  type DraftTask,
  type DraftMaterial,
  type MetaState,
  type SubmitPhase,
  type SubmitSuccessResult,
  SUBJECTS,
  createEmptyTask,
  generateUUID,
  revokeObjectUrl,
} from '@/components/tutor/homework-create/types';
import { HWTemplatePicker } from '@/components/tutor/homework-create/HWTemplatePicker';
import { HWExpandedParams } from '@/components/tutor/homework-create/HWExpandedParams';
import { HWTasksSection } from '@/components/tutor/homework-create/HWTasksSection';
import { HWMaterialsSection } from '@/components/tutor/homework-create/HWMaterialsSection';
import { HWAssignSection } from '@/components/tutor/homework-create/HWAssignSection';
import { HWActionBar } from '@/components/tutor/homework-create/HWActionBar';
import { HWSubmitSuccess } from '@/components/tutor/homework-create/HWSubmitSuccess';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert an ISO/UTC date string to a local datetime-local input value (YYYY-MM-DDTHH:mm). Safari-safe via parseISO. */
function toLocalDatetimeString(isoString: string): string {
  const d = parseISO(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Main Single-Page Constructor ───────────────────────────────────────────

function TutorHomeworkCreateContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { id: editId } = useParams<{ id?: string }>();
  const isEditMode = !!editId;
  const { tutor } = useTutor();
  const { students: tutorStudents } = useTutorStudents();
  // Always fetch groups — no step gating in single-page layout
  const { groups } = useTutorGroups(true);
  const { memberships } = useTutorGroupMemberships(true);
  const inviteWebLink = tutor?.invite_code ? getTutorInviteWebLink(tutor.invite_code) : '';
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://sokratai.ru';
  const studentLoginLink = `${appOrigin}/login`;
  const studentSignupLink = `${appOrigin}/signup`;
  const [templateLoading, setTemplateLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Meta ──
  const [meta, setMeta] = useState<MetaState>({
    title: '',
    subject: 'physics',
    topic: '',
    deadline: '',
    workflow_mode: 'guided_chat',
  });

  // Auto-generated title: «ДЗ {topic} {dd.MM}» — used when manual title is empty
  const autoTitle = useMemo(() => {
    const dateStr = format(new Date(), 'dd.MM', { locale: ru });
    return meta.topic.trim() ? `ДЗ ${meta.topic.trim()} ${dateStr}` : `ДЗ ${dateStr}`;
  }, [meta.topic]);

  // ── Tasks ──
  const [tasks, setTasks] = useState<DraftTask[]>([createEmptyTask()]);
  const tasksRef = useRef<DraftTask[]>(tasks);
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);

  // ── Deferred image deletes (edit mode: only delete after successful save) ──
  const deferredImageDeletesRef = useRef<string[]>([]);
  const handleDeferImageDelete = useCallback((storagePath: string) => {
    deferredImageDeletesRef.current.push(storagePath);
  }, []);

  // ── Assign ──
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [assignMode, setAssignMode] = useState<'student' | 'group'>('student');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyTemplate, setNotifyTemplate] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // ── Submit state ──
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');
  const createdAssignmentIdRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successResult, setSuccessResult] = useState<SubmitSuccessResult | null>(null);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (assignMode !== 'group' || !selectedGroupId) return;

    const memberTutorStudentIds = new Set(
      memberships
        .filter((m) => m.tutor_group_id === selectedGroupId && m.is_active)
        .map((m) => m.tutor_student_id),
    );

    const mappedStudentIds = tutorStudents
      .filter((s) => memberTutorStudentIds.has(s.id))
      .map((s) => s.student_id);

    setSelectedStudentIds(new Set(mappedStudentIds));
  }, [assignMode, selectedGroupId, memberships, tutorStudents]);

  useEffect(
    () => () => {
      for (const task of tasksRef.current) {
        revokeObjectUrl(task.task_image_preview_url);
      }
    },
    [],
  );

  // ── Edit mode: fetch existing assignment ──
  const editQuery = useQuery({
    queryKey: ['tutor', 'homework', 'detail', editId],
    queryFn: () => getTutorHomeworkAssignment(editId!),
    enabled: isEditMode,
    staleTime: 30_000,
  });
  const existingAssignment = editQuery.data;

  // Track whether we already prefilled to avoid re-running on refetch
  const editPrefilledRef = useRef(false);
  useEffect(() => {
    if (!isEditMode || !existingAssignment || editPrefilledRef.current) return;
    editPrefilledRef.current = true;

    const a = existingAssignment.assignment;
    setMeta({
      title: a.title,
      subject: a.subject,
      topic: a.topic ?? '',
      deadline: a.deadline ? toLocalDatetimeString(a.deadline) : '',
      workflow_mode: a.workflow_mode ?? 'classic',
    });

    setTasks(
      [...existingAssignment.tasks]
        .sort((x, y) => x.order_num - y.order_num)
        .map((t) => ({
          ...createEmptyTask(),
          id: t.id,
          localId: generateUUID(),
          task_text: t.task_text,
          task_image_path: t.task_image_url,
          correct_answer: t.correct_answer ?? '',
          rubric_text: t.rubric_text ?? '',
          max_score: t.max_score,
        })),
    );

    setMaterials(
      existingAssignment.materials.map((m) => ({
        id: m.id,
        localId: generateUUID(),
        type: m.type,
        title: m.title,
        file: null,
        url: m.url ?? '',
        uploading: false,
      })),
    );

    const assignedIds = existingAssignment.assigned_students.map((s) => s.student_id);
    setSelectedStudentIds(new Set(assignedIds));
  }, [isEditMode, existingAssignment]);

  // Store initial state snapshot for unsaved-changes comparison in edit mode
  const editInitialSnapshotRef = useRef<{ meta: MetaState; taskTexts: string; studentIds: string; materialIds: string } | null>(null);
  useEffect(() => {
    if (!isEditMode || !existingAssignment || editInitialSnapshotRef.current) return;
    const a = existingAssignment.assignment;
    editInitialSnapshotRef.current = {
      meta: {
        title: a.title,
        subject: a.subject,
        topic: a.topic ?? '',
        deadline: a.deadline ? toLocalDatetimeString(a.deadline) : '',
        workflow_mode: a.workflow_mode ?? 'classic',
      },
      taskTexts: existingAssignment.tasks.map((t) => `${t.id}|${t.task_text}|${t.correct_answer ?? ''}|${t.rubric_text ?? ''}|${t.task_image_url ?? ''}|${t.max_score}`).join(';;'),
      studentIds: existingAssignment.assigned_students.map((s) => s.student_id).sort().join(','),
      materialIds: existingAssignment.materials.map((m) => m.id).sort().join(','),
    };
  }, [isEditMode, existingAssignment]);

  // Reset refs when editId changes (navigation between different edit pages)
  useEffect(() => {
    editPrefilledRef.current = false;
    editInitialSnapshotRef.current = null;
    deferredImageDeletesRef.current = [];
  }, [editId]);

  const hasSubmissions = (existingAssignment?.submissions_summary?.total ?? 0) > 0;

  // Set of student IDs already assigned — used to lock checkboxes in edit mode
  const editExistingStudentIds = useMemo(
    () => new Set(existingAssignment?.assigned_students.map((s) => s.student_id) ?? []),
    [existingAssignment],
  );

  // ── Auto-load template from ?template_id query param ──
  const templateId = searchParams.get('template_id');
  const templateLoadedRef = useRef(false);
  useEffect(() => {
    if (!templateId || templateLoadedRef.current) return;
    templateLoadedRef.current = true;
    setTemplateLoading(true);
    getTutorHomeworkTemplate(templateId)
      .then((tpl) => {
        setMeta((m) => ({
          ...m,
          title: tpl.title,
          subject: tpl.subject,
          topic: tpl.topic ?? '',
        }));
        setTasks(
          tpl.tasks_json.map((t) => ({
            ...createEmptyTask(),
            task_text: t.task_text,
            task_image_path: t.task_image_url ?? null,
            correct_answer: t.correct_answer ?? '',
            rubric_text: t.rubric_text ?? '',
            max_score: t.max_score ?? 1,
          })),
        );
        toast.success(`Шаблон «${tpl.title}» загружен`);
      })
      .catch(() => toast.error('Не удалось загрузить шаблон'))
      .finally(() => setTemplateLoading(false));
  }, [templateId]);

  // ── Apply template from picker sheet ──
  const handleApplyTemplate = useCallback(async (tpl: HomeworkTemplateListItem) => {
    const isDirty =
      meta.title.trim().length > 0 ||
      tasks.some((t) => t.task_text.trim().length > 0);
    if (isDirty && !window.confirm('Заменить текущие данные шаблоном?')) return;

    setTemplateLoading(true);
    try {
      const full = await getTutorHomeworkTemplate(tpl.id);
      setMeta((m) => ({
        ...m,
        title: full.title,
        subject: full.subject,
        topic: full.topic ?? '',
      }));
      setTasks(
        full.tasks_json.map((t) => ({
          ...createEmptyTask(),
          task_text: t.task_text,
          task_image_path: t.task_image_url ?? null,
          correct_answer: t.correct_answer ?? '',
          rubric_text: t.rubric_text ?? '',
          max_score: t.max_score ?? 1,
        })),
      );
      toast.success(`Шаблон «${full.title}» применён`);
    } catch {
      toast.error('Не удалось загрузить шаблон');
    } finally {
      setTemplateLoading(false);
    }
  }, [meta.title, tasks]);

  // ── Unsaved changes guard ──
  const hasUnsavedChanges = useMemo(() => {
    if (submitPhase === 'done') return false;

    // Edit mode: compare against initial snapshot
    if (isEditMode) {
      const snap = editInitialSnapshotRef.current;
      if (!snap) return false; // not yet loaded
      const metaDirty =
        meta.title !== snap.meta.title ||
        meta.subject !== snap.meta.subject ||
        meta.topic !== snap.meta.topic ||
        meta.deadline !== snap.meta.deadline ||
        meta.workflow_mode !== snap.meta.workflow_mode;
      const currentTaskTexts = tasks.map((t) => `${t.id ?? ''}|${t.task_text}|${t.correct_answer}|${t.rubric_text}|${t.task_image_path ?? ''}|${t.max_score}`).join(';;');
      const tasksDirty = currentTaskTexts !== snap.taskTexts;
      const currentStudentIds = [...selectedStudentIds].sort().join(',');
      const studentsDirty = currentStudentIds !== snap.studentIds;
      const currentMaterialIds = materials.map((m) => m.id ?? m.localId).sort().join(',');
      const materialsDirty = currentMaterialIds !== snap.materialIds;
      return metaDirty || tasksDirty || studentsDirty || materialsDirty;
    }

    // Create mode: compare against defaults
    const metaDirty =
      meta.title.trim().length > 0 ||
      (meta.subject !== '' && meta.subject !== 'physics') ||
      meta.topic.trim().length > 0 ||
      meta.deadline.trim().length > 0 ||
      meta.workflow_mode !== 'guided_chat';

    const tasksDirty =
      tasks.length !== 1 ||
      tasks.some(
        (task) =>
          task.task_text.trim().length > 0 ||
          task.task_image_path !== null ||
          task.correct_answer.trim().length > 0 ||
          task.max_score !== 1,
      );

    const assignDirty =
      selectedStudentIds.size > 0 ||
      notifyEnabled !== true ||
      notifyTemplate.trim().length > 0;

    return metaDirty || tasksDirty || assignDirty;
  }, [meta, tasks, selectedStudentIds, notifyEnabled, notifyTemplate, submitPhase, isEditMode, materials]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ── Inline validation (all sections at once) ──

  const validateAll = useCallback((): boolean => {
    const errs: Record<string, string> = {};

    // Meta: subject required, title auto-generated if empty
    if (!meta.subject) errs.subject = 'Выберите предмет';
    // Soft warning: topic empty → auto-title is generic, KB picker has no hint
    if (!meta.topic.trim()) errs._topicHint = 'Укажите тему — название ДЗ и поиск в базе будут точнее';

    // Tasks
    if (tasks.length === 0) {
      errs._tasks = 'Добавьте хотя бы одну задачу';
    }
    for (let i = 0; i < tasks.length; i++) {
      if (!tasks[i].task_text.trim()) {
        errs._tasks = `Задача ${i + 1}: введите текст задачи`;
        break;
      }
      if (tasks[i].max_score < 1) {
        errs._tasks = `Задача ${i + 1}: баллы должны быть >= 1`;
        break;
      }
      if (tasks[i].uploading) {
        errs._tasks = `Задача ${i + 1}: дождитесь загрузки изображения`;
        break;
      }
    }

    // Students
    if (selectedStudentIds.size === 0) {
      errs._students = 'Выберите хотя бы одного ученика';
    }

    setErrors(errs);
    // Hint keys (e.g. _topicHint) are non-blocking soft warnings
    const blockingErrors = Object.keys(errs).filter((k) => !k.endsWith('Hint'));
    return blockingErrors.length === 0;
  }, [meta, tasks, selectedStudentIds]);

  // ── Navigation ──

  const handleNavigateBack = useCallback(() => {
    if (
      hasUnsavedChanges &&
      !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')
    ) {
      return;
    }
    navigate(isEditMode ? `/tutor/homework/${editId}` : '/tutor/homework');
  }, [hasUnsavedChanges, navigate, isEditMode, editId]);

  // ── Submit (NOT changed — same 4-phase logic) ──

  const handleSubmit = useCallback(async () => {
    if (!validateAll()) return;

    const isRetry = createdAssignmentIdRef.current !== null;
    let assignmentId = createdAssignmentIdRef.current;

    // Resolve title: manual override or auto-generated
    const resolvedTitle = meta.title.trim() || autoTitle;

    try {
      // Phase 1: create (skip if already created)
      if (!assignmentId) {
        setSubmitPhase('creating');
        const apiTasks: CreateAssignmentTask[] = tasks.map((t, i) => ({
          order_num: i + 1,
          task_text: t.task_text.trim(),
          task_image_url: t.task_image_path || t.kb_attachment_url || null,
          correct_answer: t.correct_answer.trim() || null,
          rubric_text: t.rubric_text.trim() || null,
          max_score: t.max_score,
        }));

        const result = await createTutorHomeworkAssignment({
          title: resolvedTitle,
          subject: meta.subject as HomeworkSubject,
          topic: meta.topic.trim() || null,
          deadline: meta.deadline
            ? parseISO(meta.deadline).toISOString()
            : null,
          tasks: apiTasks,
          group_id: assignMode === 'group' && selectedGroupId ? selectedGroupId : null,
          workflow_mode: meta.workflow_mode,
        });
        assignmentId = result.assignment_id;
        createdAssignmentIdRef.current = assignmentId;
      }

      // Phase 1.5: add materials
      if (materials.length > 0) {
        setSubmitPhase('adding_materials');
        for (const mat of materials) {
          try {
            let storageRef: string | undefined;
            if (mat.file) {
              const uploaded = await uploadTutorHomeworkMaterial(mat.file);
              storageRef = uploaded.storageRef;
            }
            await addTutorHomeworkMaterial(assignmentId!, {
              type: mat.type,
              title: mat.title.trim() || mat.file?.name || 'Материал',
              storage_ref: storageRef ?? null,
              url: mat.type === 'link' ? (mat.url.trim() || null) : null,
            });
          } catch (matErr) {
            console.warn('homework_material_add_failed', matErr);
            toast.warning(`Не удалось добавить материал «${mat.title}»`);
          }
        }
      }

      // Phase 1.7: link KB tasks (non-blocking)
      const kbLinkedTasks = tasks.filter((t) => t.kb_task_id);
      if (kbLinkedTasks.length > 0 && assignmentId) {
        try {
          const links = kbLinkedTasks.map((t) => ({
            homework_id: assignmentId!,
            task_id: t.kb_task_id!,
            sort_order: tasks.indexOf(t),
            task_text_snapshot: t.task_text,
            task_answer_snapshot: t.correct_answer.trim() || null,
            task_solution_snapshot: t.kb_snapshot_solution ?? null,
            snapshot_edited:
              t.task_text !== (t.kb_snapshot_text ?? '') ||
              (t.correct_answer.trim() || null) !== (t.kb_snapshot_answer ?? null),
          }));
          const { error: kbErr } = await supabase
            .from('homework_kb_tasks')
            .insert(links);
          if (kbErr) {
            if (kbErr.code === '23503') {
              for (const link of links) {
                const { error: singleErr } = await supabase
                  .from('homework_kb_tasks')
                  .insert(link);
                if (singleErr?.code === '23503') {
                  await supabase
                    .from('homework_kb_tasks')
                    .insert({ ...link, task_id: null });
                } else if (singleErr) {
                  console.warn('homework_kb_tasks per-link insert failed', singleErr);
                  toast.warning('Связь с базой знаний не сохранена');
                }
              }
            } else {
              console.warn('homework_kb_tasks insert failed', kbErr);
              toast.warning('Связь с базой знаний не сохранена');
            }
          }
        } catch (kbLinkErr) {
          console.warn('homework_kb_tasks linking error', kbLinkErr);
          toast.warning('Связь с базой знаний не сохранена');
        }
      }

      // Phase 2: assign
      setSubmitPhase('assigning');
      const assignResult = await assignTutorHomeworkStudents(
        assignmentId,
        [...selectedStudentIds],
        assignMode === 'group' && selectedGroupId ? selectedGroupId : null,
      );

      // Phase 3: notify (optional)
      let notifyResult: {
        sent: number;
        failed: number;
        failed_student_ids: string[];
        failed_by_reason?: Record<string, string>;
      } | null = null;
      if (notifyEnabled) {
        setSubmitPhase('notifying');
        try {
          notifyResult = await notifyTutorHomeworkStudents(
            assignmentId,
            notifyTemplate.trim() || undefined,
          );
        } catch (notifyErr) {
          console.warn('homework_notify_error', notifyErr);
          notifyResult = {
            sent: 0,
            failed: selectedStudentIds.size,
            failed_student_ids: [...selectedStudentIds],
            failed_by_reason: Object.fromEntries(
              [...selectedStudentIds].map((id) => [id, 'telegram_send_error']),
            ),
          };
        }
      }

      // Phase: save as template (optional)
      if (saveAsTemplate) {
        try {
          await createTutorHomeworkTemplate({
            title: resolvedTitle,
            subject: meta.subject as HomeworkSubject,
            topic: meta.topic.trim() || null,
            tasks_json: tasks.map((t) => ({
              task_text: t.task_text.trim(),
              task_image_url: t.task_image_path || t.kb_attachment_url || null,
              correct_answer: t.correct_answer.trim() || null,
              rubric_text: t.rubric_text.trim() || null,
              max_score: t.max_score,
            })),
          });
          void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
        } catch (tplErr) {
          console.warn('homework_template_save_failed', tplErr);
          toast.warning('Не удалось сохранить как шаблон');
        }
      }

      // Done
      setSubmitPhase('done');

      void queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'assignments'],
      });

      // Build per-student delivery status for inline success view
      const noTelegramIds = new Set(assignResult.students_without_telegram ?? []);
      const failedNotifyIds = new Set(notifyResult?.failed_student_ids ?? []);

      const studentStatuses = [...selectedStudentIds].map((profileId) => {
        const ts = tutorStudents.find((s) => s.student_id === profileId);
        const name =
          ts?.profiles?.username ||
          (ts?.profiles?.telegram_username ? `@${ts.profiles.telegram_username}` : profileId);
        const hasTelegram = !noTelegramIds.has(profileId);
        const notified = hasTelegram && notifyEnabled && notifyResult !== null && !failedNotifyIds.has(profileId);
        const deliveryFailed = hasTelegram && notifyEnabled && notifyResult !== null && failedNotifyIds.has(profileId);
        return { studentId: profileId, name, hasTelegram, notified, deliveryFailed };
      });

      const groupName =
        assignMode === 'group' && selectedGroupId
          ? groups.find((g) => g.id === selectedGroupId)?.name
          : undefined;

      setSuccessResult({
        assignmentId,
        title: resolvedTitle,
        topic: meta.topic.trim(),
        taskCount: tasks.length,
        assignedCount: assignResult.added,
        groupName,
        studentStatuses,
        inviteWebLink,
        studentLoginLink,
      });
    } catch (err) {
      setSubmitPhase('idle');

      const message =
        err instanceof Error ? err.message : 'Неизвестная ошибка';
      toast.error(`Ошибка: ${message}`);
      if (isRetry) {
        toast.info('Можно попробовать ещё раз — ДЗ уже создано, повторим назначение.');
      }
    }
  }, [
    validateAll,
    autoTitle,
    tasks,
    meta,
    selectedStudentIds,
    tutorStudents,
    assignMode,
    selectedGroupId,
    groups,
    notifyEnabled,
    notifyTemplate,
    materials,
    saveAsTemplate,
    navigate,
    queryClient,
    inviteWebLink,
    studentLoginLink,
  ]);

  // ── Edit submit (PUT) ──

  const handleEditSubmit = useCallback(async () => {
    if (!editId || !validateAll()) return;

    const resolvedTitle = meta.title.trim() || autoTitle;

    try {
      setSubmitPhase('saving');

      // Build tasks array for PUT (backend handles diff via id presence)
      const apiTasks: UpdateAssignmentTask[] = tasks.map((t, i) => ({
        ...(t.id ? { id: t.id } : {}),
        order_num: i + 1,
        task_text: t.task_text.trim(),
        task_image_url: t.task_image_path || t.kb_attachment_url || null,
        correct_answer: t.correct_answer.trim() || null,
        rubric_text: t.rubric_text.trim() || null,
        max_score: t.max_score,
      }));

      await updateTutorHomeworkAssignment(editId, {
        title: resolvedTitle,
        subject: meta.subject as HomeworkSubject,
        topic: meta.topic.trim() || null,
        deadline: meta.deadline ? parseISO(meta.deadline).toISOString() : null,
        workflow_mode: meta.workflow_mode,
        tasks: apiTasks,
      });

      // Material diff: add new, delete removed
      if (existingAssignment) {
        const existingMaterialIds = new Set(existingAssignment.materials.map((m) => m.id));
        const currentMaterialIds = new Set(materials.filter((m) => m.id).map((m) => m.id!));

        // Delete removed materials
        for (const mid of existingMaterialIds) {
          if (!currentMaterialIds.has(mid)) {
            try {
              await deleteTutorHomeworkMaterial(editId, mid);
            } catch (err) {
              console.warn('homework_material_delete_failed', err);
            }
          }
        }

        // Add new materials (no id = new)
        for (const mat of materials) {
          if (mat.id) continue; // existing, skip
          try {
            let storageRef: string | undefined;
            if (mat.file) {
              const uploaded = await uploadTutorHomeworkMaterial(mat.file);
              storageRef = uploaded.storageRef;
            }
            await addTutorHomeworkMaterial(editId, {
              type: mat.type,
              title: mat.title.trim() || mat.file?.name || 'Материал',
              storage_ref: storageRef ?? null,
              url: mat.type === 'link' ? (mat.url.trim() || null) : null,
            });
          } catch (matErr) {
            console.warn('homework_material_add_failed', matErr);
            toast.warning(`Не удалось добавить материал «${mat.title}»`);
          }
        }

        // Add new students (append-only)
        const existingStudentIds = new Set(existingAssignment.assigned_students.map((s) => s.student_id));
        const newStudentIds = [...selectedStudentIds].filter((id) => !existingStudentIds.has(id));
        if (newStudentIds.length > 0) {
          await assignTutorHomeworkStudents(editId, newStudentIds);
        }
      }

      // Flush deferred image deletes (safe — save succeeded)
      for (const path of deferredImageDeletesRef.current) {
        void deleteTutorHomeworkTaskImage(path);
      }
      deferredImageDeletesRef.current = [];

      // Done — invalidate caches and navigate back
      setSubmitPhase('done');
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'assignments'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'detail', editId] });
      toast.success('Изменения сохранены');
      navigate(`/tutor/homework/${editId}`);
    } catch (err) {
      setSubmitPhase('idle');
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';

      // Handle DESTRUCTIVE_CHANGE specifically
      if (message.includes('DESTRUCTIVE_CHANGE') || message.includes('Cannot add or remove tasks')) {
        toast.error('Нельзя добавлять или удалять задачи — ученики уже отправили ответы. Можно только редактировать существующие задачи.');
      } else {
        toast.error(`Ошибка: ${message}`);
      }
    }
  }, [editId, validateAll, autoTitle, tasks, meta, materials, selectedStudentIds, existingAssignment, queryClient, navigate]);

  // ── "Создать ещё" — reset form, preserve group selection ──

  const handleCreateAnother = useCallback(() => {
    // Revoke blob URLs from current tasks to prevent memory leaks
    for (const task of tasksRef.current) {
      revokeObjectUrl(task.task_image_preview_url);
    }

    // If group mode, recompute student IDs directly (effect won't re-fire — deps unchanged)
    if (assignMode === 'group' && selectedGroupId) {
      const memberTutorStudentIds = new Set(
        memberships
          .filter((m) => m.tutor_group_id === selectedGroupId && m.is_active)
          .map((m) => m.tutor_student_id),
      );
      const mappedStudentIds = tutorStudents
        .filter((s) => memberTutorStudentIds.has(s.id))
        .map((s) => s.student_id);
      setSelectedStudentIds(new Set(mappedStudentIds));
    } else {
      setSelectedStudentIds(new Set());
    }

    setMeta({ title: '', subject: 'physics', topic: '', deadline: '', workflow_mode: 'guided_chat' });
    setTasks([createEmptyTask()]);
    setMaterials([]);
    setNotifyEnabled(true);
    setNotifyTemplate('');
    setSaveAsTemplate(false);
    setSubmitPhase('idle');
    createdAssignmentIdRef.current = null;
    setErrors({});
    setSuccessResult(null);
    setShowAdvanced(false);
    // assignMode and selectedGroupId intentionally preserved
  }, [assignMode, selectedGroupId, memberships, tutorStudents]);

  const isSubmitting = submitPhase !== 'idle' && submitPhase !== 'done';

  const submitLabel = (() => {
    switch (submitPhase) {
      case 'saving':
        return 'Сохраняем...';
      case 'creating':
        return 'Создаём ДЗ...';
      case 'adding_materials':
        return 'Добавляем материалы...';
      case 'assigning':
        return 'Назначаем учеников...';
      case 'notifying':
        return 'Отправляем уведомления...';
      default:
        if (isEditMode) return 'Сохранить изменения';
        return notifyEnabled ? 'Отправить ДЗ' : 'Создать ДЗ';
    }
  })();

  // ── Inline success state (Phase 4) — create mode only ──
  if (successResult && !isEditMode) {
    return (
      <TutorLayout>
        <HWSubmitSuccess
          result={successResult}
          onCreateAnother={handleCreateAnother}
        />
      </TutorLayout>
    );
  }

  // ── Edit mode: loading state ──
  if (isEditMode && editQuery.isLoading) {
    return (
      <TutorLayout>
        <div className="space-y-6 max-w-2xl mx-auto pb-24 md:pb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleNavigateBack}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <h1 className="text-2xl font-bold flex-1">Редактирование ДЗ</h1>
          </div>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </TutorLayout>
    );
  }

  // ── Edit mode: error state ──
  if (isEditMode && editQuery.isError) {
    return (
      <TutorLayout>
        <div className="space-y-6 max-w-2xl mx-auto pb-24 md:pb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleNavigateBack}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <h1 className="text-2xl font-bold flex-1">Редактирование ДЗ</h1>
          </div>
          <div className="text-center py-12 text-muted-foreground">
            <p>Не удалось загрузить домашнее задание.</p>
            <Button variant="outline" className="mt-4" onClick={() => void editQuery.refetch()}>
              Попробовать снова
            </Button>
          </div>
        </div>
      </TutorLayout>
    );
  }

  return (
    <TutorLayout>
      <div className="space-y-6 max-w-2xl mx-auto pb-24 md:pb-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleNavigateBack} disabled={isSubmitting}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          <h1 className="text-2xl font-bold flex-1">
            {isEditMode ? 'Редактирование ДЗ' : 'Создание ДЗ'}
          </h1>
          {!isEditMode && !isSubmitting && (
            <HWTemplatePicker onSelect={handleApplyTemplate} />
          )}
          {templateLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Warning banner: editing active (sent) HW */}
        {isEditMode && existingAssignment?.assignment.status === 'active' && (
          <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 p-4 rounded-xl text-amber-800">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">ДЗ уже отправлено ученикам</p>
              <p className="text-sm mt-1">Изменения будут видны всем назначенным ученикам. Будьте осторожны с удалением задач.</p>
            </div>
          </div>
        )}

        {/* ── L0: Always visible ── */}

        {/* Topic + Subject (L0 — always visible) */}
        <section className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hw-topic">Тема</Label>
            <Input
              id="hw-topic"
              placeholder="Кинематика, законы Ньютона..."
              value={meta.topic}
              onChange={(e) => setMeta({ ...meta, topic: e.target.value })}
              className="text-base"
            />
            {errors._topicHint && !meta.topic.trim() && (
              <p className="text-xs text-amber-600">{errors._topicHint}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="hw-subject">Предмет *</Label>
            <Select
              value={meta.subject}
              onValueChange={(v) => setMeta({ ...meta, subject: v as HomeworkSubject })}
            >
              <SelectTrigger id="hw-subject" className="text-base">
                <SelectValue placeholder="Выберите предмет" />
              </SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.subject && <p className="text-sm text-destructive">{errors.subject}</p>}
          </div>
        </section>

        {/* Recipients (L0) */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Кому назначить</h2>
          <HWAssignSection
            selectedIds={selectedStudentIds}
            onChangeSelected={setSelectedStudentIds}
            notifyEnabled={notifyEnabled}
            onNotifyChange={setNotifyEnabled}
            notifyTemplate={notifyTemplate}
            onTemplateChange={setNotifyTemplate}
            errors={errors}
            assignMode={assignMode}
            onAssignModeChange={setAssignMode}
            selectedGroupId={selectedGroupId}
            onGroupIdChange={setSelectedGroupId}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            inviteWebLink={inviteWebLink}
            studentLoginLink={studentLoginLink}
            studentSignupLink={studentSignupLink}
            existingStudentIds={isEditMode ? editExistingStudentIds : undefined}
            hideNotify={isEditMode}
          />
        </section>

        {/* Tasks (L0) */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Задачи</h2>
          <HWTasksSection
            tasks={tasks}
            onChange={setTasks}
            errors={errors}
            topicHint={meta.topic}
            disableExistingTaskRemove={isEditMode && hasSubmissions}
            disableTaskAdd={isEditMode && hasSubmissions}
            onDeferImageDelete={isEditMode ? handleDeferImageDelete : undefined}
            confirmOnRemove={isEditMode && existingAssignment?.assignment.status === 'active'}
          />
        </section>

        {/* ── L1: Collapsible advanced params ── */}

        <section>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showAdvanced ? 'Скрыть параметры' : 'Расширенные параметры'}
            {/* Dot indicator: show when L1 has user data but collapsed */}
            {!showAdvanced && (meta.title.trim() || meta.deadline.trim() || meta.workflow_mode !== 'guided_chat' || materials.length > 0) && (
              <span className="inline-block w-2 h-2 rounded-full bg-primary" />
            )}
          </button>

          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: showAdvanced ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="pt-4 space-y-6">
                <HWExpandedParams
                  meta={meta}
                  onChange={setMeta}
                  errors={errors}
                  autoTitle={autoTitle}
                />

                <HWMaterialsSection
                  materials={materials}
                  onChange={setMaterials}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Action bar (sticky on mobile, inline on desktop) */}
        <HWActionBar
          onSubmit={isEditMode ? handleEditSubmit : handleSubmit}
          isSubmitting={isSubmitting}
          submitPhase={submitPhase}
          submitLabel={submitLabel}
          notifyEnabled={notifyEnabled}
          hasMaterials={materials.length > 0}
          saveAsTemplate={saveAsTemplate}
          onSaveAsTemplateChange={setSaveAsTemplate}
          isEditMode={isEditMode}
        />
      </div>
    </TutorLayout>
  );
}

// ─── Export with guard ───────────────────────────────────────────────────────

export default function TutorHomeworkCreate() {
  return (
    <TutorGuard>
      <TutorHomeworkCreateContent />
    </TutorGuard>
  );
}
