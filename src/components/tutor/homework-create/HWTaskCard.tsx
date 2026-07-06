import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Trash2,
  Dices,
  Plus,
  ChevronDown,
  ChevronUp,
  BookmarkPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  uploadTutorHomeworkTaskImage,
  deleteTutorHomeworkTaskImage,
} from '@/lib/tutorHomeworkApi';
import { FullscreenImageCarousel } from '@/components/homework/shared/FullscreenImageCarousel';
import { useKBImagesSignedUrls } from '@/hooks/useKBImagesSignedUrls';
import {
  parseAttachmentUrls,
  serializeAttachmentUrls,
  MAX_TASK_IMAGES,
  MAX_RUBRIC_IMAGES,
  MAX_SOLUTION_IMAGES,
} from '@/lib/attachmentRefs';
import { compressForUpload } from '@/lib/imageCompression';
import { usePasteImages } from '@/hooks/usePasteImages';
import { useDragDropFiles } from '@/hooks/useDragDropFiles';
import { cn } from '@/lib/utils';

import { SourceBadge } from '@/components/kb/ui/SourceBadge';
// unified-task-model F0 (2026-07-05): секции извлечены в общий task-editor
// (нулевой по поведению рефактор) — их же используют КБ-модалки (F1).
import { PhotoGallery } from '@/components/task-editor/PhotoGallery';
import { SolutionField } from '@/components/task-editor/SolutionField';
import { RubricField } from '@/components/task-editor/RubricField';
import { CriteriaEditor } from '@/components/task-editor/CriteriaEditor';
import { CheckFormatField } from '@/components/task-editor/CheckFormatField';
// unified-task-model F2 (2026-07-05): каскад классификации (Тип → № КИМ →
// Тема/Подтема) — ТОТ ЖЕ компонент, что в Базе (решение владельца №2).
import { TaskClassificationFields, type TaskClassType } from '@/components/kb/TaskClassificationFields';
import { getKimPrimaryScore } from '@/lib/kbKimScores';
import { type DraftTask, type GradingCriterion, MAX_IMAGE_SIZE_BYTES, IMAGE_REQUIREMENTS_HINT, computeTaskContentFingerprint, revokeObjectUrl } from './types';
import { sumAiGradableCriteriaMax } from '@/lib/gradingCriteriaPresets';

// ─── Drag-drop overlay (Phase 9, 2026-05-25) ─────────────────────────────────
// Внутри section-обёрток. Появляется когда useDragDropFiles.isDragging === true.
// `pointer-events-none` обязателен — иначе overlay перехватывает drop event
// и hook не fire'ит. Section wrapper держит `relative` для absolute positioning.

const DropOverlay = memo(function DropOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-accent/10 backdrop-blur-[1px] ring-2 ring-dashed ring-accent"
      aria-hidden="true"
    >
      <p className="text-sm font-medium text-accent">Отпустите для добавления</p>
    </div>
  );
});

// ─── Task card ────────────────────────────────────────────────────────────────

