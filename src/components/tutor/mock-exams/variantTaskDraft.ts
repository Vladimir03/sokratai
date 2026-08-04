// Фаза 2, пуш 3 (2026-07-20): черновик задачи варианта пробника + мапперы
// входов контента. Один тип питает три источника конструктора варианта:
// ручной ввод (editor), AI-загрузка (shared loader, destination mock_variant),
// корзина Базы («Создать пробник» в HWDrawer → prefill через sessionStorage).

import { generateUUID } from '@/components/tutor/homework-create/types';
import { parseAnswerSpec } from '@/lib/answerAlternatives';
import { getExamProfile, type ExamProfileExam } from '@/lib/examProfiles';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { resolveCheckFormatFromKb } from '@/lib/checkFormatHelpers';
import { serializeAttachmentUrls } from '@/lib/attachmentRefs';
import { overrideExamToDb } from '@/components/kb/AiTaskLoader/reviewTypes';
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
  /** Привязка к блоку заданий (общий материал + N вопросов); null = вне блока. */
  blockId: string | null;
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
    blockId: null,
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
    blockId: row.block_id ?? null,
  };
}

// ─── Инференс части и режима проверки ────────────────────────────────────────

/**
 * Часть: физика КИМ из part2KimRange (registry physics:ege — [21,26]) → 2;
 * иначе по формату проверки (развёрнутое → 2). Карты — ExamProfile registry
 * (`src/lib/examProfiles.ts`, техдолг 5.6); гейтинг exam-семантики остаётся
 * здесь (физика лояльна к пустому exam, social строг — ревью 5.6 P1).
 */
/**
 * Диапазон Части 2 для (предмет × экзамен) с той же exam-семантикой, что у
 * `inferPart1CheckMode` / `getKimPrimaryScoreForSubject`: физика лояльна к
 * пустому exam (её карта = ЕГЭ, поведение байт-в-байт), остальные предметы —
 * строго по указанному экзамену.
 *
 * ⚠️ ЕДИНСТВЕННОЕ место этого гейта: авто-инференс части и диалог пересчёта
 * разбивки обязаны видеть одно и то же. Разъехавшиеся копии этого правила —
 * ровно тот класс дрейфа, который и породил историю с потерянным заданием 20.
 */
function resolvePart2Range(
  subject: string,
  exam?: '' | 'ege' | 'oge' | null,
): readonly [number, number] | null {
  // Зеркалит `inferPart1CheckMode` ТОЧНО: физика лояльна к ПУСТОМУ exam
  // (исторически '' = ЕГЭ), но ОГЭ у неё — свой профиль. Раньше здесь было
  // `subject === 'physics' ? 'ege' : …`, из-за чего физика-ОГЭ получала
  // ЕГЭ-диапазон [21,26] (у `physics:oge` он null), а баллы при этом брались
  // из ОГЭ-карты — смесь двух экзаменов в одном варианте (ревью 5.6 P1).
  const resolvedExam = subject === 'physics' ? (exam === 'oge' ? 'oge' : 'ege') : exam || null;
  if (!resolvedExam) return null;
  return getExamProfile(subject, resolvedExam)?.part2KimRange ?? null;
}

export function inferVariantTaskPart(
  subject: string,
  kimNumber: number | null,
  checkFormat: 'short_answer' | 'detailed_solution',
  exam?: '' | 'ege' | 'oge' | null,
): 1 | 2 {
  if (kimNumber !== null) {
    const range = resolvePart2Range(subject, exam);
    if (range && kimNumber >= range[0] && kimNumber <= range[1]) return 2;
  }
  return checkFormat === 'detailed_solution' ? 2 : 1;
}

export interface PartSplitMove {
  localId: string;
  kim: number;
  from: 1 | 2;
  to: 1 | 2;
}

export interface PartSplitPlan {
  range: readonly [number, number];
  moves: PartSplitMove[];
  /** Текущие номера Части 2 — для честной формулировки «сейчас в варианте …». */
  currentPart2Kims: number[];
}

/**
 * План пересчёта разбивки по частям при смене предмета/экзамена
 * (решение владельца 2026-08-04: предлагать ДЕЙСТВИЕМ, не молча).
 *
 * Кейс Ульяны: вариант собрали по физике (Часть 2 = 21–26), потом поменяли
 * предмет на химию (ОГЭ: Часть 2 = 20–23). Баллы и формат проверки
 * пересчитывались, а РАЗБИВКА — нет, поэтому письменное задание 20 осталось в
 * Части 1 и «потерялось».
 *
 * `null` = диалог не показывать: профиля нет, границы у предмета нет, либо
 * переносить нечего. Лучше молчать, чем предлагать пустое действие.
 */
