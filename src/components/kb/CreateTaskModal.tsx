import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFolderTree } from '@/hooks/useFolders';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useCreateTask } from '@/hooks/useKnowledgeBase';
import { MAX_TASK_IMAGES } from '@/lib/attachmentRefs';
import {
  deleteKBTaskImage,
  serializeAttachmentUrls,
  uploadKBTaskImage,
} from '@/lib/kbApi';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import {
  loadLastClassification,
  saveLastClassification,
} from '@/lib/kbLastClassification';
import { cn } from '@/lib/utils';
import { ImageUploadField } from '@/components/kb/ui/ImageUploadField';
import {
  TaskClassificationFields,
  type TaskClassType,
} from '@/components/kb/TaskClassificationFields';
// unified-task-model F1 (2026-07-05): паритет AI-настройки с конструктором ДЗ —
// формат проверки + структурные критерии задаются прямо в Базе.
import { CriteriaEditor } from '@/components/task-editor/CriteriaEditor';
import { sumAiGradableCriteriaMax } from '@/lib/gradingCriteriaPresets';
import type { GradingCriterion } from '@/lib/tutorHomeworkApi';
import { resolveTutorDefaultSubject } from '@/lib/tutorSubjects';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import type { KBFolderTreeNode } from '@/types/kb';

interface CreateTaskModalProps {
  /** Pre-selected folder id (e.g. current folder on FolderPage) */
  defaultFolderId?: string;
  onClose: () => void;
}

