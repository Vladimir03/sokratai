// Job: P0.1 — Собрать ДЗ по теме после урока
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimeField } from '@/components/ui/date-time-field';
import { ArrowLeft, Loader2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTutor, useTutorStudents, useTutorGroups } from '@/hooks/useTutor';
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
  pushHomeworkTaskToKb,
  type HomeworkSubject,
  type ModernHomeworkSubject,
  type CreateAssignmentTask,
  type UpdateAssignmentTask,
  type HomeworkTemplateListItem,
  type HomeworkTemplate,
  type HomeworkTemplateTask,
  type TutorHomeworkAssignmentDetails,
  HomeworkApiError,
} from '@/lib/tutorHomeworkApi';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import { supabase } from '@/lib/supabaseClient';
// `SUBJECTS` уже импортируется из homework-create/types ({value,label}[] для L0
// селектора). Канонический массив (@/types/homework, {id,...}) нужен только для
// валидации lesson-prefill по `.id` — импортируем под алиасом, иначе дубль
// идентификатора `SUBJECTS` ломает dev-сервер (esbuild bundling его дедупит,
// поэтому prod-build не падал, но это латентный баг).
import { getSubjectLabel, SUBJECTS as CANONICAL_SUBJECTS } from '@/types/homework';
import { attachHomework, LessonMaterialsApiError } from '@/lib/lessonMaterialsApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { detectCefrLevelFromText } from '@/lib/cefrDetect';

// ─── Extracted components ────────────────────────────────────────────────────
import {
  type DraftTask,
  type DraftMaterial,
  type MetaState,
  type SubmitPhase,
  type SubmitSuccessResult,
  SUBJECTS,
  computeTaskContentFingerprint,
  createEmptyTask,
  generateUUID,
  isCriteriaEligibleTask,
  revokeObjectUrl,
} from '@/components/tutor/homework-create/types';
import { HWTemplatePicker } from '@/components/tutor/homework-create/HWTemplatePicker';
import { HWExpandedParams } from '@/components/tutor/homework-create/HWExpandedParams';
import { HWTasksSection } from '@/components/tutor/homework-create/HWTasksSection';
import { useTutorVoiceSpeakingFeatureFlag } from '@/hooks/useTutorVoiceSpeakingFeatureFlag';
import { useHomeworkFolders } from '@/hooks/useHomeworkFolders';
import { HWMaterialsSection } from '@/components/tutor/homework-create/HWMaterialsSection';
import { HWAssignSection } from '@/components/tutor/homework-create/HWAssignSection';
import { HWActionBar } from '@/components/tutor/homework-create/HWActionBar';
import { HWSubmitSuccess } from '@/components/tutor/homework-create/HWSubmitSuccess';
import { ConnectStudentSheet, type ConnectStudentTarget } from '@/components/tutor/ConnectStudentSheet';

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
  task_kind?: string | null;
  cefr_level?: string | null;
  kim_number?: number | null;
  grading_criteria_json?: unknown;
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
      // voice-speaking-mvp fix #1: track the speaking-bit so written↔speaking is a
      // detectable change (tasksDirty). Non-speaking task_kind is derived from
      // check_format (already in this signature) → normalize to null to avoid a
      // spurious dirty from 'extended'↔undefined noise.
      task_kind: task.task_kind === 'speaking' ? 'speaking' : null,
      // CEFR-level fix (2026-05-29): explicit level в подписи → смена «Уровня»
      // помечает tasksDirty (иначе правка только уровня не сохранится на edit).
      cefr_level: task.cefr_level ?? null,
      // Phase 2 (2026-06-21): № КИМ в подписи → re-импорт KB-задачи с другим № помечает dirty.
      kim_number: task.kim_number ?? null,
      // Criteria-grading feature (2026-06): структурные критерии в подписи → правка
      // ТОЛЬКО критериев (без других полей) помечает tasksDirty (иначе не сохранится).
      grading_criteria_json: task.grading_criteria_json ?? null,
      // Ревью-фикс P2 (2026-07-06): каскад-поля (exam/difficulty/topic/subtopic/
      // source_label) НЕ входят в подпись — они не персистятся в
      // homework_tutor_tasks (только KB-зеркало при создании + push-body),
      // и включение давало phantom-dirty без реального сохранения. Их правка
      // на существующей задаче уезжает через «Обновить в Базе» (divergence-
      // fingerprint их несёт). kim_number персистится → остаётся в подписи.
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

function differenceSet(source: Set<string>, excluded: Set<string>): Set<string> {
  const next = new Set<string>();
  for (const value of source) {
    if (!excluded.has(value)) {
      next.add(value);
    }
  }
  return next;
}

function buildGroupMemberStudentIdsMap(
  groups: Array<{
    id: string;
    members: Array<{ tutor_student_id: string; is_active: boolean }>;
  }>,
  tutorStudents: Array<{ id: string; student_id: string }>,
): Map<string, Set<string>> {
  const studentIdByTutorStudentId = new Map<string, string>();
  for (const student of tutorStudents) {
    studentIdByTutorStudentId.set(student.id, student.student_id);
  }

  const result = new Map<string, Set<string>>();
  for (const group of groups) {
    const memberStudentIds = new Set<string>();
    for (const member of group.members) {
      if (!member.is_active) continue;
      const studentId = studentIdByTutorStudentId.get(member.tutor_student_id);
      if (studentId) {
        memberStudentIds.add(studentId);
      }
    }
    result.set(group.id, memberStudentIds);
  }

  return result;
}

type EditSnapshot = {
  meta: MetaState;
  taskSignature: string;
  studentIds: string;
  materialSignature: string;
  sourceGroupId: string | null;
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
      // Phase 11 (2026-05-31): cefr_level — для display baseline (берётся из первой
      // задачи, см. prefill). НЕ участвует в metaDirty — он внутри taskSignature
      // (каскад в tasks). feedback_language — assignment-level, в metaDirty ниже.
      cefr_level: (() => {
        const cl = assignment.tasks[0]?.cefr_level;
        return cl === 'A2' || cl === 'B1' || cl === 'B2' || cl === 'C1' ? cl : null;
      })(),
      feedback_language:
        ((a as { feedback_language?: unknown }).feedback_language === 'russian' ||
          (a as { feedback_language?: unknown }).feedback_language === 'target')
          ? ((a as { feedback_language: 'russian' | 'target' }).feedback_language)
          : 'auto',
    },
    taskSignature: buildTaskSignature(assignment.tasks),
    studentIds: assignment.assigned_students.map((s) => s.student_id).sort().join(','),
    materialSignature: buildMaterialSignature(assignment.materials),
    sourceGroupId: assignment.assignment.source_group_id ?? null,
  };
}