export function planPartSplitForSubjectExam(
  part1: VariantTaskDraft[],
  part2: VariantTaskDraft[],
  subject: string,
  exam: '' | 'ege' | 'oge' | null,
): PartSplitPlan | null {
  const range = resolvePart2Range(subject, exam);
  if (!range) return null;

  const kimOf = (t: VariantTaskDraft): number | null => {
    const raw = t.kimNumber.trim();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) ? n : null;
  };

  const moves: PartSplitMove[] = [];
  for (const t of part1) {
    const kim = kimOf(t);
    if (kim !== null && kim >= range[0] && kim <= range[1]) {
      moves.push({ localId: t.localId, kim, from: 1, to: 2 });
    }
  }
  for (const t of part2) {
    const kim = kimOf(t);
    if (kim !== null && (kim < range[0] || kim > range[1])) {
      moves.push({ localId: t.localId, kim, from: 2, to: 1 });
    }
  }
  if (moves.length === 0) return null;

  const currentPart2Kims = part2
    .map(kimOf)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  return { range, moves, currentPart2Kims };
}

/**
 * Применяет план: переносит задачи между массивами частей и нормализует поля
 * ровно так же, как это делают существующие пути (смена части руками и
 * `reclassifyDraftsForSubjectExam`) — новых правил не заводим.
 */
export function applyPartSplitPlan(
  part1: VariantTaskDraft[],
  part2: VariantTaskDraft[],
  plan: PartSplitPlan,
  subject: string,
  exam: '' | 'ege' | 'oge' | null,
): { part1: VariantTaskDraft[]; part2: VariantTaskDraft[] } {
  const toPart2 = new Set(plan.moves.filter((m) => m.to === 2).map((m) => m.localId));
  const toPart1 = new Set(plan.moves.filter((m) => m.to === 1).map((m) => m.localId));

  const normalize = (t: VariantTaskDraft, target: 1 | 2): VariantTaskDraft => {
    const kim = t.kimNumber.trim() ? Number.parseInt(t.kimNumber.trim(), 10) : null;
    const validKim = Number.isInteger(kim) ? (kim as number) : null;
    const next: VariantTaskDraft = { ...t, part: target };
    if (target === 2) {
      // Ч2 проверяет человек/AI — режим Части 1 там не применяется.
      next.checkMode = 'strict';
    } else {
      next.checkMode = inferPart1CheckMode(subject, exam, validKim);
    }
    const score = getKimPrimaryScoreForSubject(subject, exam || null, validKim);
    // Балл трогаем ТОЛЬКО когда карта предмета его знает — не выдумываем.
    if (score != null) next.maxScore = String(score);
    return next;
  };

  const nextPart1 = [
    ...part1.filter((t) => !toPart2.has(t.localId)),
    ...part2.filter((t) => toPart1.has(t.localId)).map((t) => normalize(t, 1)),
  ];
  const nextPart2 = [
    ...part2.filter((t) => !toPart1.has(t.localId)),
    ...part1.filter((t) => toPart2.has(t.localId)).map((t) => normalize(t, 2)),
  ];

  const byKim = (a: VariantTaskDraft, b: VariantTaskDraft) =>
    (Number.parseInt(a.kimNumber, 10) || 0) - (Number.parseInt(b.kimNumber, 10) || 0);
  return { part1: nextPart1.sort(byKim), part2: nextPart2.sort(byKim) };
}

export function inferPart1CheckMode(
  subject: string,
  exam: '' | 'ege' | 'oge' | null,
  kimNumber: number | null,
): string {
  if (kimNumber === null) return 'strict';
  // Гейтинг exam-семантики живёт ЗДЕСЬ, карты — в registry (rule 45).
  // Физика лояльна к пустому exam (исторически '' трактуется как ЕГЭ);
  // остальные предметы — строго по указанному экзамену, иначе достался бы
  // режим чужого экзамена (ревью 5.6 P1, симметрия с getKimPrimaryScoreForSubject).
  //
  // ⚠️ Раньше здесь был per-subject if-каскад (физика + обществознание), и
  // профиль нового предмета в registry МОЛЧА не применялся: у химии карта
  // появилась, а Часть 1 продолжала бы инфериться в strict. Теперь ветвление
  // только по exam-семантике, карта берётся у любого заведённого профиля.
  const resolvedExam: ExamProfileExam | null = subject === 'physics'
    ? (exam === 'oge' ? 'oge' : 'ege')
    : (exam || null);
  const profile = getExamProfile(subject, resolvedExam);
  if (!profile) return 'strict';
  return profile.part1CheckModes?.[kimNumber] ?? profile.defaultPart1CheckMode;
}

/**
 * Переклассификация уже добавленных черновиков при смене предмета/экзамена в
 * шапке редактора (ревью 5.6 P1 #2, остаток). Пересчитывает ТОЛЬКО то, что
 * критично для грейдинга и детерминированно выводится из (№ КИМ, предмет,
 * экзамен):
 *   - `checkMode` Части 1 — у каждого предмета свои критерии ФИПИ (rule 45);
 *     физический `multi_choice` засчитывает замену цифры, обществоведческий
 *     `multi_choice_strict` — нет. Старый режим после смены предмета неверен.
 *   - `maxScore` — балл ФИПИ, если карта нового (предмет × экзамен) его знает.
 *
 * НЕ трогает: контент (текст/ответ/фото/решение/тему), № КИМ и раскладку по
 * частям (репетитор разложил вручную; авто-перемещение между частями = сюрприз,
 * правится селектором «Часть»). Вызывать ТОЛЬКО из пользовательского onChange
 * селектора — НЕ из эффекта на [subject, exam] (тот сработает и на edit-prefill,
 * затерев сохранённые check_mode варианта, и на позднем автодефолте профиля).
 *
 * `changed` = сколько задач реально изменилось (0 → toast не показываем).
 */
