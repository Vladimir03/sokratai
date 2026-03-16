import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
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
  getTutorHomeworkTemplate,
  createTutorHomeworkTemplate,
  type HomeworkSubject,
  type CreateAssignmentTask,
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
  createEmptyTask,
  createEmptyMaterial,
  revokeObjectUrl,
} from '@/components/tutor/homework-create/types';
import { HWStepIndicator } from '@/components/tutor/homework-create/HWStepIndicator';
import { HWTemplatePicker } from '@/components/tutor/homework-create/HWTemplatePicker';
import { HWExpandedParams } from '@/components/tutor/homework-create/HWExpandedParams';
import { HWTasksSection } from '@/components/tutor/homework-create/HWTasksSection';
import { HWAssignSection } from '@/components/tutor/homework-create/HWAssignSection';
import { HWActionBar } from '@/components/tutor/homework-create/HWActionBar';

// ─── Main Wizard Content ─────────────────────────────────────────────────────

function TutorHomeworkCreateContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { tutor } = useTutor();
  const { students: tutorStudents } = useTutorStudents();
  const [step, setStep] = useState(1);
  const { groups } = useTutorGroups(step === 3);
  const { memberships } = useTutorGroupMemberships(step === 3);
  const inviteWebLink = tutor?.invite_code ? getTutorInviteWebLink(tutor.invite_code) : '';
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://sokratai.ru';
  const studentLoginLink = `${appOrigin}/login`;
  const studentSignupLink = `${appOrigin}/signup`;
  const [templateLoading, setTemplateLoading] = useState(false);

  // Step 1
  const [meta, setMeta] = useState<MetaState>({
    title: '',
    subject: '',
    topic: '',
    deadline: '',
    workflow_mode: 'classic',
  });

  // Step 2
  const [tasks, setTasks] = useState<DraftTask[]>([createEmptyTask()]);
  const tasksRef = useRef<DraftTask[]>(tasks);
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);

  // Step 3
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [assignMode, setAssignMode] = useState<'student' | 'group'>('student');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyTemplate, setNotifyTemplate] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // Submit state
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>('idle');
  const createdAssignmentIdRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  // Auto-load template from ?template_id query param
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

  // Apply template from picker sheet
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

  const hasUnsavedChanges = useMemo(() => {
    if (submitPhase === 'done') return false;

    const metaDirty =
      meta.title.trim().length > 0 ||
      meta.subject !== '' ||
      meta.topic.trim().length > 0 ||
      meta.deadline.trim().length > 0;

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
  }, [meta, tasks, selectedStudentIds, notifyEnabled, notifyTemplate, submitPhase]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ── Validation ──

  const validateStep1 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!meta.title.trim()) errs.title = 'Введите название';
    if (!meta.subject) errs.subject = 'Выберите предмет';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [meta]);

  const validateStep2 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
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
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [tasks]);

  const validateStep3 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (selectedStudentIds.size === 0) {
      errs._students = 'Выберите хотя бы одного ученика';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [selectedStudentIds]);

  // ── Navigation ──

  const handleNext = useCallback(() => {
    if (step === 1 && validateStep1()) {
      setErrors({});
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setErrors({});
      setStep(3);
    }
  }, [step, validateStep1, validateStep2]);

  const handleBack = useCallback(() => {
    setErrors({});
    if (step > 1) setStep(step - 1);
  }, [step]);

  const handleNavigateToList = useCallback(() => {
    if (
      hasUnsavedChanges &&
      !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')
    ) {
      return;
    }
    navigate('/tutor/homework');
  }, [hasUnsavedChanges, navigate]);

  // ── Submit ──

  const handleSubmit = useCallback(async () => {
    if (!validateStep3()) return;

    const isRetry = createdAssignmentIdRef.current !== null;
    let assignmentId = createdAssignmentIdRef.current;

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
          title: meta.title.trim(),
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
          const links = kbLinkedTasks.map((t, idx) => ({
            homework_id: assignmentId!,
            task_id: t.kb_task_id!,
            sort_order: tasks.indexOf(t),
            // Save final (possibly edited) values, matching HWDrawer semantics
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
            // Graceful FK handling: retry per-link (same pattern as HWDrawer)
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
            title: meta.title.trim(),
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

      const assignedWithoutTelegramIds = assignResult.students_without_telegram ?? [];
      const assignedWithoutTelegramNames = assignResult.students_without_telegram_names ?? [];

      // Build toast message
      const parts: string[] = [`ДЗ создано, назначено ${assignResult.added} ученикам`];
      if (assignResult.assignment_status !== 'active') {
        parts.push(`Статус задания: ${assignResult.assignment_status}`);
      }
      if (assignedWithoutTelegramIds.length > 0) {
        const previewList = (
          assignedWithoutTelegramNames.length > 0
            ? assignedWithoutTelegramNames
            : assignedWithoutTelegramIds
        ).slice(0, 3);
        const preview = previewList.join(', ');
        const suffix = assignedWithoutTelegramIds.length > 3 ? '...' : '';
        parts.push(
          `Без Telegram-связки: ${assignedWithoutTelegramIds.length} (ДЗ в кабинете назначено, уведомление не отправлено)`,
        );
        if (preview) {
          parts.push(`Ученики без Telegram: ${preview}${suffix}`);
        }
      }
      if (notifyResult) {
        const reasonValues = Object.values(notifyResult.failed_by_reason ?? {});
        const missingTelegramCount = reasonValues.filter(
          (reason) => reason === 'missing_telegram_link',
        ).length;
        const telegramErrorCount = Math.max(notifyResult.failed - missingTelegramCount, 0);

        if (notifyResult.sent > 0) {
          parts.push(`Telegram: отправлено ${notifyResult.sent}`);
        }
        if (missingTelegramCount > 0) {
          parts.push(`Без Telegram для отправки: ${missingTelegramCount}`);
        }
        if (telegramErrorCount > 0) {
          parts.push(`Ошибки доставки Telegram: ${telegramErrorCount}`);
        }
        if (notifyResult.sent === 0 && notifyResult.failed === 0) {
          parts.push('Telegram: нет новых получателей для уведомления');
        }
      } else if (!notifyEnabled) {
        parts.push('Telegram-уведомления отключены');
      }
      toast.success(parts.join('. '));
      if (assignedWithoutTelegramIds.length > 0) {
        const inviteHint = inviteWebLink
          ? `Поделитесь ссылкой приглашения: ${inviteWebLink}`
          : `Дайте ученику ссылку на вход (${studentLoginLink}) или регистрацию (${studentSignupLink})`;
        toast.info(`Для учеников без Telegram: ${inviteHint}`);
      }
      navigate('/tutor/homework');
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
    validateStep3,
    tasks,
    meta,
    selectedStudentIds,
    assignMode,
    selectedGroupId,
    notifyEnabled,
    notifyTemplate,
    materials,
    saveAsTemplate,
    navigate,
    queryClient,
    inviteWebLink,
    studentLoginLink,
    studentSignupLink,
  ]);

  const isSubmitting = submitPhase !== 'idle' && submitPhase !== 'done';

  const submitLabel = (() => {
    switch (submitPhase) {
      case 'creating':
        return 'Создаём ДЗ...';
      case 'adding_materials':
        return 'Добавляем материалы...';
      case 'assigning':
        return 'Назначаем учеников...';
      case 'notifying':
        return 'Отправляем уведомления...';
      default:
        return notifyEnabled ? 'Создать и уведомить' : 'Создать ДЗ';
    }
  })();

  return (
    <TutorLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleNavigateToList} disabled={isSubmitting}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          <h1 className="text-2xl font-bold flex-1">Создание ДЗ</h1>
          {!isSubmitting && (
            <HWTemplatePicker onSelect={handleApplyTemplate} />
          )}
          {templateLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Step indicator */}
        <div className="flex justify-center">
          <HWStepIndicator current={step} total={3} />
        </div>

        {/* Step content */}
        <div className="min-h-[300px]">
          {step === 1 && (
            <HWExpandedParams meta={meta} onChange={setMeta} errors={errors} />
          )}
          {step === 2 && (
            <HWTasksSection
              tasks={tasks}
              onChange={setTasks}
              materials={materials}
              onMaterialsChange={setMaterials}
              errors={errors}
              topicHint={meta.topic}
            />
          )}
          {step === 3 && (
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
            />
          )}
        </div>

        {/* Navigation footer */}
        <HWActionBar
          step={step}
          onBack={handleBack}
          onNext={handleNext}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitPhase={submitPhase}
          submitLabel={submitLabel}
          notifyEnabled={notifyEnabled}
          hasMaterials={materials.length > 0}
          saveAsTemplate={saveAsTemplate}
          onSaveAsTemplateChange={setSaveAsTemplate}
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
