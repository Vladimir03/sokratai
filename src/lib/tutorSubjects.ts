/**
 * Дефолт предмета репетитора — single source of truth (2026-07-07).
 *
 * Иерархия (решение владельца): [один предмет в профиле] → last-used → профиль → 'physics'.
 *  - ОДНО-ПРЕДМЕТНЫЙ профиль (ровно один контент-предмет, напр. модератор
 *    обществознания) → его предмет ВСЕГДА, ИГНОРИРУЯ last-used (решение владельца
 *    2026-07-21): тестовая загрузка чужого предмета не должна «залипать» дефолтом.
 *  - last-used — сильнейший сигнал для МУЛЬТИ-предметных («что грузил вчера, то
 *    грузишь сегодня»); сам решает кейс профиля с 2+ предметами.
 *  - профиль (`tutors.subjects TEXT[]`, канонические id из SUBJECTS, порядок
 *    массива уже канонический — SubjectsMultiSelect сортирует) — дефолт
 *    ПЕРВОГО раза; 'other' пропускается (не контент-предмет).
 *  - 'physics' — исторический fallback (первый предмет Сократа).
 *
 * Используют ВСЕ поверхности выбора предмета: каталог-pills, AI-загрузчик,
 * Create/EditTaskModal (KB), конструктор ДЗ, HWDrawer. KB-поверхности передают
 * lastUsed из `kbLastClassification.subject`; конструктор ДЗ — из
 * `readHwLastSubject()` (отдельный ключ: словари жизненных циклов разные).
 */
import { SUBJECTS, SUBJECT_NAME_MAP, type HomeworkSubjectConfig } from '@/types/homework';

/** Legacy id → канонический (профили/сторэдж могли застать старый словарь). */
const LEGACY_TO_CANONICAL: Record<string, string> = {
  math: 'maths',
  algebra: 'maths',
  geometry: 'maths',
  rus: 'russian',
  cs: 'informatics',
};

export const DEFAULT_TUTOR_SUBJECT = 'physics';

/** Канонический контент-предмет или null ('other'/legacy нормализуется/мусор отбрасывается). */
function normalizeSubjectId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const id = LEGACY_TO_CANONICAL[raw] ?? raw;
  if (id === 'other') return null; // «Другое» не может быть дефолтом контент-поверхности
  return SUBJECT_NAME_MAP[id] ? id : null;
}

/**
 * Уникальные КОНТЕНТ-предметы профиля: канонические id в порядке массива,
 * 'other'/legacy нормализуется, мусор отбрасывается, дедуп. Пустой массив =
 * «профиль не заполнен» (гейт-диалог предметов показывается именно по этому
 * условию — subject-personalization Ф1).
 */
export function normalizeContentSubjects(
  profileSubjects: readonly string[] | null | undefined,
): string[] {
  const contentSubjects: string[] = [];
  for (const s of profileSubjects ?? []) {
    const id = normalizeSubjectId(s);
    if (id && !contentSubjects.includes(id)) contentSubjects.push(id);
  }
  return contentSubjects;
}

/**
 * Умные списки предметов (subject-personalization Ф2): предметы профиля →
 * группа «Ваши предметы» (канонический порядок SUBJECTS), остальные (включая
 * «Другое») → «Другие предметы». НИКОГДА не прячет предметы — только группирует
 * (решение владельца: разовый ученик по новому предмету всегда возможен).
 */
export function groupSubjectsBySelection(
  profileSubjects: readonly string[] | null | undefined,
): { yours: HomeworkSubjectConfig[]; others: HomeworkSubjectConfig[] } {
  const yoursSet = new Set(normalizeContentSubjects(profileSubjects));
  if (yoursSet.size === 0) return { yours: [], others: [...SUBJECTS] };
  return {
    yours: SUBJECTS.filter((s) => yoursSet.has(s.id)),
    others: SUBJECTS.filter((s) => !yoursSet.has(s.id)),
  };
}

/**
 * Дефолт предмета: [один контент-предмет в профиле] → lastUsed (валидный) →
 * первый контент-предмет профиля → physics.
 * `profileSubjects` может быть undefined (профиль ещё не загружен/нет строки).
 */
export function resolveTutorDefaultSubject(
  profileSubjects: readonly string[] | null | undefined,
  lastUsed: string | null | undefined,
): string {
  const contentSubjects = normalizeContentSubjects(profileSubjects);

  // Одно-предметный профиль → его предмет ВСЕГДА (last-used не «залипает»).
  if (contentSubjects.length === 1) return contentSubjects[0];

  const fromLastUsed = normalizeSubjectId(lastUsed);
  if (fromLastUsed) return fromLastUsed;

  if (contentSubjects.length > 0) return contentSubjects[0];

  return DEFAULT_TUTOR_SUBJECT;
}

// ─── last-used предмет конструктора ДЗ (localStorage, per-browser) ────────────
// KB-поверхности НЕ используют этот ключ — у них kbLastClassification.subject.

const HW_LAST_SUBJECT_KEY = 'sokrat-hw-last-subject';

export function readHwLastSubject(): string | null {
  try {
    return localStorage.getItem(HW_LAST_SUBJECT_KEY);
  } catch {
    return null; // private mode / SSR — тихо без last-used
  }
}

export function saveHwLastSubject(subjectId: string): void {
  try {
    localStorage.setItem(HW_LAST_SUBJECT_KEY, subjectId);
  } catch {
    /* localStorage unavailable — silently skip */
  }
}
