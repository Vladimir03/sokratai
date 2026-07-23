// Фаза 2, пуш 3 (2026-07-20): черновик задачи варианта пробника + мапперы
// входов контента. Один тип питает три источника конструктора варианта:
// ручной ввод (editor), AI-загрузка (shared loader, destination mock_variant),
// корзина Базы («Создать пробник» в HWDrawer → prefill через sessionStorage).

import { generateUUID } from '@/components/tutor/homework-create/types';
import { getExamProfile } from '@/lib/examProfiles';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { serializeAttachmentUrls } from '@/lib/attachmentRefs';
import type { AiLoaderCommitItem } from '@/components/kb/AiTaskLoader/reviewTypes';
import type { MockExamVariantTaskRow } from '@/hooks/useMockExamVariants';
import type { HWDraftTask } from '@/types/kb';

export interface VariantTaskDraft {
  localId: string;
  part: 1 | 2;
  /** Текстовые инпуты (парсинг на submit). */
  kimNumber: string;
  maxScore: string;
  taskText: string;
  /** Dual-format storage:// ref(ы). */
  taskImageUrl: string | null;
  correctAnswer: string;
  checkMode: string;
  solutionText: string;
  solutionImageUrls: string | null;
  topic: string;
}

export function createEmptyVariantTask(part: 1 | 2): VariantTaskDraft {
  return {
    localId: generateUUID(),
    part,
    kimNumber: '',
    maxScore: part === 1 ? '1' : '3',
    taskText: '',
    taskImageUrl: null,
    correctAnswer: '',
    checkMode: 'strict',
    solutionText: '',
    solutionImageUrls: null,
    topic: '',
  };
}

export function rowToDraft(row: MockExamVariantTaskRow): VariantTaskDraft {
  return {
    localId: generateUUID(),
    part: row.part,
    kimNumber: String(row.kim_number),
    maxScore: String(row.max_score),
    taskText: row.task_text === '[Задача на фото]' ? '' : row.task_text,
    taskImageUrl: row.task_image_url,
    correctAnswer: row.correct_answer ?? '',
    checkMode: row.part === 1 && row.check_mode && row.check_mode !== 'manual'
      ? row.check_mode
      : 'strict',
    solutionText: row.solution_text ?? '',
    solutionImageUrls: row.solution_image_urls,
    topic: row.topic ?? '',
  };
}

// ─── Инференс части и режима проверки ────────────────────────────────────────

/**
 * Часть: физика КИМ из part2KimRange (registry physics:ege — [21,26]) → 2;
 * иначе по формату проверки (развёрнутое → 2). Карты — ExamProfile registry
 * (`src/lib/examProfiles.ts`, техдолг 5.6); гейтинг exam-семантики остаётся
 * здесь (физика лояльна к пустому exam, social строг — ревью 5.6 P1).
 */
export function inferVariantTaskPart(
  subject: string,
  kimNumber: number | null,
  checkFormat: 'short_answer' | 'detailed_solution',
  exam?: '' | 'ege' | 'oge' | null,
): 1 | 2 {
  if (kimNumber !== null) {
    // Гейтинг зеркалит inferPart1CheckMode / getKimPrimaryScoreForSubject:
    // физика лояльна к пустому exam (её карта = ЕГЭ, прежнее поведение
    // байт-в-байт), остальные предметы — строго по указанному экзамену.
    // Ревью 5.6 P1 #2: раньше диапазон был захардкожен физикой, поэтому
    // задачи 17-25 обществознания молча уезжали в Часть 1.
    const resolvedExam = subject === 'physics' ? 'ege' : exam || null;
    const range = resolvedExam
      ? getExamProfile(subject, resolvedExam)?.part2KimRange
      : null;
    if (range && kimNumber >= range[0] && kimNumber <= range[1]) return 2;
  }
  return checkFormat === 'detailed_solution' ? 2 : 1;
}

export function inferPart1CheckMode(
  subject: string,
  exam: '' | 'ege' | 'oge' | null,
  kimNumber: number | null,
): string {
  if (kimNumber === null) return 'strict';
  // Физика: лояльна к пустому exam (исторически '' трактуется как ЕГЭ);
  // ОГЭ-карты режимов нет → strict.
  if (subject === 'physics' && exam !== 'oge') {
    return getExamProfile('physics', 'ege')?.part1CheckModes?.[kimNumber] ?? 'strict';
  }
  // Строго ЕГЭ (симметрично getKimPrimaryScoreForSubject, ревью 5.6 P1): при
  // неуказанном/ОГЭ exam → strict + обычный балл, а не критерии чужого экзамена.
  if (subject === 'social' && exam === 'ege') {
    return getExamProfile('social', 'ege')?.part1CheckModes?.[kimNumber] ?? 'strict';
  }
  return 'strict';
}