export interface HWTaskCardProps {
  task: DraftTask;
  index: number;
  onUpdate: (t: DraftTask) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** When set, defer storage image deletes instead of executing immediately (edit mode safety) */
  onDeferImageDelete?: (storagePath: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  /**
   * homework-reuse-v1 TASK-5 (AC-13): if provided AND `task.id` is set, render
   * a BookmarkPlus action that opens the Save-to-KB dialog for this task only.
   * Parent (HWTasksSection) owns the dialog lifecycle — HWTaskCard does not
   * know about the KB API. Icon suppressed when task.id is absent (новый draft,
   * ещё не сохранён в БД — backend handler требует реальный UUID).
   */
  onRequestSaveToKB?: (task: DraftTask) => void;
  /**
   * voice-speaking-mvp: when true (tutor has `feature_voice_speaking_enabled`),
   * show the «Устный ответ (монолог)» task-type option. Off by default — gated
   * to pilot tutors only.
   */
  voiceSpeakingEnabled?: boolean;
  /**
   * CEFR-level fix (2026-05-29): when true (foreign-language subject), show the
   * «Уровень (CEFR)» selector. Off → selector hidden (non-language subjects).
   */
  cefrLevelEnabled?: boolean;
  /**
   * Criteria-grading feature (2026-06): when true (non-numeric / развёрнутая
   * задача), show the structured criteria editor + preset button. Off → hidden
   * (numeric tasks grade by exact-answer match, no per-criterion breakdown).
   */
  criteriaEditorEnabled?: boolean;
  /**
   * unified-task-model F2 (2026-07-05): «Обновить в Базе» / «Создать свою
   * копию» — пуш diverged-снимка обратно в задачу-источник Базы (edit-mode
   * only: требует persisted task.id + kb_task_id). Parent (TutorHomeworkCreate)
   * владеет API-вызовом и dirty-гейтом. Кнопка видна ТОЛЬКО при реальном
   * расхождении с fingerprint-снимком импорта.
   */
  onRequestPushToKB?: (task: DraftTask) => void;
}

export function HWTaskCard({
  task,
  index,
  onUpdate,
  onRemove,
  canRemove,
  onDeferImageDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onRequestSaveToKB,
  voiceSpeakingEnabled = false,
  cefrLevelEnabled = false,
  criteriaEditorEnabled = false,
  onRequestPushToKB,
}: HWTaskCardProps) {
  const taskRefs = useMemo(() => parseAttachmentUrls(task.task_image_path), [task.task_image_path]);
  const rubricRefs = useMemo(() => parseAttachmentUrls(task.rubric_image_paths), [task.rubric_image_paths]);
  const solutionRefs = useMemo(() => parseAttachmentUrls(task.solution_image_paths), [task.solution_image_paths]);

  // Local blob preview URLs keyed by storage ref (only for this-session uploads).
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<{ gallery: 'task' | 'rubric' | 'solution'; index: number } | null>(null);
  // Раздельный draft-state для max_score input: позволяет ученику тутору ввести
  // «12.», прежде чем дописать «5», без потери промежуточных нажатий. Snap к
  // шагу 0.5 происходит на blur (см. handleScoreBlur ниже). Sync from outside —
  // reorder, KB import — через useEffect на task.max_score.
  const [scoreText, setScoreText] = useState<string>(() => String(task.max_score));
  useEffect(() => {
    setScoreText(String(task.max_score));
  }, [task.max_score]);

  // unified-task-model F2: авто-балл ФИПИ по классификации (объявлен ДО
  // handleScoreBlur — тот читает его в deps).
  const autoScore = useMemo(() => {
    if (task.exam === 'olympiad') {
      return task.difficulty != null && task.difficulty >= 1 ? task.difficulty : null;
    }
    const examForScore = task.exam === 'ege' ? 'ege' : task.exam === 'oge' ? 'oge' : null;
    return getKimPrimaryScore(examForScore, task.kim_number ?? null);
  }, [task.exam, task.kim_number, task.difficulty]);

  // Ревью-фикс P1 (2026-07-06): «тутор трогал балл руками» — ЯВНЫЙ флаг вместо
  // value-эвристики (`max===1` ломалась: ручной балл «1» затирался авто-баллом,
  // а ручной балл, случайно равный авто, «прилипал»). Lazy-init по состоянию
  // на mount: дефолт 1 или == текущему авто → считаем нетронутым.
  const scoreTouchedRef = useRef<boolean | null>(null);
  if (scoreTouchedRef.current === null) {
    scoreTouchedRef.current = !(task.max_score === 1 || (autoScore != null && task.max_score === autoScore));
  }

  const handleScoreBlur = useCallback(() => {
    const raw = scoreText.replace(',', '.').trim();
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < 0.5) {
      // Fallback к дефолту 1 = «не тронуто» (авто-балл снова может применяться).
      scoreTouchedRef.current = false;
      onUpdate({ ...task, max_score: 1 });
      setScoreText('1');
      return;
    }
    // Snap к ближайшему 0.5 (12.7 → 12.5, 0.3 → 0.5, 100.4 → 100.5).
    const snapped = Math.round(v * 2) / 2;
    // «Тронуто», если введённое значение — не текущий авто-балл (введённый
    // руками ФИПИ-балл эквивалентен авто → считаем нетронутым).
    scoreTouchedRef.current = autoScore == null ? snapped !== 1 : snapped !== autoScore;
    onUpdate({ ...task, max_score: snapped });
    setScoreText(String(snapped));
  }, [scoreText, task, onUpdate, autoScore]);

  // Criteria-grading feature (2026-06): when the structured criteria change,
  // persist grading_criteria_json AND auto-reconcile max_score = Σ criteria max
  // (engine needs max_score == Σ AI-gradable max; warn only on manual divergence).
  const criteriaList = useMemo<GradingCriterion[]>(
    () => (Array.isArray(task.grading_criteria_json) ? task.grading_criteria_json : []),
    [task.grading_criteria_json],
  );
  const handleCriteriaChange = useCallback(
    (next: GradingCriterion[]) => {
      if (next.length === 0) {
        onUpdate({ ...task, grading_criteria_json: null });
        return;
      }
      // max_score = Σ AI-gradable max (excl. tutor_only) — движок требует
      // max_score == aiGradableMax (иначе ремап искажает баллы). Review fix P1.
      const total = sumAiGradableCriteriaMax(next);
      const snapped = total > 0 ? Math.round(total * 2) / 2 : task.max_score;
      // Σ-балл — намеренный: авто-балл ФИПИ не должен молча затирать его
      // после удаления критериев («Сбросить» вернёт при желании).
      scoreTouchedRef.current = true;
      onUpdate({ ...task, grading_criteria_json: next, max_score: snapped });
    },
    [task, onUpdate],
  );
  // unified-task-model F2 (2026-07-05): каскад классификации + авто-балл + divergence.
  // Секция default-open всегда — № КИМ должен быть на виду (запрос Егора:
  // «как система поймёт, что это за КИМ?»); сворачивание — опция экономии места.
  const [classificationOpen, setClassificationOpen] = useState<boolean>(true);

