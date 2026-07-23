/**
 * ExamProfile registry — предмет × экзамен × версия (техдолг ревью 5.6,
 * решение владельца 2026-07-23: делать перед Ф3/Ф6 subject-personalization).
 *
 * Раньше знание «что такое {предмет}-{экзамен}» было размазано inline-условиями
 * `subject === 'physics'` по ≥6 файлам (kbKimScores, variantTaskDraft,
 * checkFormatHelpers, mockExamScaleEge2025, StudentMockExam…). Registry —
 * ЕДИНСТВЕННОЕ место данных; существующие публичные API остаются тонкими
 * обёртками (callsites не тронуты).
 *
 * ИНВАРИАНТЫ:
 * - Registry = знание для PREFILL/дефолтов. `maxScore`/`check_mode` СНАПШОТЯТСЯ
 *   в задачу при создании — истина рантайма в задаче, не здесь (менять карту
 *   безопасно для уже созданного контента).
 * - У КАЖДОГО предмета СВОИ критерии ФИПИ (решение владельца 2026-07-22) —
 *   карты не переиспользовать между предметами.
 * - Без импорта React (используется и в чистых lib-путях).
 * - Новый экзаменационный предмет (химия и т.д.) → новый профиль ЗДЕСЬ +
 *   векторы в scripts/test-exam-profiles.mjs (smoke-гвард); значения
 *   подтверждает предметник.
 * - Гейтинг exam-семантики (физика лояльна к пустому exam, social строг —
 *   ревью 5.6 P1) живёт в обёртках (kbKimScores/variantTaskDraft) — registry
 *   отдаёт данные по ТОЧНОМУ ключу (subject, exam).
 *
 * Части, ещё НЕ переведённые на registry (мигрировать при следующем касании):
 * - `StudentMockExam.tsx` (`isPhysicsVariant` гейтит ReferencesPanel/бланк-PDF)
 *   — поля referencesKind/blankPdfUrl уже здесь как source of truth;
 * - шкала первичный→тестовый (`mockExamScaleEge2025.ts`, 46 значений) — под
 *   smoke §10 parity с Deno-зеркалом, не трогаем; профиль несёт только
 *   benchmarks.
 */

export type ExamProfileExam = 'ege' | 'oge';

export interface ExamProfile {
  subject: string;
  exam: ExamProfileExam;
  /** Версия критериев (источник/год) — для аудита при обновлениях ФИПИ. */
  version: string;
  /**
   * № КИМ → макс. первичный балл (ФИПИ). null = карты нет → балл вручную
   * (честная пометка Ф6 строится на этом же null).
   */
  kimPrimaryScores: Record<number, number> | null;
  /**
   * № КИМ → check_mode Части 1 пробника (policyKey; номера вне карты →
   * defaultPart1CheckMode). null = карты нет.
   */
  part1CheckModes: Record<number, string> | null;
  defaultPart1CheckMode: string;
  /** [min,max] № КИМ развёрнутой Части 2; null = граница неизвестна. */
  part2KimRange: [number, number] | null;
  /** Бенчмарки первичной шкалы result-бара; null = скрыть порог/хорошо. */
  benchmarks: { pass: number; good: number; maxPrimary: number } | null;
  /**
   * Длительность экзамена в минутах (ФИПИ) — дефолт, когда у варианта не задан
   * `duration_minutes`. null = значение не подтверждено предметником, тогда
   * остаётся общий фолбэк вызывающей стороны (НЕ подставляем чужой предмет).
   */
  durationMinutes: number | null;
  /** Справочные материалы студенческой поверхности пробника. */
  referencesKind: 'physics' | 'generic';
  /** PDF бланка ФИПИ (public bucket); null = ссылку не показывать. */
  blankPdfUrl: string | null;
}

// ─── Данные (перенесены 1:1 из kbKimScores/variantTaskDraft — parity-тест
//     scripts/test-exam-profiles.mjs сверяет суммы и канареечные значения) ────

/** Физика ЕГЭ 2026: 26 заданий, Σ первичных = 45 (сверено; источник ФИПИ/Егор). */
const PHYSICS_EGE_SCORES: Record<number, number> = {
  1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 1, 8: 1, 9: 2, 10: 2,
  11: 1, 12: 1, 13: 1, 14: 2, 15: 2, 16: 1, 17: 2, 18: 2, 19: 1, 20: 1,
  21: 3, 22: 2, 23: 2, 24: 3, 25: 3, 26: 4,
};

/** Физика ОГЭ 2026: 22 задания, Σ = 39 (критерии ФИПИ, Егор 2026-06-21). */
const PHYSICS_OGE_SCORES: Record<number, number> = {
  1: 2, 2: 2, 3: 1, 4: 2, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1,
  12: 2, 13: 2, 14: 2, 15: 1, 16: 2, 17: 3, 18: 2, 19: 2, 20: 3, 21: 3, 22: 3,
};

/**
 * Обществознание ЕГЭ Часть 1 (1-16), Σ = 28 (таблица Милады 2026-07-21).
 * Часть 2 (17-25) — ручной ввод (карты нет намеренно).
 */