// ─── Маппер: AI-загрузчик → черновик варианта ────────────────────────────────

export function aiExtractToVariantTaskDraft(
  item: AiLoaderCommitItem,
  subject: string,
): VariantTaskDraft {
  const { draft, override: ov, attachmentRef } = item;
  const kimParsed = ov.kimNumber.trim() ? parseInt(ov.kimNumber.trim(), 10) : null;
  const kimNum = kimParsed !== null && !Number.isNaN(kimParsed) ? kimParsed : null;
  const exam = ov.exam || null;

  const checkFormat = resolveCheckFormatFromKb({
    check_format: draft.check_format,
    answer_format: draft.answer_format,
    kim_number: kimNum,
    subject,
  });
  const part = inferVariantTaskPart(subject, kimNum, checkFormat, exam);

  const manualScore = ov.primaryScore.trim() ? parseInt(ov.primaryScore.trim(), 10) : null;
  const resolvedScore =
    manualScore ?? getKimPrimaryScoreForSubject(subject, exam, kimNum) ?? draft.primary_score;
  const maxScore =
    resolvedScore !== null && !Number.isNaN(resolvedScore) && resolvedScore > 0
      ? resolvedScore
      : part === 2 ? 3 : 1;

  return {
    localId: generateUUID(),
    part,
    kimNumber: kimNum !== null ? String(kimNum) : '',
    maxScore: String(maxScore),
    taskText: draft.text,
    taskImageUrl: attachmentRef ? serializeAttachmentUrls([attachmentRef]) : null,
    correctAnswer: draft.answer?.trim() ?? '',
    checkMode: part === 1 ? inferPart1CheckMode(subject, ov.exam, kimNum) : 'strict',
    solutionText: draft.solution ?? '',
    solutionImageUrls: null,
    topic: draft.topic_suggestion.trim(),
  };
}

// ─── Маппер: корзина Базы → черновик варианта ────────────────────────────────

export function hwDraftToVariantTaskDraft(
  t: HWDraftTask,
  subject: string,
): VariantTaskDraft {
  const kimNum = typeof t.kim_number === 'number' ? t.kim_number : null;
  const checkFormat = t.checkFormatSnapshot ?? 'short_answer';
  const part = inferVariantTaskPart(subject, kimNum, checkFormat);
  const maxScore = typeof t.maxScoreSnapshot === 'number' && t.maxScoreSnapshot > 0
    ? Math.round(t.maxScoreSnapshot)
    : part === 2 ? 3 : 1;

  return {
    localId: generateUUID(),
    part,
    kimNumber: kimNum !== null ? String(kimNum) : '',
    maxScore: String(maxScore),
    taskText: t.textSnapshot === '[Задача на фото]' ? '' : t.textSnapshot,
    taskImageUrl: t.attachmentSnapshot ?? null,
    correctAnswer: t.answerSnapshot ?? '',
    checkMode: part === 1 ? inferPart1CheckMode(subject, 'ege', kimNum) : 'strict',
    solutionText: t.solutionSnapshot ?? '',
    solutionImageUrls: t.solutionAttachmentSnapshot ?? null,
    topic: t.topicName?.trim() ?? '',
  };
}

// ─── Prefill корзина → редактор (sessionStorage, one-shot) ───────────────────
// НЕ прямой insert в БД из корзины (единственный write-path — edge POST из
// редактора); prefill читается синхронно в useState-инициализаторе редактора.

const MOCK_VARIANT_PREFILL_KEY = 'sokrat-mock-variant-prefill';

export interface MockVariantPrefill {
  subject: string;
  drafts: VariantTaskDraft[];
}

export function writeVariantPrefill(prefill: MockVariantPrefill): void {
  try {
    sessionStorage.setItem(MOCK_VARIANT_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* sessionStorage unavailable — редактор откроется пустым */
  }
}

export function readAndClearVariantPrefill(): MockVariantPrefill | null {
  try {
    const raw = sessionStorage.getItem(MOCK_VARIANT_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(MOCK_VARIANT_PREFILL_KEY);
    const parsed = JSON.parse(raw) as MockVariantPrefill;
    if (!parsed || !Array.isArray(parsed.drafts)) return null;
    // Свежие localId на всякий случай (дубликаты ключей при повторном чтении).
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject : 'physics',
      drafts: parsed.drafts.map((d) => ({ ...d, localId: generateUUID() })),
    };
  } catch {
    return null;
  }
}
