import { serializeAttachmentUrls } from '@/lib/attachmentRefs';
import { resolveCheckFormatForLoader } from '@/lib/checkFormatHelpers';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { overrideExamToDb } from '@/components/kb/AiTaskLoader/reviewTypes';
import type { AiLoaderCommitItem } from '@/components/kb/AiTaskLoader/reviewTypes';
import { generateUUID, type DraftTask } from './types';

/**
 * Маппер AI-загрузчика → черновик задачи конструктора ДЗ (фаза 1
 * «один загрузчик — N назначений», 2026-07-20).
 *
 * Инварианты (НЕ нарушать):
 * - `kb_task_id` / `kb_snapshot_*` остаются **undefined** (как у ручных задач
 *   из `createEmptyTask`) — payload конструктора превратит undefined в
 *   `kb_task_id: null` → авто-зеркало «Из ДЗ» на бэке (tri-state, rule 40).
 *   `null` прямо в DraftTask заставил бы hasKbLinkDraft создать мусорную
 *   строку homework_kb_tasks.
 * - `task_kind` НЕ задаём — backend derive'ит из check_format (Bug #1 класс).
 * - `cefr_level` НЕ задаём — каскадится assignment-level meta.cefr_level.
 * - Балл: явный override ревью → авто-ФИПИ по КИМ (только физика) → AI → 1
 *   (зеркало порядка draftToCreateInput, ревью ChatGPT-5.6 P1).
 * - topic/subtopic/source — невидимое обогащение: в снимок ДЗ не едут, но
 *   уезжают в зеркало Базы (классифицированное наполнение).
 */
export function aiExtractToDraftTask(item: AiLoaderCommitItem, subject: string): DraftTask {
  const { draft, override: ov, attachmentRef } = item;

  // ВОЛНА 8: olympiad/other → exam NULL (БД/скоринг); олимпиада без КИМ,
  // балл = сложность (зеркало draftToCreateInput).
  const isOlympiad = ov.exam === 'olympiad';
  const kimParsed =
    !isOlympiad && ov.kimNumber.trim() ? parseInt(ov.kimNumber.trim(), 10) : null;
  const kimNum = kimParsed !== null && !Number.isNaN(kimParsed) ? kimParsed : null;
  const exam = overrideExamToDb(ov.exam);
  const difficultyNum =
    isOlympiad && ov.difficulty.trim() ? parseInt(ov.difficulty.trim(), 10) : null;
  const manualScore = ov.primaryScore.trim() ? parseInt(ov.primaryScore.trim(), 10) : null;
  // Олимпиада: балл = сложность БЕЗУСЛОВНО (инвариант ручной формы, ревью P1-2).
  const resolvedScore = isOlympiad
    ? difficultyNum
    : manualScore ?? getKimPrimaryScoreForSubject(subject, exam, kimNum) ?? draft.primary_score;
  const maxScore =
    resolvedScore !== null && !Number.isNaN(resolvedScore) && resolvedScore > 0
      ? resolvedScore
      : 1;

  // kb-attachments уже в HOMEWORK_AI_BUCKETS — ref валиден для AI-путей ДЗ.
  const taskImagePath = attachmentRef ? serializeAttachmentUrls([attachmentRef]) : null;

  return {
    localId: generateUUID(),
    task_text: draft.text,
    task_image_path: taskImagePath,
    task_image_name: attachmentRef ? attachmentRef.split('/').pop() ?? null : null,
    task_image_preview_url: null, // резолвится в handleAddFromAiLoader (зеркало handleAddFromKB)
    task_image_used_fallback: false,
    correct_answer: draft.answer?.trim() ?? '',
    rubric_text: draft.rubric_text ?? '',
    rubric_image_paths: null,
    solution_text: draft.solution ?? '',
    // ВОЛНА 8: скриншоты решения из ревью (kb-attachments — уже в HOMEWORK_AI_BUCKETS).
    solution_image_paths:
      item.solutionRefs.length > 0 ? serializeAttachmentUrls(item.solutionRefs) : null,
    max_score: maxScore,
    uploading: false,
    // ВОЛНА 8: явный выбор тутора в ревью → subject/exam-aware авто по КИМ.
    check_format:
      ov.checkFormat ||
      resolveCheckFormatForLoader({
        check_format: draft.check_format,
        answer_format: draft.answer_format,
        kim_number: kimNum,
        subject,
        exam,
      }),
    kim_number: kimNum, // единственное каскад-поле в снимке → ФИПИ/flowchart-грейдинг
    exam: ov.exam === 'other' ? '' : ov.exam,
    difficulty: difficultyNum,
    topic_id: ov.topicId ?? null,
    subtopic_id: ov.subtopicId ?? null,
    source_label: ov.sourceLabel.trim() || null,
    // ВОЛНА 9: критерии из ревью едут в конструктор ДЗ (раньше жёсткий null —
    // задача из AI-загрузки грейдилась без структурных критериев).
    grading_criteria_json: ov.criteria.length > 0 ? ov.criteria : null,
  };
}