export function reclassifyDraftsForSubjectExam(
  drafts: VariantTaskDraft[],
  subject: string,
  exam: '' | 'ege' | 'oge' | null,
): { drafts: VariantTaskDraft[]; changed: number } {
  let changed = 0;
  const next = drafts.map((t) => {
    const kim = t.kimNumber.trim() ? parseInt(t.kimNumber.trim(), 10) : null;
    if (kim === null || Number.isNaN(kim)) return t;
    const patch: Partial<VariantTaskDraft> = {};
    if (t.part === 1) {
      const mode = inferPart1CheckMode(subject, exam, kim);
      if (mode !== t.checkMode) patch.checkMode = mode;
    }
    const score = getKimPrimaryScoreForSubject(subject, exam || null, kim);
    if (score != null && String(score) !== t.maxScore) patch.maxScore = String(score);
    if (Object.keys(patch).length === 0) return t;
    changed += 1;
    return { ...t, ...patch };
  });
  return { drafts: next, changed };
}

// ─── Маппер: AI-загрузчик → черновик варианта ────────────────────────────────

/**
 * Ответ для варианта пробника: ОДНА строка, которую чекер сравнит буквально.
 * Канонический мульти-формат Банка/ДЗ (`« или »`, диапазон `2,1 – 2,3`) здесь
 * не поддержан ни одним `check_mode`, поэтому берём первую ТОЧНУЮ альтернативу.
 * Диапазон без точных альтернатив оставляем как есть — молча подменять его
 * границей значило бы выдумать ответ; репетитор увидит строку в редакторе.
 */
function firstExactAnswer(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  const spec = parseAnswerSpec(trimmed);
  if (!spec?.isMulti) return trimmed;
  const exact = spec.alternatives.find((a) => a.type === 'exact');
  return exact && exact.type === 'exact' ? exact.value : trimmed;
}

export function aiExtractToVariantTaskDraft(
  item: AiLoaderCommitItem,
  subject: string,
): VariantTaskDraft {
  const { draft, override: ov, attachmentRef } = item;
  // ВОЛНА 8 (ревью P1-3): у олимпиадной задачи № КИМ НЕТ — гейт обязателен и
  // здесь, как в KB/hw-мапперах. Без него скрытый в UI КИМ (напр. 21 от
  // распознавания физики) уезжал в вариант: `inferVariantTaskPart` для физики
  // трактует пустой exam как ЕГЭ → задача падала в Часть 2 с баллом ФИПИ.
  const isOlympiad = ov.exam === 'olympiad';
  const kimParsed =
    !isOlympiad && ov.kimNumber.trim() ? parseInt(ov.kimNumber.trim(), 10) : null;
  const kimNum = kimParsed !== null && !Number.isNaN(kimParsed) ? kimParsed : null;
  // olympiad/other в ревью → NULL-exam для чекеров/скоринга.
  const exam = overrideExamToDb(ov.exam);
  const difficultyNum =
    isOlympiad && ov.difficulty.trim() ? parseInt(ov.difficulty.trim(), 10) : null;

  const checkFormat =
    ov.checkFormat ||
    resolveCheckFormatFromKb({
      check_format: draft.check_format,
      answer_format: draft.answer_format,
      kim_number: kimNum,
      subject,
    });
  const part = inferVariantTaskPart(subject, kimNum, checkFormat, exam);

  const manualScore = ov.primaryScore.trim() ? parseInt(ov.primaryScore.trim(), 10) : null;
  // Олимпиада: балл = сложность (инвариант ручной формы, ревью P1-2/P1-3).
  const resolvedScore = isOlympiad
    ? difficultyNum
    : manualScore ?? getKimPrimaryScoreForSubject(subject, exam, kimNum) ?? draft.primary_score;
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
    // ВОЛНА 9 (ревью P1): чекеры Части 1 сравнивают строку БУКВАЛЬНО, поэтому
    // канонический мульти-формат («2 м/с² или 2», «2,1 – 2,3») здесь ядовит:
    // ученик с верным «2» получил бы 0. Промпт учит модель этому формату для
    // всех назначений, значит гейта в UI мало — нормализуем и на входе в
    // вариант: берём первую ТОЧНУЮ альтернативу (диапазон оставляем как есть —
    // репетитор увидит его в редакторе варианта и задаст значение сам).
    correctAnswer: firstExactAnswer(draft.answer),
    checkMode: part === 1 ? inferPart1CheckMode(subject, exam ?? '', kimNum) : 'strict',
    solutionText: draft.solution ?? '',
    // ВОЛНА 8: скриншоты решения из ревью загрузчика.
    solutionImageUrls:
      item.solutionRefs.length > 0 ? serializeAttachmentUrls(item.solutionRefs) : null,
    topic: draft.topic_suggestion.trim(),
    blockId: null,
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
    blockId: null,
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
