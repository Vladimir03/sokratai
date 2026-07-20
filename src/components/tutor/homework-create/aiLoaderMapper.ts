import { serializeAttachmentUrls } from '@/lib/attachmentRefs';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
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

  const kimParsed = ov.kimNumber.trim() ? parseInt(ov.kimNumber.trim(), 10) : null;
  const kimNum = kimParsed !== null && !Number.isNaN(kimParsed) ? kimParsed : null;
  const exam = ov.exam || null;
  const manualScore = ov.primaryScore.trim() ? parseInt(ov.primaryScore.trim(), 10) : null;
  const resolvedScore =
    manualScore ?? getKimPrimaryScoreForSubject(subject, exam, kimNum) ?? draft.primary_score;
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
    solution_image_paths: null,
    max_score: maxScore,
    uploading: false,
    check_format: resolveCheckFormatFromKb({
      check_format: draft.check_format,
      answer_format: draft.answer_format,
      kim_number: kimNum,
      subject,
    }),
    kim_number: kimNum, // единственное каскад-поле в снимке → ФИПИ/flowchart-грейдинг
    exam: ov.exam,
    difficulty: null,
    topic_id: ov.topicId ?? null,
    subtopic_id: ov.subtopicId ?? null,
    source_label: ov.sourceLabel.trim() || null,
    grading_criteria_json: null,
  };
}
