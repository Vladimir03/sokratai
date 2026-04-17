// Job: P0.1 — Собрать ДЗ по теме после урока
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  getHomeworkImageSignedUrl,
  type HomeworkSubject,
  type ModernHomeworkSubject,
  type CreateAssignmentTask,
  type UpdateAssignmentTask,
  type HomeworkTemplateListItem,
  type TutorHomeworkAssignmentDetails,
  HomeworkApiError,
} from '@/lib/tutorHomeworkApi';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import { supabase } from '@/lib/supabaseClient';
import { getSubjectLabel } from '@/types/homework';

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

function buildTaskSignature(tasks: Array<{
  id?: string | null;
  order_num?: number | null;
  task_text?: string | null;
  task_image_url?: string | null;
  task_image_path?: string | null;
  correct_answer?: string | null;
  rubric_text?: string | null;
  rubric_image_urls?: string | null;
  rubric_image_paths?: string | null;
  solution_text?: string | null;
  solution_image_urls?: string | null;
  solution_image_paths?: string | null;
  max_score?: number | null;
  check_format?: string | null;
}>): string {
  return JSON.stringify(
    tasks.map((task, index) => ({
      index,
      id: task.id ?? null,
      order_num: task.order_num ?? index + 1,
      task_text: task.task_text ?? '',
      task_image_url: task.task_image_url ?? task.task_image_path ?? null,
      correct_answer: task.correct_answer ?? null,
      rubric_text: task.rubric_text ?? null,
      rubric_image_urls: task.rubric_image_urls ?? task.rubric_image_paths ?? null,
      solution_text: task.solution_text ?? null,
      solution_image_urls: task.solution_image_urls ?? task.solution_image_paths ?? null,
      max_score: task.max_score ?? 1,
      check_format: task.check_format ?? 'short_answer',
    })),
  );
}

function buildMaterialSignature(materials: Array<{
  id?: string | null;
  localId?: string | null;
  type?: string | null;
  title?: string | null;
  url?: string | null;
  file?: File | null;
}>): string {
  return JSON.stringify(
    materials.map((material, index) => ({
      index,
      id: material.id ?? null,
      type: material.type ?? null,
      title: material.title ?? '',
      url: material.url ?? '',
      file_name: material.file?.name ?? null,
    })),
  );
}

type EditSnapshot = {
  meta: MetaState;
  taskSignature: string;
  studentIds: string;
  materialSignature: string;
};

function buildEditSnapshot(assignment: TutorHomeworkAssignmentDetails): EditSnapshot {
  const a = assignment.assignment;
  return {
    meta: {
      title: a.title,
      subject: a.subject,
      deadline: a.deadline ? toLocalDatetimeString(a.deadline) : '',
      disable_ai_bootstrap: a.disable_ai_bootstrap ?? true,
      exam_type: (a.exam_type as 'ege' | 'oge') ?? 'ege',
    },
    taskSignature: buildTaskSignature(assignment.tasks),
    studentIds: assignment.assigned_students.map((s) => s.student_id).sort().join(','),
    materialSignature: buildMaterialSignature(assignment.materials),
  };
}

function buildEditDiffState(params: {
  snapshot: EditSnapshot;
  meta: MetaState;
  tasks: DraftTask[];
  materials: DraftMaterial[];
  selectedStudentIds: Set<string>;
  editExistingStudentIds: Set<string>;
}) {
  const {
    snapshot,
    meta,
    tasks,
    materials,
    selectedStudentIds,
    editExistingStudentIds,
  } = params;

  const metaDirty =
    meta.title !== snapshot.meta.title ||
    meta.subject !== snapshot.meta.subject ||
    meta.deadline !== snapshot.meta.deadline ||
    (meta.disable_ai_bootstrap ?? true) !== (snapshot.meta.disable_ai_bootstrap ?? true) ||
    (meta.exam_type ?? 'ege') !== (snapshot.meta.exam_type ?? 'ege');

  const tasksDirty = buildTaskSignature(
    tasks.map((task, index) => ({
      id: task.id ?? null,
      order_num: index + 1,
      task_text: task.task_text,
      task_image_path: task.task_image_path,
      correct_answer: task.correct_answer,
      rubric_text: task.rubric_text,
      rubric_image_paths: task.rubric_image_paths,
      solution_text: task.solution_text,
      solution_image_paths: task.solution_image_paths,
      max_score: task.max_score,
      check_format: task.check_format,
    })),
  ) !== snapshot.taskSignature;

  const materialsDirty = buildMaterialSignature(materials) !== snapshot.materialSignature;

  const newStudentIds = [...selectedStudentIds]
    .filter((id) => !editExistingStudentIds.has(id))
    .sort();
  const removedExistingStudentIds = [...editExistingStudentIds]
    .filter((id) => !selectedStudentIds.has(id))
    .sort();

  return {
    metaDirty,
    tasksDirty,
    materialsDirty,
    newStudentIds,
    newStudentsDirty: newStudentIds.length > 0,
    removedExistingStudentIds,
    unsupportedStudentRemoval: removedExistingStudentIds.length > 0,
  };
}