  /**
   * Применить авто-балл только если тутор его не переопределял (scoreTouchedRef).
   * Критерии выигрывают (Σ критериев управляет max_score — не трогаем).
   */
  const applyAutoScore = useCallback(
    (patch: Partial<DraftTask>): Partial<DraftTask> => {
      const next = { ...task, ...patch };
      if (Array.isArray(next.grading_criteria_json) && next.grading_criteria_json.length > 0) {
        return patch;
      }
      const nextAuto = next.exam === 'olympiad'
        ? (next.difficulty != null && next.difficulty >= 1 ? next.difficulty : null)
        : getKimPrimaryScore(
            next.exam === 'ege' ? 'ege' : next.exam === 'oge' ? 'oge' : null,
            next.kim_number ?? null,
          );
      if (nextAuto == null) return patch;
      return scoreTouchedRef.current !== true ? { ...patch, max_score: nextAuto } : patch;
    },
    [task],
  );

  // Divergence «Обновить в Базе»: только при fingerprint-снимке импорта и
  // реальном отличии текущего контента от него.
  const pushDiverged = useMemo(
    () =>
      task.kb_content_fingerprint != null &&
      computeTaskContentFingerprint(task) !== task.kb_content_fingerprint,
    [task],
  );

  // Ref mirrors created blob URLs so unmount cleanup sees the latest set (closure over [] would be stale).
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const { urls: resolvedTaskUrls } = useKBImagesSignedUrls(taskRefs, { enabled: taskRefs.length > 0 });
  const { urls: resolvedRubricUrls } = useKBImagesSignedUrls(rubricRefs, { enabled: rubricRefs.length > 0 });
  const { urls: resolvedSolutionUrls } = useKBImagesSignedUrls(solutionRefs, { enabled: solutionRefs.length > 0 });
  const taskZoomItems = useMemo(
    () =>
      taskRefs
        .map((ref) => ({
          ref,
          url: previewUrls[ref] ?? resolvedTaskUrls[ref] ?? null,
        }))
        .filter((item): item is { ref: string; url: string } => Boolean(item.url)),
    [previewUrls, resolvedTaskUrls, taskRefs],
  );
  const rubricZoomItems = useMemo(
    () =>
      rubricRefs
        .map((ref) => ({
          ref,
          url: previewUrls[ref] ?? resolvedRubricUrls[ref] ?? null,
        }))
        .filter((item): item is { ref: string; url: string } => Boolean(item.url)),
    [previewUrls, resolvedRubricUrls, rubricRefs],
  );
  const solutionZoomItems = useMemo(
    () =>
      solutionRefs
        .map((ref) => ({
          ref,
          url: previewUrls[ref] ?? resolvedSolutionUrls[ref] ?? null,
        }))
        .filter((item): item is { ref: string; url: string } => Boolean(item.url)),
    [previewUrls, resolvedSolutionUrls, solutionRefs],
  );
  const taskZoomImages = useMemo(
    () => taskZoomItems.map((item) => item.url),
    [taskZoomItems],
  );
  const rubricZoomImages = useMemo(
    () => rubricZoomItems.map((item) => item.url),
    [rubricZoomItems],
  );
  const solutionZoomImages = useMemo(
    () => solutionZoomItems.map((item) => item.url),
    [solutionZoomItems],
  );
  const zoomImages =
    zoom?.gallery === 'solution'
      ? solutionZoomImages
      : zoom?.gallery === 'rubric'
      ? rubricZoomImages
      : taskZoomImages;

  const openTaskZoom = useCallback(
    (refIndex: number) => {
      const ref = taskRefs[refIndex];
      const imageIndex = taskZoomItems.findIndex((item) => item.ref === ref);
      if (imageIndex >= 0) {
        setZoom({ gallery: 'task', index: imageIndex });
      }
    },
    [taskRefs, taskZoomItems],
  );

  const openRubricZoom = useCallback(
    (refIndex: number) => {
      const ref = rubricRefs[refIndex];
      const imageIndex = rubricZoomItems.findIndex((item) => item.ref === ref);
      if (imageIndex >= 0) {
        setZoom({ gallery: 'rubric', index: imageIndex });
      }
    },
    [rubricRefs, rubricZoomItems],
  );