const SOCIAL_EGE_SCORES: Record<number, number> = {
  1: 1, 2: 2, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2,
  9: 1, 10: 2, 11: 2, 12: 1, 13: 2, 14: 2, 15: 2, 16: 2,
};

/** Физика ЕГЭ Часть 1 (mirror mock-exam-part1-checker семантики, rule 45). */
const PHYSICS_EGE_CHECK_MODES: Record<number, string> = {
  5: 'multi_choice', 9: 'multi_choice', 14: 'multi_choice', 18: 'multi_choice',
  6: 'ordered', 10: 'ordered', 15: 'ordered', 17: 'ordered',
  20: 'task20',
};

/**
 * Обществознание ЕГЭ Часть 1 (критерии ФИПИ, Милада 2026-07-21/22, rule 45):
 * 6/13/15 — ordered_lenient (Левенштейн ≤1 → 1 балл; НЕ физический ordered);
 * 1/3/9/12 — набор цифр без порядка, любая ошибка → 0 → task20;
 * остальные Ч1 — multi_choice_strict: 1 балл ТОЛЬКО за один лишний ИЛИ один
 * недостающий, ЗАМЕНА цифры → 0 (репорт Милады 2026-07-23; физический
 * multi_choice засчитывает замену — у каждого предмета свои критерии).
 */
const SOCIAL_EGE_CHECK_MODES: Record<number, string> = {
  6: 'ordered_lenient', 13: 'ordered_lenient', 15: 'ordered_lenient',
  2: 'multi_choice_strict', 4: 'multi_choice_strict', 5: 'multi_choice_strict',
  7: 'multi_choice_strict', 8: 'multi_choice_strict', 10: 'multi_choice_strict',
  11: 'multi_choice_strict', 14: 'multi_choice_strict', 16: 'multi_choice_strict',
  1: 'task20', 3: 'task20', 9: 'task20', 12: 'task20',
};

const PROFILES: Record<string, ExamProfile> = {
  'physics:ege': {
    subject: 'physics',
    exam: 'ege',
    version: 'fipi-2026',
    kimPrimaryScores: PHYSICS_EGE_SCORES,
    part1CheckModes: PHYSICS_EGE_CHECK_MODES,
    defaultPart1CheckMode: 'strict',
    part2KimRange: [21, 26],
    // 8 первичных → 36 тестовых (порог ВУЗа); 27 ≈ «хорошо» (владелец 2026-06-07).
    benchmarks: { pass: 8, good: 27, maxPrimary: 45 },
    durationMinutes: 235, // 3ч55м — совпадает с текстом инструкции в ReferencesPanel
    referencesKind: 'physics',
    blankPdfUrl: null, // BLANK_PDF_URL живёт в StudentMockExam до его миграции
  },
  'physics:oge': {
    subject: 'physics',
    exam: 'oge',
    version: 'fipi-2026',
    kimPrimaryScores: PHYSICS_OGE_SCORES,
    part1CheckModes: null, // ОГЭ-карта режимов не заводилась (репетитор правит)
    defaultPart1CheckMode: 'strict',
    part2KimRange: null,
    benchmarks: null, // шкала 2-5, 100-балльного бара нет (rule 45)
    durationMinutes: null, // ОГЭ-физика: значение не подтверждено Егором → фолбэк
    referencesKind: 'physics',
    blankPdfUrl: null,
  },
  'social:ege': {
    subject: 'social',
    exam: 'ege',
    version: 'fipi-2026-milada',
    kimPrimaryScores: SOCIAL_EGE_SCORES,
    part1CheckModes: SOCIAL_EGE_CHECK_MODES,
    defaultPart1CheckMode: 'strict',
    part2KimRange: null, // Ч2 (17-25) есть, но part-инференс не заводили
    benchmarks: null,
    durationMinutes: 210, // 3ч30м — ЕГЭ обществознание (Милада 2026-07-23)
    referencesKind: 'generic',
    blankPdfUrl: null,
  },
};

/** Профиль по точному ключу (subject, exam); null = не заведён (балл/режим вручную). */
export function getExamProfile(
  subject: string | null | undefined,
  exam: ExamProfileExam | null | undefined,
): ExamProfile | null {
  if (!subject || !exam) return null;
  return PROFILES[`${subject}:${exam}`] ?? null;
}

/**
 * Легаси-значения `mock_exam_variants.exam_type` → ключ профиля. Физика
 * исторически пишется как `ege_physics`/`oge_physics` (rule 45 — на них
 * гейтится шкала тестовых баллов), прочие предметы — generic `ege`/`oge`.
 * Registry ключуется generic-значением, поэтому нормализуем на входе.
 */
export function normalizeExamType(
  raw: string | null | undefined,
): ExamProfileExam | null {
  if (!raw) return null;
  if (raw.startsWith('oge')) return 'oge';
  if (raw.startsWith('ege')) return 'ege';
  return null;
}

/** Все заведённые профили (для parity-теста / будущих честных пометок Ф6). */
export function listExamProfiles(): ExamProfile[] {
  return Object.values(PROFILES);
}