function hasKbLinkDraft(task: DraftTask): boolean {
  return (
    task.kb_task_id !== undefined ||
    task.kb_snapshot_text !== undefined ||
    task.kb_snapshot_answer !== undefined ||
    task.kb_snapshot_solution !== undefined ||
    task.kb_snapshot_edited !== undefined ||
    task.kb_snapshot_solution_image_refs !== undefined ||
    task.kb_source_label !== undefined
  );
}

async function syncHomeworkKbLinks(
  assignmentId: string,
  draftTasks: DraftTask[],
): Promise<void> {
  const { error: deleteErr } = await supabase
    .from('homework_kb_tasks')
    .delete()
    .eq('homework_id', assignmentId);

  if (deleteErr) {
    throw deleteErr;
  }

  const links = draftTasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => hasKbLinkDraft(task))
    .map(({ task, index }) => ({
      homework_id: assignmentId,
      task_id: task.kb_task_id ?? null,
      sort_order: index,
      task_text_snapshot: task.kb_snapshot_text ?? task.task_text,
      task_answer_snapshot: task.kb_snapshot_answer ?? null,
      task_solution_snapshot: task.kb_snapshot_solution ?? null,
      snapshot_edited:
        task.kb_snapshot_edited ??
        (
          task.task_text !== (task.kb_snapshot_text ?? '') ||
          (task.correct_answer.trim() || null) !== (task.kb_snapshot_answer ?? null)
        ),
    }));

  if (links.length === 0) return;

  const { error: insertErr } = await supabase
    .from('homework_kb_tasks')
    .insert(links);

  if (!insertErr) return;

  if (insertErr.code !== '23503') {
    throw insertErr;
  }

  for (const link of links) {
    const { error: singleErr } = await supabase
      .from('homework_kb_tasks')
      .insert(link);

    if (singleErr?.code === '23503') {
      const { error: fallbackErr } = await supabase
        .from('homework_kb_tasks')
        .insert({ ...link, task_id: null });
      if (fallbackErr) throw fallbackErr;
    } else if (singleErr) {
      throw singleErr;
    }
  }
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
    deadline: '',
    disable_ai_bootstrap: true,
    exam_type: 'ege',
  });

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
  const editExistingStudentIds = useMemo(
    () => new Set(existingAssignment?.assigned_students.map((s) => s.student_id) ?? []),
    [existingAssignment],
  );
  const [editInitialSnapshot, setEditInitialSnapshot] = useState<EditSnapshot | null>(null);
  const isEditSnapshotReady = !isEditMode || editInitialSnapshot !== null;

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

    setSelectedStudentIds(
      isEditMode
        ? new Set([...editExistingStudentIds, ...mappedStudentIds])
        : new Set(mappedStudentIds),
    );
  }, [assignMode, selectedGroupId, memberships, tutorStudents, isEditMode, editExistingStudentIds]);

  // Track whether we already prefilled to avoid re-running on refetch
  const editPrefilledRef = useRef(false);

  // Reset prefill ref + snapshot + deferred deletes when editId changes
  // (navigation between different edit pages).
  //
  // MUST be declared BEFORE the prefill effect below. Both effects fire on
  // mount in declaration order. If reset ran AFTER prefill, it would clobber
  // the freshly-set snapshot in the same commit cycle (React batches state
  // updates from effects; last setEditInitialSnapshot wins) — leaving
  // isEditSnapshotReady=false forever whenever existingAssignment is already
  // in the react-query cache (typical flow: detail → edit within staleTime).
  // Result: button stuck on "Подготавливаем..." until full page refresh.
  useEffect(() => {
    editPrefilledRef.current = false;
    setEditInitialSnapshot(null);
    deferredImageDeletesRef.current = [];
  }, [editId]);

  useEffect(() => {
    if (!isEditMode || !existingAssignment || editPrefilledRef.current) return;
    editPrefilledRef.current = true;

    const a = existingAssignment.assignment;
    setMeta({
      title: a.title,
      subject: a.subject,
      deadline: a.deadline ? toLocalDatetimeString(a.deadline) : '',
      disable_ai_bootstrap: a.disable_ai_bootstrap ?? true,
      exam_type: (a.exam_type as 'ege' | 'oge') ?? 'ege',
    });

    const newTasks = [...existingAssignment.tasks]
      .sort((x, y) => x.order_num - y.order_num)
      .map((t) => ({
        ...createEmptyTask(),
        id: t.id,
        localId: generateUUID(),
        task_text: t.task_text,
        task_image_path: t.task_image_url,
        correct_answer: t.correct_answer ?? '',
        rubric_text: t.rubric_text ?? '',
        rubric_image_paths: t.rubric_image_urls ?? null,
        solution_text: t.solution_text ?? '',
        solution_image_paths: t.solution_image_urls ?? null,
        max_score: t.max_score,
        check_format: t.check_format ?? 'short_answer',
        kb_task_id: t.kb_task_id ?? undefined,
        kb_snapshot_text: t.kb_snapshot_text ?? undefined,
        kb_snapshot_answer: t.kb_snapshot_answer ?? undefined,
        kb_snapshot_solution: t.kb_snapshot_solution ?? undefined,
        kb_snapshot_edited: t.kb_snapshot_edited ?? undefined,
        kb_snapshot_solution_image_refs: t.kb_snapshot_solution_image_refs ?? undefined,
        kb_source_label: t.kb_source_label ?? undefined,
      }));

    setTasks(newTasks);

    // Resolve storage:// refs to signed preview URLs
    Promise.all(
      newTasks.map(async (t, i) => {
        if (t.task_image_path) {
          const url = await getHomeworkImageSignedUrl(t.task_image_path);
          if (url) newTasks[i] = { ...newTasks[i], task_image_preview_url: url };
        }
      }),
    ).then(() => setTasks([...newTasks]));

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
    setEditInitialSnapshot(buildEditSnapshot(existingAssignment));
  }, [isEditMode, existingAssignment]);

  // Lock task add/remove as soon as any student has interacted with the
  // assignment (guided thread has at least one user message), not only when
  // a thread is fully completed. This matches the backend destructive-change
  // gate in PUT /assignments/:id and prevents "UI allows edit → save returns
  // 400 DESTRUCTIVE_CHANGE" mismatches.
  const hasSubmissions =
    existingAssignment?.submissions_summary?.has_interactions === true
    || (existingAssignment?.submissions_summary?.total ?? 0) > 0;

  const editDiffState = useMemo(() => {
    if (!isEditMode) return null;
    const snap = editInitialSnapshot;
    if (!snap) return null;
    return buildEditDiffState({
      snapshot: snap,
      meta,
      tasks,
      materials,
      selectedStudentIds,
      editExistingStudentIds,
    });
  }, [isEditMode, meta, tasks, materials, selectedStudentIds, editExistingStudentIds, editInitialSnapshot]);

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
        }));
        setTasks(
          tpl.tasks_json.map((t) => ({
            ...createEmptyTask(),
            task_text: t.task_text,
            task_image_path: t.task_image_url ?? null,
            correct_answer: t.correct_answer ?? '',
            rubric_text: t.rubric_text ?? '',
            rubric_image_paths: t.rubric_image_urls ?? null,
            solution_text: t.solution_text ?? '',
            solution_image_paths: t.solution_image_urls ?? null,
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
      }));
      setTasks(
        full.tasks_json.map((t) => ({
          ...createEmptyTask(),
          task_text: t.task_text,
          task_image_path: t.task_image_url ?? null,
          correct_answer: t.correct_answer ?? '',
          rubric_text: t.rubric_text ?? '',
          rubric_image_paths: t.rubric_image_urls ?? null,
          solution_text: t.solution_text ?? '',
          solution_image_paths: t.solution_image_urls ?? null,
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
      if (!isEditSnapshotReady) return false;
      if (!editDiffState) return false; // not yet loaded
      return (
        editDiffState.metaDirty ||
        editDiffState.tasksDirty ||
        editDiffState.materialsDirty ||
        editDiffState.newStudentsDirty ||
        editDiffState.unsupportedStudentRemoval
      );
    }

    // Create mode: compare against defaults
    const metaDirty =
      meta.title.trim().length > 0 ||
      (meta.subject !== '' && meta.subject !== 'physics') ||
      meta.deadline.trim().length > 0 ||
      !(meta.disable_ai_bootstrap ?? true);

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
  }, [meta, tasks, selectedStudentIds, notifyEnabled, notifyTemplate, submitPhase, isEditMode, materials, editDiffState, isEditSnapshotReady]);

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

    // Meta: title and subject required
    if (!meta.title.trim()) errs.title = 'Укажите название';
    if (!meta.subject) errs.subject = 'Выберите предмет';

    // Tasks
    if (tasks.length === 0) {
      errs._tasks = 'Добавьте хотя бы одну задачу';
    }
    for (let i = 0; i < tasks.length; i++) {
      if (!tasks[i].task_text.trim() && !tasks[i].task_image_path) {
        errs._tasks = `Задача ${i + 1}: введите текст задачи или прикрепите фото`;
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

    // First-error scroll target: title → subject → tasks → students.
    // Schedule after state flush so the error message is in the DOM and the
    // input has its border-red applied; getElementById is Safari-safe.
    const firstErrorId = errs.title
      ? 'hw-title'
      : errs.subject
        ? 'hw-subject'
        : errs._tasks
          ? 'hw-tasks-section'
          : errs._students
            ? 'hw-recipients-section'
            : null;
    if (firstErrorId) {
      setTimeout(() => {
        const el = document.getElementById(firstErrorId);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (firstErrorId === 'hw-title') {
          (el as HTMLInputElement).focus({ preventScroll: true });
        }
      }, 0);
    }

    return Object.keys(errs).length === 0;
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

    // Title is required (validated above) — use trimmed value as-is.
    const resolvedTitle = meta.title.trim();

    try {
      // Phase 1: create (skip if already created)
      if (!assignmentId) {
        setSubmitPhase('creating');
        const apiTasks: CreateAssignmentTask[] = tasks.map((t, i) => ({
          order_num: i + 1,
          task_text: t.task_text.trim() || '[Задача на фото]',
          task_image_url: t.task_image_path ?? null,
          correct_answer: t.correct_answer.trim() || null,
          rubric_text: t.rubric_text.trim() || null,
          rubric_image_urls: t.rubric_image_paths ?? null,
          solution_text: t.solution_text.trim() || null,
          solution_image_urls: t.solution_image_paths ?? null,
          max_score: t.max_score,
          check_format: t.check_format,
        }));

        const result = await createTutorHomeworkAssignment({
          title: resolvedTitle,
          subject: meta.subject as ModernHomeworkSubject,
          deadline: meta.deadline
            ? parseISO(meta.deadline).toISOString()
            : null,
          tasks: apiTasks,
          group_id: assignMode === 'group' && selectedGroupId ? selectedGroupId : null,
          disable_ai_bootstrap: meta.disable_ai_bootstrap ?? true,
          exam_type: meta.exam_type ?? 'ege',
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
      if (assignmentId) {
        try {
          await syncHomeworkKbLinks(assignmentId, tasks);
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
            { messageTemplate: notifyTemplate.trim() || undefined },
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
            subject: meta.subject as ModernHomeworkSubject,
            tasks_json: tasks.map((t) => ({
              task_text: t.task_text.trim(),
              task_image_url: t.task_image_path ?? null,
              correct_answer: t.correct_answer.trim() || null,
              rubric_text: t.rubric_text.trim() || null,
              rubric_image_urls: t.rubric_image_paths ?? null,
              solution_text: t.solution_text.trim() || null,
              solution_image_urls: t.solution_image_paths ?? null,
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

      // Build per-student delivery status for inline success view (channel-agnostic)
      const noTelegramIds = new Set(assignResult.students_without_telegram ?? []);
      const failedNotifyIds = new Set(notifyResult?.failed_student_ids ?? []);
      const failedReasons = notifyResult?.failed_by_reason ?? {};

      const studentStatuses = [...selectedStudentIds].map((profileId) => {
        const ts = tutorStudents.find((s) => s.student_id === profileId);
        const name =
          ts?.profiles?.username ||
          (ts?.profiles?.telegram_username ? `@${ts.profiles.telegram_username}` : profileId);
        const hasTelegram = !noTelegramIds.has(profileId);
        const notified = notifyEnabled && notifyResult !== null && !failedNotifyIds.has(profileId);
        const deliveryFailed = notifyEnabled && notifyResult !== null && failedNotifyIds.has(profileId);
        const noChannels = deliveryFailed && failedReasons[profileId] === 'no_channels_available';
        return { studentId: profileId, name, hasTelegram, notified, deliveryFailed, noChannels };
      });

      const groupName =
        assignMode === 'group' && selectedGroupId
          ? groups.find((g) => g.id === selectedGroupId)?.name
          : undefined;

      setSuccessResult({
        assignmentId,
        title: resolvedTitle,
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
    if (!existingAssignment) {
      toast.error('ДЗ ещё загружается. Попробуйте сохранить через пару секунд.');
      return;
    }
    if (!isEditSnapshotReady || !editDiffState) {
      toast.error('ДЗ ещё подготавливается. Попробуйте сохранить через секунду.');
      return;
    }
    if (editDiffState.unsupportedStudentRemoval) {
      toast.error('В этой версии нельзя снимать уже назначенных учеников с существующего ДЗ.');
      return;
    }
    if (
      !editDiffState.metaDirty &&
      !editDiffState.tasksDirty &&
      !editDiffState.materialsDirty &&
      !editDiffState.newStudentsDirty
    ) {
      toast.info('Нет изменений для сохранения.');
      return;
    }

    const resolvedTitle = meta.title.trim();

    try {
      let notifyResult: {
        sent: number;
        failed: number;
        failed_student_ids: string[];
        failed_by_reason?: Record<string, string>;
      } | null = null;
      let notifyRequestFailed = false;

      if (editDiffState.metaDirty || editDiffState.tasksDirty) {
        setSubmitPhase('saving');
        const patch: {
          title?: string;
          subject?: string;
          deadline?: string | null;
          disable_ai_bootstrap?: boolean;
          exam_type?: 'ege' | 'oge';
          tasks?: UpdateAssignmentTask[];
        } = {};

        if (editDiffState.metaDirty) {
          patch.title = resolvedTitle;
          patch.subject = meta.subject as HomeworkSubject;
          patch.deadline = meta.deadline ? parseISO(meta.deadline).toISOString() : null;
          patch.disable_ai_bootstrap = meta.disable_ai_bootstrap ?? true;
          patch.exam_type = meta.exam_type ?? 'ege';
        }

        if (editDiffState.tasksDirty) {
          patch.tasks = tasks.map((t, i) => ({
            ...(t.id ? { id: t.id } : {}),
            order_num: i + 1,
            task_text: t.task_text.trim() || '[Задача на фото]',
            task_image_url: t.task_image_path ?? null,
            correct_answer: t.correct_answer.trim() || null,
            rubric_text: t.rubric_text.trim() || null,
            rubric_image_urls: t.rubric_image_paths ?? null,
            solution_text: t.solution_text.trim() || null,
            solution_image_urls: t.solution_image_paths ?? null,
            max_score: t.max_score,
            check_format: t.check_format,
          }));
        }

        await updateTutorHomeworkAssignment(editId, patch);
      }

      if (editDiffState.tasksDirty && !hasSubmissions) {
        try {
          await syncHomeworkKbLinks(editId, tasks);
        } catch (kbLinkErr) {
          console.warn('homework_kb_tasks edit sync failed', kbLinkErr);
          toast.warning('Связь с базой знаний обновилась не полностью.');
        }
      }

      // Material diff: add new, delete removed
      if (editDiffState.materialsDirty) {
        setSubmitPhase('saving');
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
      }

      if (editDiffState.newStudentsDirty) {
        setSubmitPhase('assigning');
        await assignTutorHomeworkStudents(editId, editDiffState.newStudentIds);

        setSubmitPhase('notifying');
        try {
          notifyResult = await notifyTutorHomeworkStudents(editId, {
            studentIds: editDiffState.newStudentIds,
          });
        } catch (notifyErr) {
          notifyRequestFailed = true;
          console.warn('homework_notify_new_students_failed', notifyErr);
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
      if (notifyRequestFailed) {
        toast.warning('Новых учеников добавили, но автоматически отправить ДЗ не удалось.');
      } else if ((notifyResult?.failed ?? 0) > 0) {
        toast.warning('Новых учеников добавили, но уведомления отправились не всем.');
      }
      navigate(`/tutor/homework/${editId}`);
    } catch (err) {
      setSubmitPhase('idle');
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';

      if (err instanceof HomeworkApiError && err.code === 'TASK_REORDER_FAILED') {
        toast.error('Не удалось сохранить порядок задач. Попробуйте ещё раз.');
      } else if (err instanceof HomeworkApiError && err.code === 'DESTRUCTIVE_CHANGE') {
        toast.error('Нельзя добавлять или удалять задачи — ученики уже отправили ответы. Можно только редактировать существующие задачи.');
      } else {
        toast.error(`Ошибка: ${message}`);
      }
    }
  }, [editId, validateAll, existingAssignment, editDiffState, hasSubmissions, isEditSnapshotReady, meta, materials, navigate, queryClient, tasks]);

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

    setMeta({ title: '', subject: 'physics', deadline: '', disable_ai_bootstrap: true, exam_type: 'ege' });
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
  const hasLegacySelectedSubject =
    meta.subject !== '' && !SUBJECTS.some((subject) => subject.value === meta.subject);

  const submitLabel = (() => {
    if (isEditMode && !isEditSnapshotReady) {
      return 'Подготавливаем...';
    }
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
        if (isEditMode) {
          return editDiffState?.newStudentsDirty
            ? 'Сохранить и отправить новым'
            : 'Сохранить изменения';
        }
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

        {/* Title (L0 — required) */}
        <section className="space-y-2">
          <Label htmlFor="hw-title">Название *</Label>
          <Input
            id="hw-title"
            placeholder="Например: Кинематика — контрольная 15.04"
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            className={`text-base ${errors.title ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
            aria-invalid={errors.title ? 'true' : undefined}
            aria-describedby={errors.title ? 'hw-title-error' : undefined}
          />
          {errors.title && (
            <p id="hw-title-error" className="text-sm text-red-500">{errors.title}</p>
          )}
        </section>

        {/* Subject + Exam type (L0 — required) */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hw-subject">Предмет *</Label>
            <select
              id="hw-subject"
              value={meta.subject}
              onChange={(e) => setMeta({ ...meta, subject: e.target.value as HomeworkSubject })}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2"
              style={{ fontSize: '16px', touchAction: 'manipulation' }}
              aria-invalid={errors.subject ? 'true' : undefined}
            >
              {hasLegacySelectedSubject && (
                <option value={meta.subject}>
                  {getSubjectLabel(meta.subject)} (legacy)
                </option>
              )}
              {SUBJECTS.map((subject) => (
                <option key={subject.value} value={subject.value}>
                  {subject.label}
                </option>
              ))}
            </select>
            {errors.subject && <p className="text-sm text-red-500">{errors.subject}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="hw-exam-type">Тип экзамена</Label>
            <select
              id="hw-exam-type"
              value={meta.exam_type ?? 'ege'}
              onChange={(e) => setMeta({ ...meta, exam_type: e.target.value as 'ege' | 'oge' })}
              className="w-full border border-slate-200 rounded-md px-3 py-2 bg-white"
              style={{ fontSize: '16px', touchAction: 'manipulation' }}
            >
              <option value="ege">ЕГЭ</option>
              <option value="oge">ОГЭ</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Выберите сразу, чтобы ученик видел корректные формулировки в чате с AI.
            </p>
          </div>
        </section>

        {/* Deadline (L0 — optional) */}
        <section className="space-y-2">
          <Label htmlFor="hw-deadline">Дедлайн (необязательно)</Label>
          <Input
            id="hw-deadline"
            type="datetime-local"
            value={meta.deadline}
            onChange={(e) => setMeta({ ...meta, deadline: e.target.value })}
            className="text-base"
          />
        </section>

        {/* Recipients (L0) */}
        <section id="hw-recipients-section">
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
        <section id="hw-tasks-section">
          <h2 className="text-lg font-semibold mb-3">Задачи</h2>
          <HWTasksSection
            tasks={tasks}
            onChange={setTasks}
            errors={errors}
            topicHint={meta.title}
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
            {/*
              Dot indicator: show only when L1 itself has non-default content.
              Title / Subject / Deadline live on L0 now — they no longer drive
              the dot. Default for disable_ai_bootstrap is true (toggle OFF);
              the dot lights when the tutor has flipped it ON (=== false).
            */}
            {!showAdvanced && (materials.length > 0 || meta.disable_ai_bootstrap === false) && (
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
          isSubmitDisabled={isSubmitting || (isEditMode && !isEditSnapshotReady)}
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