function buildEditDiffState(params: {
  snapshot: EditSnapshot;
  meta: MetaState;
  tasks: DraftTask[];
  materials: DraftMaterial[];
  selectedStudentIds: Set<string>;
  editExistingStudentIds: Set<string>;
  sourceGroupId: string | null;
}) {
  const {
    snapshot,
    meta,
    tasks,
    materials,
    selectedStudentIds,
    editExistingStudentIds,
    sourceGroupId,
  } = params;

  const metaDirty =
    meta.title !== snapshot.meta.title ||
    meta.subject !== snapshot.meta.subject ||
    meta.deadline !== snapshot.meta.deadline ||
    (meta.disable_ai_bootstrap ?? true) !== (snapshot.meta.disable_ai_bootstrap ?? true) ||
    (meta.exam_type ?? 'ege') !== (snapshot.meta.exam_type ?? 'ege') ||
    // Phase 11 (2026-05-31): feedback_language (assignment-level). cefr_level —
    // НЕ здесь, он внутри tasksDirty (каскад в tasks).
    (meta.feedback_language ?? 'auto') !== (snapshot.meta.feedback_language ?? 'auto');

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
      task_kind: task.task_kind,
      cefr_level: task.cefr_level,
      kim_number: task.kim_number,
      grading_criteria_json: task.grading_criteria_json ?? null,
    })),
  ) !== snapshot.taskSignature;

  const materialsDirty = buildMaterialSignature(materials) !== snapshot.materialSignature;
  const sourceGroupDirty = sourceGroupId !== snapshot.sourceGroupId;

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
    sourceGroupDirty,
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

// ─── Template load (field-parity fix 2026-06-03) ─────────────────────────────
//
// Shared by both load paths (URL-param ?template_id + picker sheet) so they never
// drift. Templates now carry per-task check_format / task_kind / cefr_level and
// assignment-level exam_type / feedback_language / disable_ai_bootstrap — раньше
// формат проверки молча откатывался в «краткий», task_kind в numeric, а CEFR
// заново угадывался из названия (баг #1).
//
// CEFR: explicit per-task уровень из шаблона побеждает; для старых шаблонов без
// него — авто-детект из названия/текста (прежнее поведение). CEFR + язык
// объяснений применяются ТОЛЬКО для языковых предметов (french/english/spanish);
// для остальных предметов этих полей нет (Q2).
function resolveTemplateLoad(tpl: HomeworkTemplate): {
  meta: (m: MetaState) => Partial<MetaState>;
  task: (t: HomeworkTemplateTask) => DraftTask;
} {
  const isLang = ['french', 'english', 'spanish'].includes(tpl.subject);
  const autoCefr = isLang
    ? detectCefrLevelFromText([tpl.title, ...tpl.tasks_json.map((t) => t.task_text)].join(' \n '))
    : null;
  const explicitTplCefr = isLang
    ? (tpl.tasks_json.find((t) => t.cefr_level)?.cefr_level ?? null)
    : null;
  const resolvedCefr = isLang ? (explicitTplCefr ?? autoCefr) : null;

  return {
    meta: (m) => ({
      title: tpl.title,
      subject: tpl.subject,
      cefr_level: resolvedCefr,
      // exam_type / disable_ai_bootstrap — для всех предметов (старые шаблоны:
      // exam_type null → keep current; disable_ai_bootstrap NOT NULL → false).
      exam_type: tpl.exam_type ?? m.exam_type,
      disable_ai_bootstrap: tpl.disable_ai_bootstrap ?? m.disable_ai_bootstrap,
      // feedback_language — только для языковых; иначе сохраняем текущее значение.
      feedback_language: isLang ? (tpl.feedback_language ?? 'auto') : m.feedback_language,
    }),
    task: (t) => ({
      ...createEmptyTask(),
      task_text: t.task_text,
      task_image_path: t.task_image_url ?? null,
      correct_answer: t.correct_answer ?? '',
      rubric_text: t.rubric_text ?? '',
      rubric_image_paths: t.rubric_image_urls ?? null,
      solution_text: t.solution_text ?? '',
      solution_image_paths: t.solution_image_urls ?? null,
      max_score: t.max_score ?? 1,
      check_format: t.check_format ?? 'short_answer',
      task_kind: t.task_kind ?? undefined,
      cefr_level: resolvedCefr,
      // Phase 2 (2026-06-21): № КИМ из шаблона → ДЗ (grading по ФИПИ).
      kim_number: t.kim_number ?? null,
      // Criteria-grading feature (2026-06): структурные критерии из шаблона → ДЗ.
      grading_criteria_json: t.grading_criteria_json ?? null,
      // unified-task-model (2026-07-05): ссылочный шаблон несёт source_kb_task_id
      // (синтез бэкенда) → выдача из шаблона = снимок ТЕХ ЖЕ задач Базы
      // (провенанс + usage-цепочка Банка). Legacy-шаблон без него → null =
      // задача авто-зеркалится в Базу при сохранении (двойное авторство).
      kb_task_id: t.source_kb_task_id ?? null,
      // Тип для каскада: из № КИМ + exam_type шаблона (снимок ДЗ тип не хранит).
      exam: t.kim_number != null && (tpl.exam_type === 'ege' || tpl.exam_type === 'oge')
        ? tpl.exam_type
        : '',
    }),
  };
}

/**
 * Ревью-фикс P1 (2026-07-06): у ссылочного шаблона недоступные задачи (удалены
 * из Базы / сняты с публикации) МОЛЧА отсутствуют в синтезированном tasks_json
 * → без сверки тутор выдал бы усечённое ДЗ, не заметив. Возвращает false =
 * блокировать загрузку (0 доступных задач).
 */
function checkTemplateTaskAvailability(tpl: HomeworkTemplate): boolean {
  const refs = tpl.task_refs;
  if (!Array.isArray(refs) || refs.length === 0) return true; // legacy-шаблон
  if (tpl.tasks_json.length === 0) {
    toast.error(
      'Все задачи шаблона недоступны (удалены из Базы или сняты с публикации) — загружать нечего',
    );
    return false;
  }
  const unavailable = refs.filter((r) => r.unavailable).length;
  if (unavailable > 0) {
    toast.warning(
      `Загружено ${tpl.tasks_json.length} из ${refs.length} задач шаблона — ${unavailable} недоступны (удалены из Базы или сняты с публикации)`,
      { duration: 8000 },
    );
  }
  return true;
}

// ─── Main Single-Page Constructor ───────────────────────────────────────────

function TutorHomeworkCreateContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { id: editId } = useParams<{ id?: string }>();
  const isEditMode = !!editId;
  const { tutor, loading: tutorLoading } = useTutor();
  // voice-speaking-mvp: gate the «Устный ответ (монолог)» task-type option.
  const { data: voiceSpeakingEnabled = false } = useTutorVoiceSpeakingFeatureFlag();
  const { students: tutorStudents, loading: tutorStudentsLoading } = useTutorStudents();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
    isFetching: groupsIsFetching,
    isRecovering: groupsIsRecovering,
    failureCount: groupsFailureCount,
  } = useTutorGroups(miniGroupsEnabled);
  // Phase 9 (2026-05-25): canonical claim URL sokratai.ru/invite/{code}.
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

  // ── Папка (create-only, запрос Елены 2026-06-17) ──
  // Отдельный стейт (НЕ в meta) — чтобы не трогать чувствительную edit-snapshot/dirty
  // логику. В edit-режиме селектор скрыт и folder_id не отправляется (папкой управляет
  // меню «···» на карточке ДЗ). Дефолт — «Без папки».
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const { folders: homeworkFolders } = useHomeworkFolders();

  // ── Deferred image deletes (edit mode: only delete after successful save) ──
  const deferredImageDeletesRef = useRef<string[]>([]);
  const handleDeferImageDelete = useCallback((storagePath: string) => {
    deferredImageDeletesRef.current.push(storagePath);
  }, []);

  // unified-task-model F2 (2026-07-05): «Обновить в Базе» / «Своя копия» —
  // пуш ДРАФТ-полей задачи в источник Базы (edit-mode; работает до сохранения
  // ДЗ — бэкенд whitelist-мержит драфт поверх строки). Каталожный источник →
  // copy-on-write форк (forked=true) + relink провенанса в драфте.
  const handleRequestPushToKB = useCallback(
    async (task: DraftTask) => {
      if (!editId || !task.id) return;
      try {
        const res = await pushHomeworkTaskToKb(editId, task.id, {
          task_text: task.task_text.trim() || '[Задача на фото]',
          task_image_url: task.task_image_path ?? null,
          correct_answer: task.correct_answer.trim() || null,
          max_score: task.max_score,
          rubric_text: task.rubric_text.trim() || null,
          rubric_image_urls: task.rubric_image_paths ?? null,
          solution_text: task.solution_text.trim() || null,
          solution_image_urls: task.solution_image_paths ?? null,
          check_format: task.check_format,
          task_kind: task.task_kind,
          cefr_level: task.cefr_level ?? null,
          kim_number: task.kim_number ?? null,
          grading_criteria_json: isCriteriaEligibleTask(task) ? (task.grading_criteria_json ?? null) : null,
          // Ревью-фикс P1 (2026-07-06): каскад-поля едут в push, но ТОЛЬКО
          // непустые — edit-prefill классификацию из Базы не грузит, и слепой
          // `topic_id: null` затёр бы тему источника. Пустое поле = «не знаю»,
          // а не «очисти» (backend мержит только присланные ключи).
          ...(task.exam === 'ege' || task.exam === 'oge' || task.exam === 'olympiad'
            ? { exam: task.exam }
            : {}),
          ...(task.difficulty != null ? { difficulty: task.difficulty } : {}),
          ...(task.topic_id ? { topic_id: task.topic_id } : {}),
          ...(task.subtopic_id ? { subtopic_id: task.subtopic_id } : {}),
          ...(task.source_label?.trim() ? { source_label: task.source_label.trim() } : {}),
        });
        // Синхронизировали → сброс divergence-fingerprint на текущий контент;
        // при форке — relink на личную копию (бейдж «Каталог»→«Моя база»).
        setTasks((prev) =>
          prev.map((t) =>
            t.localId === task.localId
              ? {
                  ...t,
                  kb_task_id: res.kb_task_id,
                  kb_source: 'my' as const,
                  kb_content_fingerprint: computeTaskContentFingerprint(t),
                }
              : t,
          ),
        );
        toast.success(
          res.forked
            ? 'Создана ваша копия в Базе — задача теперь ссылается на неё'
            : 'Задача обновлена в вашей Базе (уже выданные ДЗ не изменились)',
        );
        void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Не удалось обновить задачу в Базе');
      }
    },
    [editId, queryClient],
  );

  // ── Assign ──
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [assignTab, setAssignTab] = useState<'groups' | 'students'>('students');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [manuallyRemovedStudentIds, setManuallyRemovedStudentIds] = useState<Set<string>>(new Set());
  const [manuallyAddedStudentIds, setManuallyAddedStudentIds] = useState<Set<string>>(new Set());
  const [groupSelectionDirty, setGroupSelectionDirty] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyTemplate, setNotifyTemplate] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // ── Submit state ──
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');
  const createdAssignmentIdRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successResult, setSuccessResult] = useState<SubmitSuccessResult | null>(null);
  // Онбординг v2 (T3) — гейт «Подключить» после первой выдачи ДЗ ученикам без канала.
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectTargets, setConnectTargets] = useState<ConnectStudentTarget[]>([]);
  const [connectAssignmentId, setConnectAssignmentId] = useState<string>('');
  // Edit-flow: навигация откладывается до закрытия sheet (review P1 #4).
  const [connectPendingNav, setConnectPendingNav] = useState<string | null>(null);
  const handleConnectOpenChange = useCallback((next: boolean) => {
    setConnectOpen(next);
    if (!next && connectPendingNav) {
      const url = connectPendingNav;
      setConnectPendingNav(null);
      navigate(url);
    }
  }, [connectPendingNav, navigate]);
  const assignTabInitializedRef = useRef(false);
  const editGroupPrefilledRef = useRef(false);

  // ── Edit mode: fetch existing assignment ──
  //
  // Phase 10 (2026-05-26) — defense-in-depth для production регрессии (см.
  // ChatGPT-5.5 review для дополнительного P0 fix signed URL race ниже):
  //
  // ❌ DO NOT enable `refetchOnWindowFocus` (default `true`). Это write-form
  //    query — local `tasks` state редактируется юзером и source of truth до
  //    нажатия «Сохранить». Background refetch — **risk amplifier**: даже если
  //    prefill `editPrefilledRef.current` guard правильно блокирует re-prefill,
  //    refetch создаёт новый `existingAssignment` object reference, что fires
  //    лишние effects и увеличивает window для других race conditions
  //    (см. signed URL race fix в prefill effect ниже). Direct cause репорта
  //    Elena Ivanova 2026-05-26 — signed URL `.then()` overwrite, но refetch
  //    делал window для гонки в разы шире.
  //
  // ❌ DO NOT decrease `staleTime` below 10 минут. Edit session обычно
  //    укладывается в 10 минут; если tutor сидит дольше — explicit refresh
  //    страницы возьмёт свежие данные. Короткий staleTime тоже включает
  //    aggressive refetch behavior.
  //
  // Pattern для всех write-form queries: `{ refetchOnWindowFocus: false,
  // staleTime: 10 * 60 * 1000 }`. Assertion в scripts/smoke-check.mjs section 8
  // enforces invariant.
  //
  // См. .claude/rules/40-homework-system.md «Homework
  // constructor QA checklist».
  const editQuery = useQuery({
    queryKey: ['tutor', 'homework', 'detail', editId],
    queryFn: () => getTutorHomeworkAssignment(editId!),
    enabled: isEditMode,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const existingAssignment = editQuery.data;

  const groupMemberStudentIdsByGroupId = useMemo(
    () => buildGroupMemberStudentIdsMap(groups, tutorStudents),
    [groups, tutorStudents],
  );

  const sourceGroupId = useMemo(() => {
    if (isEditMode && !groupSelectionDirty) {
      return existingAssignment?.assignment.source_group_id ?? null;
    }
    if (
      selectedGroupIds.size !== 1 ||
      manuallyRemovedStudentIds.size > 0 ||
      manuallyAddedStudentIds.size > 0
    ) {
      return null;
    }
    return Array.from(selectedGroupIds)[0] ?? null;
  }, [
    isEditMode,
    groupSelectionDirty,
    existingAssignment,
    selectedGroupIds,
    manuallyRemovedStudentIds,
    manuallyAddedStudentIds,
  ]);

  const selectedGroupIdsList = useMemo(
    () => Array.from(selectedGroupIds),
    [selectedGroupIds],
  );

  const handleAssignTabChange = useCallback((nextTab: 'groups' | 'students') => {
    assignTabInitializedRef.current = true;
    setAssignTab(nextTab);
  }, []);

  const handleAssignSelectionInteraction = useCallback(() => {
    setGroupSelectionDirty(true);
  }, []);

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

  useEffect(() => {
    if (tutorLoading) return;

    if (!miniGroupsEnabled) {
      if (assignTab !== 'students') {
        setAssignTab('students');
      }
      return;
    }

    if (assignTabInitializedRef.current || groupsLoading) return;
    setAssignTab(groups.length > 0 ? 'groups' : 'students');
    assignTabInitializedRef.current = true;
  }, [tutorLoading, miniGroupsEnabled, groupsLoading, groups.length, assignTab]);

  const editExistingStudentIds = useMemo(
    () => new Set(existingAssignment?.assigned_students.map((s) => s.student_id) ?? []),
    [existingAssignment],
  );
  const [editInitialSnapshot, setEditInitialSnapshot] = useState<EditSnapshot | null>(null);
  const isEditSnapshotReady = !isEditMode || editInitialSnapshot !== null;

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
    editGroupPrefilledRef.current = false;
    assignTabInitializedRef.current = false;
    setGroupSelectionDirty(false);
    setEditInitialSnapshot(null);
    deferredImageDeletesRef.current = [];
    setSelectedGroupIds(new Set());
    setManuallyRemovedStudentIds(new Set());
    setManuallyAddedStudentIds(new Set());
  }, [editId]);

  useEffect(() => {
    if (!isEditMode || !existingAssignment || editPrefilledRef.current) return;
    editPrefilledRef.current = true;

    const a = existingAssignment.assignment;
    // Phase 11 (2026-05-31): assignment-level CEFR из первой задачи (все задачи
    // несут один уровень через каскад). feedback_language — из assignment.
    const firstTaskCefr = existingAssignment.tasks[0]?.cefr_level;
    const prefilledCefr =
      firstTaskCefr === 'A2' || firstTaskCefr === 'B1' || firstTaskCefr === 'B2' || firstTaskCefr === 'C1'
        ? firstTaskCefr
        : null;
    const rawFeedbackLang = (a as { feedback_language?: unknown }).feedback_language;
    setMeta({
      title: a.title,
      subject: a.subject,
      deadline: a.deadline ? toLocalDatetimeString(a.deadline) : '',
      disable_ai_bootstrap: a.disable_ai_bootstrap ?? true,
      exam_type: (a.exam_type as 'ege' | 'oge') ?? 'ege',
      cefr_level: prefilledCefr,
      feedback_language:
        rawFeedbackLang === 'russian' || rawFeedbackLang === 'target' ? rawFeedbackLang : 'auto',
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
        // voice-speaking-mvp: preserve 'speaking' on edit (round-trips via detail SELECT).
        task_kind: t.task_kind,
        // CEFR-level fix: preserve explicit «Уровень» on edit.
        cefr_level: t.cefr_level,
        // Phase 2 (2026-06-21): preserve № КИМ on edit (grading по ФИПИ).
        kim_number: t.kim_number ?? null,
        // Criteria-grading feature (2026-06): preserve structured criteria on edit.
        grading_criteria_json: t.grading_criteria_json ?? null,
        kb_task_id: t.kb_task_id ?? undefined,
        kb_snapshot_text: t.kb_snapshot_text ?? undefined,
        kb_snapshot_answer: t.kb_snapshot_answer ?? undefined,
        kb_snapshot_solution: t.kb_snapshot_solution ?? undefined,
        kb_snapshot_edited: t.kb_snapshot_edited ?? undefined,
        kb_snapshot_solution_image_refs: t.kb_snapshot_solution_image_refs ?? undefined,
        kb_source_label: t.kb_source_label ?? undefined,
        // unified-task-model F2 (2026-07-05): владелец источника (my/socrat) из
        // per-row провенанса бэкенда (kb_source_owner) — управляет лейблом
        // «Обновить в Базе» vs «Своя копия».
        kb_source: (t as { kb_source_owner?: string | null }).kb_source_owner === 'socrat'
          ? 'socrat' as const
          : ((t as { kb_source_owner?: string | null }).kb_source_owner === 'my' ? 'my' as const : undefined),
        // Тип каскада: снимок хранит только № КИМ → derive из exam_type ДЗ.
        exam: t.kim_number != null
          ? (((a.exam_type as string) === 'oge' ? 'oge' : 'ege') as DraftTask['exam'])
          : ('' as DraftTask['exam']),
      }))
      // Fingerprint «как загружено» — divergence-детект «Обновить в Базе»
      // ловит правки ТЕКУЩЕЙ сессии (session-local; push шлёт драфт-поля).
      .map((base) => ({
        ...base,
        kb_content_fingerprint: base.kb_task_id ? computeTaskContentFingerprint(base) : null,
      }));

    setTasks(newTasks);

    // Resolve storage:// refs to signed preview URLs.
    //
    // Phase 10 (2026-05-26, ChatGPT-5.5 review P0 fix):
    //
    // Раньше код мутировал `newTasks` array после первого `setTasks(newTasks)`,
    // а потом делал второй `setTasks([...newTasks])` через `.then(...)`. Это
    // содержало **race condition** — между первым и вторым setTasks tutor мог
    // добавить новые задачи через HWTasksSection (`setTasks([...prev, newTask])`).
    // Когда signed URL promise finally resolved (задерживался background-tab
    // throttling до десятков секунд!), `.then()` callback вызывал
    // `setTasks([...newTasks])` где `newTasks` — closure variable с исходным
    // server array → user-added tasks ПОТЕРЯНЫ. Это объясняет репорт Elena
    // лучше чем focus-refetch theory (которая всё равно требует guarded
    // prefill effect re-run; editPrefilledRef.current должен блокировать).
    //
    // Fix: functional setTasks с merge по task_image_path:
    //   1. Async resolve signed URLs в Map<storage path, signed URL>
    //   2. setTasks((current) => current.map(merge)) — на основе CURRENT state,
    //      не closure newTasks. User additions / edits / removals preserved
    //      по definition (functional setState reads latest state).
    //   3. Merge только если task ещё имеет тот же task_image_path и нет
    //      уже-resolved preview (user не upload'нул новое фото).
    //
    // Также убрана мутация `newTasks[i] = ...` после setTasks — React
    // immutability principle.
    const previewByPath = new Map<string, string>();
    Promise.all(
      newTasks.map(async (t) => {
        if (t.task_image_path) {
          const url = await getHomeworkImageSignedUrl(t.task_image_path);
          if (url) previewByPath.set(t.task_image_path, url);
        }
      }),
    ).then(() => {
      if (previewByPath.size === 0) return;
      setTasks((current) =>
        current.map((task) => {
          if (!task.task_image_path) return task;
          // Skip if task_image_path изменился (user upload'нул новое фото) — у нас
          // нет signed URL для нового path; новый upload сам поставит preview.
          const resolved = previewByPath.get(task.task_image_path);
          if (!resolved) return task;
          // Skip если уже есть preview URL (blob: от текущей session upload, или
          // другой signed URL). Не перезаписываем — UX не должен мерцать.
          if (task.task_image_preview_url) return task;
          return { ...task, task_image_preview_url: resolved };
        }),
      );
    });

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
    setSelectedGroupIds(new Set());
    setManuallyRemovedStudentIds(new Set());
    setManuallyAddedStudentIds(new Set());
    setEditInitialSnapshot(buildEditSnapshot(existingAssignment));
  }, [isEditMode, existingAssignment]);

  useEffect(() => {
    if (!isEditMode || !existingAssignment || editGroupPrefilledRef.current) return;
    const existingSourceGroupId = existingAssignment.assignment.source_group_id ?? null;
    if (!existingSourceGroupId) return;
    if (!miniGroupsEnabled || groupsLoading || tutorStudentsLoading) return;

    const assignedIds = new Set(
      existingAssignment.assigned_students.map((student) => student.student_id),
    );
    const groupStudentIds =
      groupMemberStudentIdsByGroupId.get(existingSourceGroupId) ?? new Set<string>();

    assignTabInitializedRef.current = true;
    editGroupPrefilledRef.current = true;
    setAssignTab('groups');
    setSelectedGroupIds(new Set([existingSourceGroupId]));
    setManuallyRemovedStudentIds(differenceSet(groupStudentIds, assignedIds));
    setManuallyAddedStudentIds(differenceSet(assignedIds, groupStudentIds));
  }, [
    isEditMode,
    existingAssignment,
    miniGroupsEnabled,
    groupsLoading,
    tutorStudentsLoading,
    groupMemberStudentIdsByGroupId,
  ]);

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
      sourceGroupId,
    });
  }, [
    isEditMode,
    meta,
    tasks,
    materials,
    selectedStudentIds,
    editExistingStudentIds,
    editInitialSnapshot,
    sourceGroupId,
  ]);

  // ── Auto-load template from ?template_id query param ──
  const templateId = searchParams.get('template_id');
  const templateLoadedRef = useRef(false);
  // unified-task-model F3 (2026-07-05): id загруженного шаблона → в create-payload
  // (source_template_id + usage_count Банка). Оба load-пути его ставят.
  const loadedTemplateIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!templateId || templateLoadedRef.current) return;
    templateLoadedRef.current = true;
    setTemplateLoading(true);
    getTutorHomeworkTemplate(templateId)
      .then((tpl) => {
        // Ревью-фикс P1: сверка task_refs ↔ tasks_json (недоступные задачи).
        if (!checkTemplateTaskAvailability(tpl)) return;
        const resolved = resolveTemplateLoad(tpl);
        setMeta((m) => ({ ...m, ...resolved.meta(m) }));
        setTasks(tpl.tasks_json.map((t) => resolved.task(t)));
        loadedTemplateIdRef.current = tpl.id;
        toast.success(`Шаблон «${tpl.title}» загружен`);
      })
      .catch(() => toast.error('Не удалось загрузить шаблон'))
      .finally(() => setTemplateLoading(false));
  }, [templateId]);

  // ── Prefill from a lesson (schedule-materials TASK-8) ──
  // Arriving from the «Создать ДЗ» button in the lesson materials drawer:
  // ?subject + ?students + ?lesson_id. Create-only + ref-guarded so it never
  // collides with the edit-mode prefill (editPrefilledRef) or its reset/order.
  // lesson_id is re-read at save time to auto-link the new ДЗ back to the lesson.
  const lessonPrefillRef = useRef(false);
  useEffect(() => {
    if (isEditMode || lessonPrefillRef.current) return;
    const subjParam = searchParams.get('subject');
    const studentsParam = searchParams.get('students');
    const lessonIdParam = searchParams.get('lesson_id');
    if (!subjParam && !studentsParam && !lessonIdParam) return;
    lessonPrefillRef.current = true;
    if (subjParam && CANONICAL_SUBJECTS.some((s) => s.id === subjParam)) {
      setMeta((m) => ({ ...m, subject: subjParam as HomeworkSubject }));
    }
    if (!studentsParam) return;
    const urlIds = studentsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (urlIds.length === 0) return;
    // 1a hardening: trust the lesson, not the URL. With lesson_id present,
    // validate URL recipients against the lesson's ACTUAL student set (server
    // truth) so a stale/tampered URL can't prefill a student who isn't on the
    // lesson. Without lesson_id keep URL ids as-is — the backend assign endpoint
    // still whitelists to tutor-owned students (no cross-tutor leak).
    if (!lessonIdParam) {
      setSelectedStudentIds(new Set(urlIds));
      setAssignTab('students');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [lessonRes, partsRes] = await Promise.all([
          supabase.from('tutor_lessons').select('student_id').eq('id', lessonIdParam).maybeSingle(),
          supabase.from('tutor_lesson_participants').select('student_id').eq('lesson_id', lessonIdParam),
        ]);
        if (lessonRes.error) throw lessonRes.error;
        if (partsRes.error) throw partsRes.error;
        const allowed = new Set<string>();
        if (lessonRes.data?.student_id) allowed.add(lessonRes.data.student_id as string);
        for (const p of partsRes.data ?? []) {
          if (p.student_id) allowed.add(p.student_id as string);
        }
        const valid = urlIds.filter((id) => allowed.has(id));
        if (cancelled) return;
        if (valid.length > 0) {
          setSelectedStudentIds(new Set(valid));
          setAssignTab('students');
        }
        if (valid.length < urlIds.length) {
          toast.info('Получатели сверены с занятием');
        }
      } catch (err) {
        if (cancelled) return;
        // Fail-safe: don't trust the URL — let the tutor pick recipients manually.
        console.warn('lesson_prefill_recipient_validation_failed', err);
        toast.info('Не удалось сверить получателей с занятием — выберите вручную.');
      }
    })();
    return () => { cancelled = true; };
  }, [isEditMode, searchParams]);

  // ── Apply template from picker sheet ──
  const handleApplyTemplate = useCallback(async (tpl: HomeworkTemplateListItem) => {
    const isDirty =
      meta.title.trim().length > 0 ||
      tasks.some((t) => t.task_text.trim().length > 0);
    if (isDirty && !window.confirm('Заменить текущие данные шаблоном?')) return;

    setTemplateLoading(true);
    try {
      const full = await getTutorHomeworkTemplate(tpl.id);
      // Ревью-фикс P1: сверка task_refs ↔ tasks_json (недоступные задачи).
      if (!checkTemplateTaskAvailability(full)) return;
      // Field-parity fix (2026-06-03): единый резолвер с URL-param путём —
      // несёт check_format / task_kind / cefr_level + assignment-level настройки.
      const resolved = resolveTemplateLoad(full);
      setMeta((m) => ({ ...m, ...resolved.meta(m) }));
      setTasks(full.tasks_json.map((t) => resolved.task(t)));
      loadedTemplateIdRef.current = full.id;
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
        editDiffState.sourceGroupDirty ||
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
      selectedGroupIds.size > 0 ||
      manuallyRemovedStudentIds.size > 0 ||
      manuallyAddedStudentIds.size > 0 ||
      notifyEnabled !== true ||
      notifyTemplate.trim().length > 0;

    return metaDirty || tasksDirty || assignDirty;
  }, [
    meta,
    tasks,
    selectedStudentIds,
    selectedGroupIds,
    manuallyRemovedStudentIds,
    manuallyAddedStudentIds,
    notifyEnabled,
    notifyTemplate,
    submitPhase,
    isEditMode,
    editDiffState,
    isEditSnapshotReady,
  ]);

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

    // Phase 11 (2026-05-31): для языковых subjects (french/english/spanish) с
    // письменными/устными задачами — CEFR-уровень ОБЯЗАТЕЛЕН. Без него AI молча
    // грейдит по B1 (баг Эмилии: A2-ДЗ проверялись по B1 + «160 слов»).
    const isLang = ['french', 'english', 'spanish'].includes(meta.subject);
    if (isLang) {
      const hasWritingTask = tasks.some((t) => {
        const tk = t.task_kind ?? (t.check_format === 'detailed_solution' ? 'extended' : 'numeric');
        return tk === 'extended' || tk === 'proof' || tk === 'speaking';
      });
      if (hasWritingTask && !meta.cefr_level) {
        errs.cefr_level = 'Укажите уровень CEFR — без него AI проверит работу по B1.';
      }
    }

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
        : errs.cefr_level
          ? 'hw-cefr-section'
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
          // voice-speaking-mvp: explicit 'speaking' (else undefined → backend derives).
          task_kind: t.task_kind,
          // Phase 11 (2026-05-31): CEFR — assignment-level каскад во все задачи для
          // языковых subjects (single control в L0). Non-language → null.
          cefr_level: ['french', 'english', 'spanish'].includes(meta.subject)
            ? (meta.cefr_level ?? null)
            : null,
          // Phase 2 (2026-06-21): per-task № КИМ из KB → grading по ФИПИ.
          kim_number: t.kim_number ?? null,
          // Criteria-grading feature (2026-06): структурные критерии (любой предмет).
          // Gated на eligible-задачи (review fix P2) — критерии, заданные на
          // развёрнутой задаче и затем переключённой в «Краткий ответ», НЕ пишутся.
          grading_criteria_json: isCriteriaEligibleTask(t) ? (t.grading_criteria_json ?? null) : null,
          // unified-task-model F2 (2026-07-05): tri-state провенанс — новый
          // клиент ВСЕГДА шлёт uuid (снимок задачи Базы) или null (ЯВНО новая
          // → бэкенд авто-зеркалит в «Из ДЗ»). undefined = только старые клиенты.
          kb_task_id: t.kb_task_id ?? null,
          exam: t.exam === 'ege' || t.exam === 'oge' ? t.exam : null,
          difficulty: t.difficulty ?? null,
          topic_id: t.topic_id ?? null,
          subtopic_id: t.subtopic_id ?? null,
          source_label: t.source_label ?? null,
        }));

        const result = await createTutorHomeworkAssignment({
          title: resolvedTitle,
          subject: meta.subject as ModernHomeworkSubject,
          deadline: meta.deadline
            ? parseISO(meta.deadline).toISOString()
            : null,
          tasks: apiTasks,
          source_group_id: sourceGroupId,
          disable_ai_bootstrap: meta.disable_ai_bootstrap ?? true,
          exam_type: meta.exam_type ?? 'ege',
          // Phase 11 (2026-05-31): assignment-level AI feedback language.
          feedback_language: meta.feedback_language ?? 'auto',
          // Папка (create-only, запрос Елены 2026-06-17). null = «Без папки».
          folder_id: createFolderId,
          // unified-task-model F3: «выдано из шаблона» → usage_count Банка.
          template_id: loadedTemplateIdRef.current,
        });
        assignmentId = result.assignment_id;
        createdAssignmentIdRef.current = assignmentId;
        // Ревью-фикс P1 (2026-07-06): авто-зеркало degrade-not-block — но не
        // молча. failed > 0 → нейтральный info (ДЗ выдано успешно; recovery =
        // «Сохранить в мою базу» на карточке задачи в режиме правки).
        if (result.kb_mirror && result.kb_mirror.failed > 0) {
          toast.info(
            `ДЗ создано, но ${result.kb_mirror.failed} из ${result.kb_mirror.requested} новых задач не сохранились в Базу — используйте «Сохранить в мою базу» позже.`,
            { duration: 8000 },
          );
        }
      } else {
        await updateTutorHomeworkAssignment(assignmentId, {
          source_group_id: sourceGroupId,
        });
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
        null,
      );

      // Phase 2.5: auto-link the new ДЗ back to the originating lesson
      // (schedule-materials TASK-8). Only on create-from-lesson (?lesson_id),
      // after assign so the backend per-student ownership check passes.
      // Non-blocking: own try/catch — must never fall into the outer "create
      // failed" handler (the ДЗ already exists). Idempotent on retry.
      if (!isEditMode) {
        const lessonIdParam = searchParams.get('lesson_id');
        if (lessonIdParam && assignmentId) {
          const linkAssignmentId = assignmentId;
          // 1b: attach failure is non-fatal (ДЗ already created+assigned) but
          // surfaced with a retry action so the tutor can re-link in one tap.
          const attachToLesson = async (): Promise<void> => {
            try {
              await attachHomework(lessonIdParam, linkAssignmentId);
              toast.success('ДЗ привязано к занятию');
            } catch (linkErr) {
              const code = linkErr instanceof LessonMaterialsApiError ? linkErr.code : null;
              // HW_REF_DUPLICATE — новый код после «несколько ДЗ на урок» (2026-06-17);
              // HW_REF_EXISTS — старый edge до деплоя (backward-compat). Оба = идемпотентно.
              if (code === 'HW_REF_DUPLICATE' || code === 'HW_REF_EXISTS') {
                toast.success('ДЗ уже привязано к занятию');
                return;
              }
              console.warn('lesson_homework_autolink_failed', code ?? String(linkErr));
              toast.error('ДЗ создано, но не удалось привязать к занятию', {
                action: { label: 'Повторить', onClick: () => { void attachToLesson(); } },
                duration: 10000,
              });
            }
          };
          await attachToLesson();
        }
      }

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
          // Field-parity fix (2026-06-03, review P0): чекбокс «Сохранить как шаблон»
          // идёт через legacy POST /templates (а НЕ save_as_template-флаг), поэтому
          // ОБЯЗАН слать те же поля, что submit-payload выше — иначе reuse шаблона
          // терял check_format/task_kind/cefr + assignment-meta (баг #1 на видимой
          // кнопке). cefr_level + feedback_language — только для языковых (Q2).
          const isLang = ['french', 'english', 'spanish'].includes(meta.subject);
          await createTutorHomeworkTemplate({
            title: resolvedTitle,
            subject: meta.subject as ModernHomeworkSubject,
            exam_type: meta.exam_type ?? 'ege',
            disable_ai_bootstrap: meta.disable_ai_bootstrap ?? true,
            feedback_language: isLang ? (meta.feedback_language ?? 'auto') : null,
            tasks_json: tasks.map((t) => ({
              task_text: t.task_text.trim(),
              task_image_url: t.task_image_path ?? null,
              correct_answer: t.correct_answer.trim() || null,
              rubric_text: t.rubric_text.trim() || null,
              rubric_image_urls: t.rubric_image_paths ?? null,
              solution_text: t.solution_text.trim() || null,
              solution_image_urls: t.solution_image_paths ?? null,
              max_score: t.max_score,
              check_format: t.check_format,
              task_kind: t.task_kind ?? null,
              cefr_level: isLang ? (meta.cefr_level ?? null) : null,
              kim_number: t.kim_number ?? null,
              grading_criteria_json: isCriteriaEligibleTask(t) ? (t.grading_criteria_json ?? null) : null,
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
        selectedGroupIdsList.length === 1 && sourceGroupId
          ? groups.find((g) => g.id === sourceGroupId)?.name
          : undefined;

      if (selectedGroupIdsList.length > 0) {
        trackGuidedHomeworkEvent('homework_assign_group', {
          group_ids: selectedGroupIdsList,
          group_id: sourceGroupId,
          student_count: selectedStudentIds.size,
          is_multi_group: selectedGroupIdsList.length > 1,
        });
      }

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

      // Онбординг v2 (T3): первая выдача ДЗ ученикам без канала → гейт «Подключить».
      const withoutChannel = assignResult.students_without_channel ?? [];
      if (withoutChannel.length > 0) {
        const names = assignResult.students_without_channel_names ?? [];
        setConnectTargets(
          withoutChannel.map((sid, i) => ({ student_id: sid, name: names[i] ?? 'Ученик' })),
        );
        setConnectAssignmentId(assignmentId);
        setConnectOpen(true);
      }
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
    sourceGroupId,
    selectedGroupIdsList,
    groups,
    notifyEnabled,
    notifyTemplate,
    materials,
    saveAsTemplate,
    queryClient,
    inviteWebLink,
    studentLoginLink,
    isEditMode,
    searchParams,
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
      !editDiffState.sourceGroupDirty &&
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

      if (
        editDiffState.metaDirty ||
        editDiffState.tasksDirty ||
        editDiffState.sourceGroupDirty
      ) {
        setSubmitPhase('saving');
        const patch: {
          title?: string;
          subject?: string;
          deadline?: string | null;
          disable_ai_bootstrap?: boolean;
          exam_type?: 'ege' | 'oge';
          feedback_language?: 'auto' | 'russian' | 'target';
          source_group_id?: string | null;
          tasks?: UpdateAssignmentTask[];
        } = {};

        if (editDiffState.metaDirty) {
          patch.title = resolvedTitle;
          patch.subject = meta.subject as HomeworkSubject;
          patch.deadline = meta.deadline ? parseISO(meta.deadline).toISOString() : null;
          patch.disable_ai_bootstrap = meta.disable_ai_bootstrap ?? true;
          patch.exam_type = meta.exam_type ?? 'ege';
          // Phase 11 (2026-05-31): assignment-level AI feedback language.
          patch.feedback_language = meta.feedback_language ?? 'auto';
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
            // voice-speaking-mvp: explicit 'speaking' (else undefined → backend derives).
            task_kind: t.task_kind,
            // Phase 11 (2026-05-31): CEFR — assignment-level каскад (single L0 control).
            // Belt-and-suspenders для задач, добавленных после смены уровня. Non-language → null.
            cefr_level: ['french', 'english', 'spanish'].includes(meta.subject)
              ? (meta.cefr_level ?? null)
              : null,
            // Phase 2 (2026-06-21): per-task № КИМ из KB → grading по ФИПИ.
            kim_number: t.kim_number ?? null,
            // Criteria-grading feature (2026-06): структурные критерии (any subject).
            // Gated на eligible-задачи (review fix P2) — см. create body.
            grading_criteria_json: isCriteriaEligibleTask(t) ? (t.grading_criteria_json ?? null) : null,
            // unified-task-model F2: tri-state провенанс (mirror create body).
            kb_task_id: t.kb_task_id ?? null,
            exam: t.exam === 'ege' || t.exam === 'oge' ? t.exam : null,
            difficulty: t.difficulty ?? null,
            topic_id: t.topic_id ?? null,
            subtopic_id: t.subtopic_id ?? null,
            source_label: t.source_label ?? null,
          }));
        }

        if (editDiffState.sourceGroupDirty) {
          patch.source_group_id = sourceGroupId;
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

      let editWithoutChannel: string[] = [];
      let editWithoutChannelNames: string[] = [];
      if (editDiffState.newStudentsDirty) {
        setSubmitPhase('assigning');
        const editAssignResult = await assignTutorHomeworkStudents(editId, editDiffState.newStudentIds);
        editWithoutChannel = editAssignResult.students_without_channel ?? [];
        editWithoutChannelNames = editAssignResult.students_without_channel_names ?? [];

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
      if (selectedGroupIdsList.length > 0) {
        trackGuidedHomeworkEvent('homework_assign_group', {
          group_ids: selectedGroupIdsList,
          group_id: sourceGroupId,
          student_count: selectedStudentIds.size,
          is_multi_group: selectedGroupIdsList.length > 1,
        });
      }
      toast.success('Изменения сохранены');
      if (notifyRequestFailed) {
        toast.warning('Новых учеников добавили, но автоматически отправить ДЗ не удалось.');
      } else if ((notifyResult?.failed ?? 0) > 0) {
        toast.warning('Новых учеников добавили, но уведомления отправились не всем.');
      }

      // Онбординг v2 (T3, review P1 #4): добавили ученика без канала в edit-flow →
      // открываем гейт «Подключить»; навигация — при закрытии sheet.
      if (editWithoutChannel.length > 0) {
        const names = editWithoutChannelNames;
        setConnectTargets(
          editWithoutChannel.map((sid, i) => ({ student_id: sid, name: names[i] ?? 'Ученик' })),
        );
        setConnectAssignmentId(editId);
        setConnectPendingNav(`/tutor/homework/${editId}`);
        setConnectOpen(true);
        return;
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
  }, [
    editId,
    validateAll,
    existingAssignment,
    editDiffState,
    hasSubmissions,
    isEditSnapshotReady,
    meta,
    materials,
    navigate,
    queryClient,
    sourceGroupId,
    selectedGroupIdsList,
    selectedStudentIds,
    tasks,
  ]);

  // ── "Создать ещё" — reset form, preserve group selection ──

  const handleCreateAnother = useCallback(() => {
    // Revoke blob URLs from current tasks to prevent memory leaks
    for (const task of tasksRef.current) {
      revokeObjectUrl(task.task_image_preview_url);
    }

    if (!miniGroupsEnabled || selectedGroupIds.size === 0) {
      setSelectedStudentIds(new Set());
      setSelectedGroupIds(new Set());
      setManuallyRemovedStudentIds(new Set());
      setManuallyAddedStudentIds(new Set());
      assignTabInitializedRef.current = false;
    } else {
      assignTabInitializedRef.current = true;
    }

    setMeta({ title: '', subject: 'physics', deadline: '', disable_ai_bootstrap: true, exam_type: 'ege', cefr_level: null, feedback_language: 'auto' });
    setTasks([createEmptyTask()]);
    setMaterials([]);
    setNotifyEnabled(true);
    setNotifyTemplate('');
    setSaveAsTemplate(false);
    setSubmitPhase('idle');
    createdAssignmentIdRef.current = null;
    setGroupSelectionDirty(false);
    setErrors({});
    setSuccessResult(null);
    setShowAdvanced(false);
  }, [miniGroupsEnabled, selectedGroupIds]);

  const isSubmitting = submitPhase !== 'idle' && submitPhase !== 'done';
  const hasLegacySelectedSubject =
    meta.subject !== '' && !SUBJECTS.some((subject) => subject.value === meta.subject);
  // Phase 11 (2026-05-31): язык. subjects → показываем CEFR + feedback language
  // селекторы в L0; CEFR обязателен. Mirror backend LANGUAGE_SUBJECTS_REQUIRING_CEFR.
  const isLanguageSubject = ['french', 'english', 'spanish'].includes(meta.subject);

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
      <>
        <HWSubmitSuccess
          result={successResult}
          onCreateAnother={handleCreateAnother}
        />
        <ConnectStudentSheet
          open={connectOpen}
          onOpenChange={handleConnectOpenChange}
          assignmentId={connectAssignmentId}
          students={connectTargets}
        />
      </>
    );
  }

  // ── Edit mode: loading state ──
  if (isEditMode && editQuery.isLoading) {
    return (
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
    );
  }

  // ── Edit mode: error state ──
  if (isEditMode && editQuery.isError) {
    return (
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
    );
  }

  return (
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
              onChange={(e) => {
                const nextSubject = e.target.value as HomeworkSubject;
                // Phase 11: при переключении на языковой subject без заданного уровня —
                // попробовать авто-подставить из текста (если репетитор написал «DELF A2»).
                // Bonus: для image-задач (Эмилия) маркера нет → останется null → required.
                const becameLanguage = ['french', 'english', 'spanish'].includes(nextSubject);
                let nextCefr = meta.cefr_level ?? null;
                if (becameLanguage && !nextCefr) {
                  const haystack = [meta.title, ...tasks.map((t) => t.task_text)].join(' \n ');
                  nextCefr = detectCefrLevelFromText(haystack);
                }
                setMeta({ ...meta, subject: nextSubject, cefr_level: nextCefr });
                if (becameLanguage && nextCefr) {
                  setTasks((prev) => prev.map((t) => ({ ...t, cefr_level: nextCefr })));
                }
              }}
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

        {/* CEFR level + feedback language (L0 — language subjects only, Phase 11).
            Намеренно в L0 (всегда видно), НЕ в L1: required-поле в свёрнутой секции
            повторило бы баг Эмилии «не видела опцию». */}
        {isLanguageSubject && (
          <section id="hw-cefr-section" className="grid gap-4 md:grid-cols-2 rounded-lg border border-accent/30 bg-accent/5 p-4">
            <div className="space-y-2">
              <Label htmlFor="hw-cefr-level">Уровень CEFR *</Label>
              <select
                id="hw-cefr-level"
                value={meta.cefr_level ?? ''}
                onChange={(e) => {
                  const next = e.target.value === '' ? null : (e.target.value as 'A2' | 'B1' | 'B2' | 'C1');
                  setMeta({ ...meta, cefr_level: next });
                  // Каскад в tasks state: cefr_level хранится per-task, поэтому
                  // меняем у всех задач сразу. Это также триггерит tasksDirty
                  // (buildTaskSignature включает cefr_level) → edit save отправит
                  // обновлённые задачи даже если поменяли ТОЛЬКО уровень.
                  setTasks((prev) => prev.map((t) => ({ ...t, cefr_level: next })));
                }}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                style={{ fontSize: '16px', touchAction: 'manipulation' }}
                aria-invalid={errors.cefr_level ? 'true' : undefined}
              >
                <option value="">— выберите уровень —</option>
                <option value="A2">A2</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
                <option value="C1">C1</option>
              </select>
              {errors.cefr_level ? (
                <p className="text-sm text-red-500">{errors.cefr_level}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  AI проверит работу строго по критериям этого уровня (A2 ≈ 60–80 слов, B1 ≈ 160–180). Применится ко всем задачам ДЗ.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="hw-feedback-language">Язык объяснений AI</Label>
              <select
                id="hw-feedback-language"
                value={meta.feedback_language ?? 'auto'}
                onChange={(e) =>
                  setMeta({ ...meta, feedback_language: e.target.value as 'auto' | 'russian' | 'target' })
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                style={{ fontSize: '16px', touchAction: 'manipulation' }}
              >
                <option value="auto">Авто (A2 — русский, B1+ — изучаемый)</option>
                <option value="russian">Русский</option>
                <option value="target">Изучаемый язык</option>
              </select>
              <p className="text-xs text-muted-foreground">
                На каком языке AI пишет feedback ученику. «Авто» — по уровню.
              </p>
            </div>
          </section>
        )}

        {/* Deadline (L0 — optional) */}
        <section className="space-y-2">
          <Label htmlFor="hw-deadline">Дедлайн (необязательно)</Label>
          <DateTimeField
            id="hw-deadline"
            value={meta.deadline}
            onChange={(v) => setMeta({ ...meta, deadline: v })}
            clearable
            className="sm:w-[280px]"
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
            miniGroupsEnabled={miniGroupsEnabled}
            assignTab={assignTab}
            onAssignTabChange={handleAssignTabChange}
            onSelectionInteraction={handleAssignSelectionInteraction}
            groups={groups}
            groupsLoading={groupsLoading}
            groupsError={groupsError}
            onGroupsRetry={refetchGroups}
            groupsIsFetching={groupsIsFetching}
            groupsIsRecovering={groupsIsRecovering}
            groupsFailureCount={groupsFailureCount}
            selectedGroupIds={selectedGroupIds}
            onSelectedGroupIdsChange={setSelectedGroupIds}
            manuallyRemovedIds={manuallyRemovedStudentIds}
            onManuallyRemovedIdsChange={setManuallyRemovedStudentIds}
            manuallyAddedIds={manuallyAddedStudentIds}
            onManuallyAddedIdsChange={setManuallyAddedStudentIds}
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
            assignmentId={isEditMode ? editId : null}
            onRequestPushToKB={isEditMode ? handleRequestPushToKB : undefined}
            voiceSpeakingEnabled={voiceSpeakingEnabled}
            cefrLevelEnabled={['french', 'english', 'spanish'].includes(meta.subject)}
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
            {!showAdvanced && (materials.length > 0 || meta.disable_ai_bootstrap === false || (!isEditMode && createFolderId !== null)) && (
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

                {/* Папка (create-only, запрос Елены 2026-06-17). В edit-режиме
                    скрыто — папкой управляет меню «···» на карточке ДЗ. */}
                {!isEditMode && (
                  <div>
                    <label
                      htmlFor="hw-folder-select"
                      className="block text-sm font-medium text-slate-700 mb-1.5"
                    >
                      Папка
                    </label>
                    <select
                      id="hw-folder-select"
                      value={createFolderId ?? ''}
                      onChange={(e) => setCreateFolderId(e.target.value || null)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      style={{ touchAction: 'manipulation' }}
                    >
                      <option value="">Без папки</option>
                      {homeworkFolders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Для порядка в списке ДЗ. Папку можно создать на странице «Домашние задания».
                    </p>
                  </div>
                )}

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

        {/* Онбординг v2 (T3, review P1 #4): гейт «Подключить» в edit-flow. */}
        <ConnectStudentSheet
          open={connectOpen}
          onOpenChange={handleConnectOpenChange}
          assignmentId={connectAssignmentId}
          students={connectTargets}
        />
      </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorHomeworkCreate() {
  return <TutorHomeworkCreateContent />;
}