  const openSolutionZoom = useCallback(
    (refIndex: number) => {
      const ref = solutionRefs[refIndex];
      const imageIndex = solutionZoomItems.findIndex((item) => item.ref === ref);
      if (imageIndex >= 0) {
        setZoom({ gallery: 'solution', index: imageIndex });
      }
    },
    [solutionRefs, solutionZoomItems],
  );

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => revokeObjectUrl(url));
      urls.clear();
    };
  }, []);

  const uploadFiles = useCallback(
    async (
      files: File[],
      max: number,
      existingRefs: string[],
      onPreviewReady?: (tempRefs: string[], tempPreviews: Record<string, string>) => void,
      onPreviewError?: (tempRefs: string[]) => void,
    ): Promise<{
      newRefs: string[];
      newPreviews: Record<string, string>;
      tempRefs: string[];
      anyFallback: boolean;
    } | null> => {
      const remaining = max - existingRefs.length;
      if (remaining <= 0) {
        toast.warning(`Можно прикрепить максимум ${max} фото`);
        return null;
      }

      const truncated = files.slice(0, remaining);
      if (files.length > remaining) {
        toast.warning(`Можно прикрепить максимум ${max} фото — добавлено ${remaining}`);
      }

      // Compress images before upload (≤ 2048px long side, ≤ 4 MB JPEG).
      // PDF / non-image / HEIC-on-desktop pass through unchanged. Screenshots
      // from clipboard are typically 5-15 MB PNG → 1-3 MB JPEG after compress.
      const validFiles: File[] = [];
      for (const f of truncated) {
        let processed: File;
        try {
          processed = await compressForUpload(f);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : `Не удалось обработать «${f.name || 'без имени'}»`,
          );
          continue;
        }
        if (processed.size > MAX_IMAGE_SIZE_BYTES) {
          toast.error(`Файл «${processed.name || 'без имени'}» больше 10 МБ`);
          continue;
        }
        validFiles.push(processed);
      }
      if (!validFiles.length) return null;

      const blobUrls = validFiles.map((f) => URL.createObjectURL(f));
      const tempRefs = [...blobUrls];
      const tempPreviews = tempRefs.reduce<Record<string, string>>((acc, ref, index) => {
        acc[ref] = blobUrls[index];
        return acc;
      }, {});
      blobUrls.forEach((u) => blobUrlsRef.current.add(u));
      onPreviewReady?.(tempRefs, tempPreviews);
      try {
        const results = await Promise.all(validFiles.map((f) => uploadTutorHomeworkTaskImage(f)));
        const newRefs = results.map((r) => r.storageRef);
        const newPreviews: Record<string, string> = {};
        newRefs.forEach((ref, i) => {
          newPreviews[ref] = blobUrls[i];
        });
        const anyFallback = results.some((r) => r.usedFallback);
        return { newRefs, newPreviews, tempRefs, anyFallback };
      } catch (err) {
        blobUrls.forEach((u) => {
          revokeObjectUrl(u);
          blobUrlsRef.current.delete(u);
        });
        onPreviewError?.(tempRefs);
        toast.error(
          `Ошибка загрузки: ${err instanceof Error ? err.message : 'неизвестная ошибка'}. Попробуйте ещё раз.`,
        );
        return null;
      }
    },
    [],
  );

  const addTaskPhotos = useCallback(
    async (files: File[]) => {
      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }
      const currentRefs = parseAttachmentUrls(task.task_image_path);
      onUpdate({ ...task, uploading: true });
      const result = await uploadFiles(
        files,
        MAX_TASK_IMAGES,
        currentRefs,
        (tempRefs, tempPreviews) => {
          const optimisticRefs = [...currentRefs, ...tempRefs].slice(0, MAX_TASK_IMAGES);
          setPreviewUrls((prev) => ({ ...prev, ...tempPreviews }));
          onUpdate({
            ...task,
            task_image_path: serializeAttachmentUrls(optimisticRefs),
            uploading: true,
          });
        },
        (tempRefs) => {
          setPreviewUrls((prev) => {
            const next = { ...prev };
            tempRefs.forEach((ref) => {
              delete next[ref];
            });
            return next;
          });
        },
      );
      if (!result) {
        onUpdate({ ...task, uploading: false });
        return;
      }
      const combined = [...currentRefs, ...result.newRefs].slice(0, MAX_TASK_IMAGES);
      setPreviewUrls((prev) => {
        const next = { ...prev, ...result.newPreviews };
        result.tempRefs.forEach((ref) => {
          delete next[ref];
        });
        return next;
      });
      onUpdate({
        ...task,
        task_image_path: serializeAttachmentUrls(combined),
        uploading: false,
      });
      toast.success(
        result.newRefs.length === 1
          ? 'Изображение загружено'
          : `Загружено изображений: ${result.newRefs.length}`,
      );
      if (result.anyFallback) {
        toast.warning('Основной bucket недоступен, использован резервный канал загрузки.');
      }
    },
    [task, onUpdate, uploadFiles],
  );

  const addRubricPhotos = useCallback(
    async (files: File[]) => {
      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }
      const currentRefs = parseAttachmentUrls(task.rubric_image_paths);
      onUpdate({ ...task, uploading: true });
      const result = await uploadFiles(
        files,
        MAX_RUBRIC_IMAGES,
        currentRefs,
        (tempRefs, tempPreviews) => {
          const optimisticRefs = [...currentRefs, ...tempRefs].slice(0, MAX_RUBRIC_IMAGES);
          setPreviewUrls((prev) => ({ ...prev, ...tempPreviews }));
          onUpdate({
            ...task,
            rubric_image_paths: serializeAttachmentUrls(optimisticRefs),
            uploading: true,
          });
        },
        (tempRefs) => {
          setPreviewUrls((prev) => {
            const next = { ...prev };
            tempRefs.forEach((ref) => {
              delete next[ref];
            });
            return next;
          });
        },
      );
      if (!result) {
        onUpdate({ ...task, uploading: false });
        return;
      }
      const combined = [...currentRefs, ...result.newRefs].slice(0, MAX_RUBRIC_IMAGES);
      setPreviewUrls((prev) => {
        const next = { ...prev, ...result.newPreviews };
        result.tempRefs.forEach((ref) => {
          delete next[ref];
        });
        return next;
      });
      onUpdate({
        ...task,
        rubric_image_paths: serializeAttachmentUrls(combined),
        uploading: false,
      });
      toast.success(
        result.newRefs.length === 1
          ? 'Изображение загружено'
          : `Загружено изображений: ${result.newRefs.length}`,
      );
      if (result.anyFallback) {
        toast.warning('Основной bucket недоступен, использован резервный канал загрузки.');
      }
    },
    [task, onUpdate, uploadFiles],
  );

  const addSolutionPhotos = useCallback(
    async (files: File[]) => {
      if (task.uploading) {
        toast.warning('Дождись завершения текущей загрузки.');
        return;
      }
      const currentRefs = parseAttachmentUrls(task.solution_image_paths);
      onUpdate({ ...task, uploading: true });
      const result = await uploadFiles(
        files,
        MAX_SOLUTION_IMAGES,
        currentRefs,
        (tempRefs, tempPreviews) => {
          const optimisticRefs = [...currentRefs, ...tempRefs].slice(0, MAX_SOLUTION_IMAGES);
          setPreviewUrls((prev) => ({ ...prev, ...tempPreviews }));
          onUpdate({
            ...task,
            solution_image_paths: serializeAttachmentUrls(optimisticRefs),
            uploading: true,
          });
        },
        (tempRefs) => {
          setPreviewUrls((prev) => {
            const next = { ...prev };
            tempRefs.forEach((ref) => {
              delete next[ref];
            });
            return next;
          });
        },
      );
      if (!result) {
        onUpdate({ ...task, uploading: false });
        return;
      }
      const combined = [...currentRefs, ...result.newRefs].slice(0, MAX_SOLUTION_IMAGES);
      setPreviewUrls((prev) => {
        const next = { ...prev, ...result.newPreviews };
        result.tempRefs.forEach((ref) => {
          delete next[ref];
        });
        return next;
      });
      onUpdate({
        ...task,
        solution_image_paths: serializeAttachmentUrls(combined),
        uploading: false,
      });
      toast.success(
        result.newRefs.length === 1
          ? 'Изображение загружено'
          : `Загружено изображений: ${result.newRefs.length}`,
      );
      if (result.anyFallback) {
        toast.warning('Основной bucket недоступен, использован резервный канал загрузки.');
      }
    },
    [task, onUpdate, uploadFiles],
  );

  const removePhoto = useCallback(
    (target: 'task' | 'rubric' | 'solution', idx: number) => {
      const field =
        target === 'task'
          ? 'task_image_path'
          : target === 'rubric'
          ? 'rubric_image_paths'
          : 'solution_image_paths';
      const refs = parseAttachmentUrls(task[field]);
      const removedRef = refs[idx];
      if (!removedRef) return;

      if (onDeferImageDelete) {
        onDeferImageDelete(removedRef);
      } else {
        void deleteTutorHomeworkTaskImage(removedRef);
      }

      const preview = previewUrls[removedRef];
      if (preview) {
        revokeObjectUrl(preview);
        blobUrlsRef.current.delete(preview);
        setPreviewUrls((prev) => {
          const next = { ...prev };
          delete next[removedRef];
          return next;
        });
      }

      const nextRefs = refs.filter((_, i) => i !== idx);
      onUpdate({ ...task, [field]: serializeAttachmentUrls(nextRefs) });
    },
    [task, onUpdate, onDeferImageDelete, previewUrls],
  );

  const removeTaskPhoto = useCallback(
    (idx: number) => removePhoto('task', idx),
    [removePhoto],
  );
  const removeRubricPhoto = useCallback(
    (idx: number) => removePhoto('rubric', idx),
    [removePhoto],
  );
  const removeSolutionPhoto = useCallback(
    (idx: number) => removePhoto('solution', idx),
    [removePhoto],
  );

  // Last-focused section determines where pasted screenshots land. Default
  // 'task' — pasting from the title input or before opening solution/rubric
  // accordion still works intuitively. Updated via onFocus on section wrappers.
  const lastFocusedSection = useRef<'task' | 'solution' | 'rubric'>('task');

  // Card-level paste handler: routes to the active section. Single source of
  // truth for Ctrl+V on this card — no per-textarea onPaste handlers.
  const handleCardPaste = usePasteImages({
    enabled: !task.uploading,
    onImagePasted: async (file: File) => {
      const section = lastFocusedSection.current;
      if (section === 'solution') {
        await addSolutionPhotos([file]);
      } else if (section === 'rubric') {
        await addRubricPhotos([file]);
      } else {
        await addTaskPhotos([file]);
      }
    },
    // compressForUpload is already applied inside addTaskPhotos/addSolutionPhotos/
    // addRubricPhotos (via uploadFiles). Skip here to avoid double-compress.
    compress: false,
    successToast: null, // addTaskPhotos shows its own success toast
    telemetryTag: 'hw_task_paste',
  });

  // Phase 9 (2026-05-25): drag-and-drop в каждой из 3 секций. Per-section hooks
  // вместо одного card-level — drag-drop НЕ имеет last-focused fallback (как
  // paste), drop landing должен быть unambiguous. Routing идёт по тому, в какой
  // wrapper упал файл. Compression false по той же причине, что у paste — она
  // уже происходит в addTaskPhotos / addSolutionPhotos / addRubricPhotos.

  const taskDragDrop = useDragDropFiles({
    enabled: !task.uploading,
    maxFiles: MAX_TASK_IMAGES,
    currentCount: taskRefs.length,
    onFilesDropped: async (files: File[]) => {
      await addTaskPhotos(files);
    },
    compress: false,
    successToast: null,
    telemetryTag: 'hw_task_drop',
  });

  const solutionDragDrop = useDragDropFiles({
    enabled: !task.uploading,
    maxFiles: MAX_SOLUTION_IMAGES,
    currentCount: solutionRefs.length,
    onFilesDropped: async (files: File[]) => {
      await addSolutionPhotos(files);
    },
    compress: false,
    successToast: null,
    telemetryTag: 'hw_solution_drop',
  });

  const rubricDragDrop = useDragDropFiles({
    enabled: !task.uploading,
    maxFiles: MAX_RUBRIC_IMAGES,
    currentCount: rubricRefs.length,
    onFilesDropped: async (files: File[]) => {
      await addRubricPhotos(files);
    },
    compress: false,
    successToast: null,
    telemetryTag: 'hw_rubric_drop',
  });

  return (
    <Card animate={false}>
      <CardContent className="p-4 space-y-4" onPaste={handleCardPaste}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveUp} disabled={isFirst}
                aria-label="Переместить вверх">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveDown} disabled={isLast}
                aria-label="Переместить вниз">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              Задача {index + 1}
            </span>
            {task.kb_source && (
              <SourceBadge source={task.kb_source} />
            )}
            {task.kb_source_label && (
              <span
                className="max-w-[240px] truncate text-xs text-muted-foreground"
                title={task.kb_source_label}
              >
                {task.kb_source_label}
              </span>
            )}
            {/* unified-task-model F2: новая задача → авто-зеркало в Базу при
                сохранении ДЗ (папка «Из ДЗ»). Чип-подсказка, не блокер. */}
            {!task.kb_task_id ? (
              <span
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
                title="Создастся в вашей Базе при сохранении ДЗ (папка «Из ДЗ»)"
              >
                → в Базу
              </span>
            ) : null}
            {task.kb_task_id && pushDiverged ? (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900"
                title="Задача отличается от версии в Базе"
              >
                изменено
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {onRequestPushToKB && task.id && task.kb_task_id && pushDiverged ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRequestPushToKB(task)}
                aria-label={task.kb_source === 'socrat' ? 'Создать свою копию в Базе' : 'Обновить задачу в Базе'}
                title={task.kb_source === 'socrat'
                  ? 'Создать свою копию в Базе (каталожная задача не редактируется)'
                  : 'Обновить задачу в вашей Базе (уже выданные ДЗ не изменятся)'}
                className="h-8 px-2 text-xs text-muted-foreground"
                style={{ touchAction: 'manipulation' }}
              >
                {task.kb_source === 'socrat' ? 'Своя копия' : 'Обновить в Базе'}
              </Button>
            ) : null}
            {onRequestSaveToKB && task.id ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRequestSaveToKB(task)}
                aria-label="Сохранить задачу в мою базу"
                title="Сохранить в мою базу"
                className="h-8 w-8 p-0"
                style={{ touchAction: 'manipulation' }}
              >
                <BookmarkPlus className="h-4 w-4 text-muted-foreground" />
              </Button>
            ) : null}
            {canRemove && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemove}
                aria-label="Удалить задачу"
                title="Удалить задачу"
                className="h-8 w-8 p-0"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        </div>

        {/* TASK SECTION — paste routed via lastFocusedSection (whole-card),
            drag-drop landing routed по этой секции (per-wrapper). */}
        <div
          className={cn(
            'relative space-y-4 rounded-md transition-colors',
            taskDragDrop.isDragging && 'ring-2 ring-dashed ring-accent',
          )}
          onFocus={() => {
            lastFocusedSection.current = 'task';
          }}
          {...taskDragDrop.dragHandlers}
        >
          {taskDragDrop.isDragging && <DropOverlay />}
          <div className="space-y-2">
            <Label>Текст задачи {taskRefs.length === 0 && <span className="text-red-500">*</span>}</Label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-y"
              placeholder={taskRefs.length > 0 ? 'Описание (опционально — фото прикреплено)' : 'Условие задачи (можно вставить скриншот Ctrl+V)...'}
              value={task.task_text}
              onChange={(e) => onUpdate({ ...task, task_text: e.target.value })}
            />
          </div>

          {/* Task condition photos */}
          <PhotoGallery
            label={`Фото условия (до ${MAX_TASK_IMAGES})`}
            max={MAX_TASK_IMAGES}
            refs={taskRefs}
            isUploading={task.uploading}
            previewUrls={previewUrls}
            resolvedUrls={resolvedTaskUrls}
            onAddFiles={addTaskPhotos}
            onRemove={removeTaskPhoto}
            onOpenZoom={openTaskZoom}
          />
          <p className="text-xs text-muted-foreground">{IMAGE_REQUIREMENTS_HINT}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Правильный ответ</Label>
              <Input
                placeholder="x=2, x=3"
                value={task.correct_answer}
                onChange={(e) =>
                  onUpdate({ ...task, correct_answer: e.target.value })
                }
                className="text-base"
              />
            </div>
            <div className="space-y-2">
              <Label>
                Макс. баллов
                {task.kb_task_id && task.max_score > 1 && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">из БЗ</span>
                )}
              </Label>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                inputMode="decimal"
                value={scoreText}
                onChange={(e) => setScoreText(e.target.value)}
                onBlur={handleScoreBlur}
                className="text-base"
              />
              {/* unified-task-model F2: авто-балл по ФИПИ (mirror чипа Базы).
                  Критерии выигрывают (Σ управляет баллом) — хинт скрыт. */}
              {autoScore != null && criteriaList.length === 0 ? (
                task.max_score === autoScore ? (
                  <p className="text-xs text-muted-foreground">= первичный балл ФИПИ</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    по ФИПИ — {autoScore} ·{' '}
                    <button
                      type="button"
                      className="font-medium text-accent hover:underline"
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        scoreTouchedRef.current = false;
                        onUpdate({ ...task, max_score: autoScore });
                        setScoreText(String(autoScore));
                      }}
                    >
                      Сбросить
                    </button>
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Шаг 0.5 — например 1, 1.5, 12, 12.5</p>
              )}
            </div>
          </div>

          {/* unified-task-model F2 (2026-07-05): каскад классификации — тот же
              компонент, что в Базе (Тип → № КИМ/сложность → Тема → Подтема →
              Источник). Для физики Части 2 (№ 21-26) № КИМ включает строгую
              ФИПИ-проверку по блок-схеме. «Формат ответа» скрыт (конфликт с
              check_format ниже), «Первичный балл» скрыт (ведёт «Макс. баллов»). */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/40 p-3">
            <button
              type="button"
              onClick={() => setClassificationOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-accent transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              {classificationOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Классификация (Тип, № КИМ, тема)
              {!classificationOpen && (task.exam || task.kim_number != null) ? (
                <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {task.exam === 'ege' ? 'ЕГЭ' : task.exam === 'oge' ? 'ОГЭ' : task.exam === 'olympiad' ? 'Олимпиада' : ''}
                  {task.kim_number != null ? ` · № ${task.kim_number}` : ''}
                </span>
              ) : null}
            </button>
            {classificationOpen ? (
              <>
                {/* Ревью-фикс P1 (2026-07-06): при редактировании выданного ДЗ
                    тема/источник не подгружаются с сервера (живут в Базе; ДЗ
                    round-trip'ит только № КИМ, Тип дерайвится из него) —
                    предупреждаем, что пустые поля ≠ «в Базе пусто», а
                    заполненные уедут через push. */}
                {task.id && task.kb_task_id ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Тема и источник хранятся в Базе и здесь не подгружаются.
                    Заполненные поля уедут в Базу по кнопке «Обновить в Базе».
                  </p>
                ) : null}
                <TaskClassificationFields
                taskType={(task.exam ?? '') as TaskClassType}
                kimNumber={task.kim_number != null ? String(task.kim_number) : ''}
                difficulty={task.difficulty != null ? String(task.difficulty) : ''}
                primaryScore=""
                topicId={task.topic_id ?? ''}
                subtopicId={task.subtopic_id ?? ''}
                sourceLabel={task.source_label ?? ''}
                answerFormat=""
                hideAnswerFormat
                hidePrimaryScore
                onTaskTypeChange={(v) => {
                  // Смена типа: сброс КИМ/сложности/темы/подтемы (mirror КБ-модалок).
                  onUpdate({
                    ...task,
                    ...applyAutoScore({
                      exam: v,
                      kim_number: null,
                      difficulty: null,
                      topic_id: null,
                      subtopic_id: null,
                    }),
                  });
                }}
                onKimNumberChange={(v) => {
                  const kim = v.trim() ? Math.min(Math.max(parseInt(v.trim(), 10) || 0, 1), 40) : null;
                  onUpdate({ ...task, ...applyAutoScore({ kim_number: kim }) });
                }}
                onDifficultyChange={(v) => {
                  const d = v.trim() ? parseInt(v.trim(), 10) : null;
                  onUpdate({ ...task, ...applyAutoScore({ difficulty: d }) });
                }}
                onPrimaryScoreChange={() => undefined}
                onTopicIdChange={(v) =>
                  onUpdate({ ...task, topic_id: v || null, subtopic_id: null })
                }
                onSubtopicIdChange={(v) => onUpdate({ ...task, subtopic_id: v || null })}
                onSourceLabelChange={(v) => onUpdate({ ...task, source_label: v || null })}
                onAnswerFormatChange={() => undefined}
                />
              </>
            ) : null}
          </div>

          {/* voice-speaking-mvp: «Тип ответа» selector — gated to pilot tutors.
              'speaking' → устный монолог (рекордер у ученика). When speaking,
              the «Формат проверки» selector below is hidden (не применимо). */}
          {voiceSpeakingEnabled ? (
            <div className="space-y-1">
              <Label htmlFor={`task-kind-${task.localId}`}>Тип ответа</Label>
              <select
                id={`task-kind-${task.localId}`}
                value={task.task_kind === 'speaking' ? 'speaking' : 'written'}
                onChange={(e) =>
                  onUpdate({
                    ...task,
                    task_kind: e.target.value === 'speaking' ? 'speaking' : undefined,
                  })
                }
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={{ fontSize: '16px', touchAction: 'manipulation' }}
              >
                <option value="written">Письменный / числовой</option>
                <option value="speaking">Устный ответ (монолог)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {task.task_kind === 'speaking'
                  ? 'Ученик запишет устный монолог; AI распознает речь и оценит по критериям'
                  : 'Ученик отвечает текстом, числом или фото решения'}
              </p>
            </div>
          ) : null}

          {task.task_kind !== 'speaking' ? (
            <CheckFormatField
              id={`check-format-${task.localId}`}
              value={task.check_format}
              onChange={(v) => onUpdate({ ...task, check_format: v })}
            />
          ) : null}

          {/* Phase 11 (2026-05-31): CEFR-уровень теперь задаётся на уровне ВСЕГО ДЗ
              (селектор «Уровень CEFR» в шапке конструктора) и каскадится во все
              задачи — это убрало per-task friction (топик-банки по 10 задач). Здесь
              показываем read-only бейдж текущего уровня для наглядности. */}
          {cefrLevelEnabled && task.cefr_level ? (
            <p className="text-xs text-muted-foreground">
              Уровень CEFR: <span className="font-medium text-foreground">{task.cefr_level}</span>{' '}
              — задан для всего ДЗ (изменить можно в шапке конструктора).
            </p>
          ) : null}
        </div>

        {/* SOLUTION SECTION — paste via lastFocusedSection, drag-drop per-wrapper. */}
        <div
          className={cn(
            'relative rounded-md transition-colors',
            solutionDragDrop.isDragging && 'ring-2 ring-dashed ring-accent',
          )}
          onFocus={() => {
            lastFocusedSection.current = 'solution';
          }}
          {...solutionDragDrop.dragHandlers}
        >
          {solutionDragDrop.isDragging && <DropOverlay />}
          <SolutionField
            value={task.solution_text}
            onChange={(v) => onUpdate({ ...task, solution_text: v })}
            solutionRefs={solutionRefs}
            fromKB={Boolean(task.kb_task_id)}
            isUploading={task.uploading}
            previewUrls={previewUrls}
            resolvedUrls={resolvedSolutionUrls}
            onAddSolutionFiles={addSolutionPhotos}
            onRemoveSolutionPhoto={removeSolutionPhoto}
            onOpenSolutionZoom={openSolutionZoom}
          />
        </div>

        {/* CRITERIA EDITOR — структурные критерии покритериальной AI-проверки.
            Гейтится non-numeric задачами. Свободная рубрика ниже = доп. заметки. */}
        {criteriaEditorEnabled ? (
          <CriteriaEditor
            criteria={criteriaList}
            taskMaxScore={task.max_score}
            onChange={handleCriteriaChange}
          />
        ) : null}

        {/* RUBRIC SECTION — paste via lastFocusedSection, drag-drop per-wrapper. */}
        <div
          className={cn(
            'relative rounded-md transition-colors',
            rubricDragDrop.isDragging && 'ring-2 ring-dashed ring-accent',
          )}
          onFocus={() => {
            lastFocusedSection.current = 'rubric';
          }}
          {...rubricDragDrop.dragHandlers}
        >
          {rubricDragDrop.isDragging && <DropOverlay />}
          <RubricField
            value={task.rubric_text}
            onChange={(v) => onUpdate({ ...task, rubric_text: v })}
            rubricRefs={rubricRefs}
            isUploading={task.uploading}
            previewUrls={previewUrls}
            resolvedUrls={resolvedRubricUrls}
            onAddRubricFiles={addRubricPhotos}
            onRemoveRubricPhoto={removeRubricPhoto}
            onOpenRubricZoom={openRubricZoom}
            supplementary={criteriaEditorEnabled}
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => toast.info('Генерация вариаций — скоро будет!')}
        >
          <Dices className="h-4 w-4" />
          Вариации
        </Button>
        <FullscreenImageCarousel
          images={zoomImages}
          openIndex={zoom?.index ?? null}
          onClose={() => setZoom(null)}
          onNavigate={(nextIndex) => setZoom((current) => (current ? { ...current, index: nextIndex } : current))}
          ariaTitle={
            zoom?.gallery === 'solution'
              ? 'Фото эталонного решения'
              : zoom?.gallery === 'rubric'
              ? 'Фото критериев'
              : 'Фото условия'
          }
          ariaDescription="Просмотр изображений задачи во весь экран"
        />
      </CardContent>
    </Card>
  );
}