/** Flatten folder tree into { id, name, depth } for <select> options */
function flattenTree(
  nodes: KBFolderTreeNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

export function CreateTaskModal({ defaultFolderId, onClose }: CreateTaskModalProps) {
  const { tree, loading: treesLoading } = useFolderTree();
  const createTask = useCreateTask();
  // Профиль для дефолта предмета. Кэш card-ключа почти всегда тёплый (SideNav/
  // MobileTopBar монтируют хук глобально) → data доступна синхронно в первый
  // рендер. Холодный кэш → physics; выбор пользователя эффектом НЕ клоббим.
  const { data: tutorProfile } = useTutorProfile();

  // Inherited classification from the last added task (запрос Егора — серия задач)
  const [inherited] = useState(() => loadLastClassification());

  // Primary fields
  const [folderId, setFolderId] = useState<string>(defaultFolderId ?? inherited.folderId ?? '');
  const [text, setText] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Answer / solution (collapsible section)
  const [answer, setAnswer] = useState('');
  const [solution, setSolution] = useState('');
  const [rubricText, setRubricText] = useState('');
  // unified-task-model F1 (2026-07-05): AI-настройка — паритет с конструктором.
  const [checkFormat, setCheckFormat] = useState<'' | 'short_answer' | 'detailed_solution'>('');
  const [criteria, setCriteria] = useState<GradingCriterion[]>([]);
  // Reconcile (mirror конструктора): непустые критерии → primary_score = Σ AI-max.
  const handleCriteriaChange = (next: GradingCriterion[]) => {
    setCriteria(next);
    if (next.length > 0) {
      const total = sumAiGradableCriteriaMax(next);
      if (total > 0) setPrimaryScore(String(Math.round(total)));
    }
  };

  // Classification (cascade) — prefilled from last task
  // Предмет: серия (last-used из kbLastClassification) → профиль → physics.
  const [subject, setSubject] = useState<string>(() =>
    resolveTutorDefaultSubject(tutorProfile?.subjects, inherited.subject ?? null),
  );
  const [taskType, setTaskType] = useState<TaskClassType>(
    (inherited.taskType as TaskClassType) ?? '',
  );
  const [kimNumber, setKimNumber] = useState(inherited.kimNumber ?? '');
  const [difficulty, setDifficulty] = useState(inherited.difficulty ?? '');
  const [primaryScore, setPrimaryScore] = useState(''); // override; пусто = авто по КИМ
  const [topicId, setTopicId] = useState(inherited.topicId ?? '');
  const [subtopicId, setSubtopicId] = useState(inherited.subtopicId ?? '');
  const [sourceLabel, setSourceLabel] = useState(inherited.sourceLabel ?? '');
  const [answerFormat, setAnswerFormat] = useState(inherited.answerFormat ?? '');

  const [showAnswerSection, setShowAnswerSection] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isBusy = uploading || createTask.isPending;

  const conditionImages = useImageUpload({ maxImages: MAX_TASK_IMAGES, disabled: isBusy });
  const solutionImages = useImageUpload({ maxImages: MAX_TASK_IMAGES, disabled: isBusy });

  // Subject change → тема другого предмета → сбросить тему/подтему.
  const handleSubjectChange = (v: string) => {
    setSubject(v);
    setTopicId('');
    setSubtopicId('');
  };
  // Type change → reset dependent fields (тема/подтема, балл, противоположное КИМ/сложность)
  const handleTaskTypeChange = (v: TaskClassType) => {
    setTaskType(v);
    setTopicId('');
    setSubtopicId('');
    setPrimaryScore('');
    if (v === 'olympiad') setKimNumber('');
    else setDifficulty('');
  };
  const handleKimChange = (v: string) => {
    setKimNumber(v);
    setPrimaryScore(''); // снять ручной override → авто-балл по новому № КИМ
  };
  const handleTopicChange = (v: string) => {
    setTopicId(v);
    setSubtopicId('');
  };

  // Auto-select defaultFolderId when tree loads
  useEffect(() => {
    if (defaultFolderId && !folderId) {
      setFolderId(defaultFolderId);
    }
  }, [defaultFolderId, folderId]);

  // Esc to close + body scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Validation: folder + (text OR image) + (для олимпиады обязателен уровень сложности)
  const hasContent = text.trim().length > 0 || conditionImages.totalImages > 0;
  const olympiadNeedsDifficulty = taskType === 'olympiad' && !difficulty.trim();
  const canSave = hasContent && folderId !== '' && !olympiadNeedsDifficulty;

  const handleSave = async (keepOpen: boolean) => {
    if (!canSave || !folderId || isBusy) return;

    setUploading(true);
    const conditionRefs: string[] = [];
    const solutionRefs: string[] = [];
    try {
      for (const file of conditionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        conditionRefs.push(result.storageRef);
      }
      for (const file of solutionImages.getNewFiles()) {
        const result = await uploadKBTaskImage(file);
        solutionRefs.push(result.storageRef);
      }

      const attachmentUrl = serializeAttachmentUrls(conditionRefs) ?? undefined;
      const solutionAttachmentUrl = serializeAttachmentUrls(solutionRefs) ?? undefined;
      const taskText = text.trim() || '[Задача на фото]';

      const exam = taskType === 'ege' ? 'ege' : taskType === 'oge' ? 'oge' : undefined;
      const kimNum =
        taskType !== 'olympiad' && kimNumber.trim() ? parseInt(kimNumber.trim(), 10) : undefined;

      // Балл: олимпиада → сложность; ЕГЭ/ОГЭ → ручной override или авто по ФИПИ.
      let difficultyNum: number | undefined;
      let scoreNum: number | undefined;
      if (taskType === 'olympiad') {
        difficultyNum = difficulty.trim() ? parseInt(difficulty.trim(), 10) : undefined;
        scoreNum = difficultyNum;
      } else {
        // Авто-балл по КИМ — только физика; обществознание → ручной (или пусто).
        const autoScore = getKimPrimaryScoreForSubject(subject, exam ?? null, kimNum ?? null);
        const s = primaryScore.trim() || (autoScore != null ? String(autoScore) : '');
        scoreNum = s ? parseInt(s, 10) : undefined;
      }

      // await — чтобы `uploading` (→ isBusy → кнопки disabled) держался до конца
      // мутации; cleanup залитых refs — в catch (review fix P1 #2).
      await createTask.mutateAsync({
        folder_id: folderId,
        text: taskText,
        answer: answer.trim() || undefined,
        solution: solution.trim() || undefined,
        rubric_text: rubricText.trim() || undefined,
        exam: exam || undefined,
        answer_format: answerFormat || undefined,
        attachment_url: attachmentUrl,
        solution_attachment_url: solutionAttachmentUrl,
        kim_number: kimNum && !isNaN(kimNum) ? kimNum : undefined,
        primary_score: scoreNum && !isNaN(scoreNum) ? scoreNum : undefined,
        difficulty: difficultyNum && !isNaN(difficultyNum) ? difficultyNum : undefined,
        topic_id: topicId || undefined,
        subtopic_id: subtopicId || undefined,
        source_label: sourceLabel.trim() || undefined,
        // unified-task-model F1: AI-настройка — паритет с конструктором ДЗ.
        check_format: checkFormat || undefined,
        grading_criteria_json: criteria.length > 0 ? criteria : undefined,
      });

      saveLastClassification({
        subject,
        taskType,
        kimNumber,
        difficulty,
        topicId,
        subtopicId,
        sourceLabel,
        answerFormat,
        folderId,
      });
      if (keepOpen) {
        // Серия: чистим только контент, классификацию + рубрику оставляем.
        setText('');
        setAnswer('');
        setSolution('');
        conditionImages.reset();
        solutionImages.reset();
        toast.success('Задача создана — добавляйте следующую');
        requestAnimationFrame(() => textRef.current?.focus());
      } else {
        toast.success('Задача создана');
        onClose();
      }
    } catch {
      for (const ref of conditionRefs) void deleteKBTaskImage(ref);
      for (const ref of solutionRefs) void deleteKBTaskImage(ref);
      toast.error('Не удалось сохранить задачу');
    } finally {
      setUploading(false);
    }
  };

  const flatFolders = flattenTree(tree);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">Новая задача</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="relative flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* ── Условие ── */}

          {/* Folder select */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Папка в базе <span className="text-red-500">*</span>
            </legend>
            <div className="relative">
              <Folder className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-socrat-folder" />
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-socrat-border py-2 pl-8 pr-8 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
              >
                <option value="">Выберите папку…</option>
                {treesLoading ? (
                  <option disabled>Загрузка…</option>
                ) : (
                  flatFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {'　'.repeat(f.depth)}{f.depth > 0 ? '└ ' : ''}{f.name}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            {tree.length === 0 && !treesLoading && (
              <p className="mt-1 text-xs text-socrat-muted">
                Нет папок. Создайте папку в «Моя база».
              </p>
            )}
          </fieldset>

          {/* Task text */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">
              Условие задачи {conditionImages.totalImages === 0 && <span className="text-red-500">*</span>}
            </legend>
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={conditionImages.handlePaste}
              rows={4}
              placeholder={
                conditionImages.totalImages > 0
                  ? 'Описание (опционально — фото прикреплено)'
                  : 'Введите условие задачи или вставьте скриншот…'
              }
              className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
            />
          </fieldset>

          {/* Condition images */}
          <ImageUploadField label="Фото условия" imageUpload={conditionImages} disabled={isBusy} />

          {/* Validation hint */}
          {!hasContent && (
            <p className="text-xs text-amber-600">
              Заполните условие задачи или прикрепите хотя бы одно фото
            </p>
          )}

          {/* ── Классификация (видна всегда) ── */}
          <div className="space-y-4 rounded-lg border border-socrat-border/50 bg-slate-50/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Классификация
            </div>
            <TaskClassificationFields
              subject={subject}
              onSubjectChange={handleSubjectChange}
              taskType={taskType}
              kimNumber={kimNumber}
              difficulty={difficulty}
              primaryScore={primaryScore}
              topicId={topicId}
              subtopicId={subtopicId}
              sourceLabel={sourceLabel}
              answerFormat={answerFormat}
              onTaskTypeChange={handleTaskTypeChange}
              onKimNumberChange={handleKimChange}
              onDifficultyChange={setDifficulty}
              onPrimaryScoreChange={setPrimaryScore}
              onTopicIdChange={handleTopicChange}
              onSubtopicIdChange={setSubtopicId}
              onSourceLabelChange={setSourceLabel}
              onAnswerFormatChange={setAnswerFormat}
              disabled={isBusy}
            />
          </div>

          {/* ── Ответ и решение (сворачиваемо) ── */}
          <button
            type="button"
            onClick={() => setShowAnswerSection((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium text-socrat-primary hover:underline"
          >
            {showAnswerSection ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Ответ и решение
          </button>

          {showAnswerSection && (
            <div className="space-y-4 rounded-lg border border-socrat-border/50 bg-slate-50/50 p-4">
              {/* Answer */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Ответ</legend>
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Правильный ответ"
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>

              {/* Solution */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Решение / пояснение</legend>
                <textarea
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  onPaste={solutionImages.handlePaste}
                  rows={3}
                  placeholder="Подробное решение (опционально) или вставьте скриншот…"
                  className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>

              {/* Solution images */}
              <ImageUploadField label="Фото решения" imageUpload={solutionImages} disabled={isBusy} />

              {/* unified-task-model F1 (2026-07-05): формат проверки — паритет с
                  конструктором ДЗ (nullable: «Не указан» = derive при импорте). */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">Формат проверки</legend>
                <select
                  value={checkFormat}
                  onChange={(e) => setCheckFormat(e.target.value as '' | 'short_answer' | 'detailed_solution')}
                  disabled={isBusy}
                  className="w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none"
                >
                  <option value="">Не указан (определится по № КИМ)</option>
                  <option value="short_answer">Краткий ответ</option>
                  <option value="detailed_solution">Развёрнутое решение</option>
                </select>
              </fieldset>

              {/* unified-task-model F1: структурные критерии (тот же редактор,
                  что в конструкторе ДЗ) — едут в ДЗ при импорте без потерь. */}
              <CriteriaEditor
                criteria={criteria}
                taskMaxScore={(() => {
                  const s = parseInt(primaryScore.trim(), 10);
                  return Number.isFinite(s) && s > 0 ? s : sumAiGradableCriteriaMax(criteria) || 1;
                })()}
                onChange={handleCriteriaChange}
              />

              {/* Rubric / criteria (field-parity fix 2026-06-03) — переносятся в ДЗ. */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-500">
                  {criteria.length > 0 ? 'Дополнительные заметки для AI' : 'Критерии оценки'}
                </legend>
                <textarea
                  value={rubricText}
                  onChange={(e) => setRubricText(e.target.value)}
                  rows={3}
                  placeholder="Как начислять баллы (используется AI при проверке). Например: «Полное решение — 2 балла; ошибка в знаке — минус 1 балл»."
                  className="w-full resize-y rounded-lg border border-socrat-border px-3 py-2.5 text-[16px] leading-relaxed transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
                />
              </fieldset>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="mr-auto rounded-lg border border-socrat-border bg-transparent px-4 py-2 text-[13px] text-muted-foreground [touch-action:manipulation]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={!canSave || isBusy}
            className={cn(
              'rounded-lg border px-4 py-2 text-[13px] font-semibold [touch-action:manipulation]',
              canSave && !isBusy
                ? 'border-socrat-primary/30 bg-socrat-primary-light text-socrat-primary'
                : 'cursor-default border-socrat-border text-socrat-border',
            )}
          >
            Сохранить и добавить ещё
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={!canSave || isBusy}
            className={cn(
              'rounded-lg px-4 py-2 text-[13px] font-semibold text-white [touch-action:manipulation]',
              canSave && !isBusy
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border',
            )}
          >
            {isBusy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  );
}
