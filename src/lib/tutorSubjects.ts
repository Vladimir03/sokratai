/**
 * Дефолт предмета репетитора — single source of truth (2026-07-07).
 *
 * Иерархия (решение владельца): last-used → профиль → 'physics'.
 *  - last-used — сильнейший сигнал («что грузил вчера, то грузишь сегодня»);
 *    сам решает мульти-предметный кейс (профиль с 2+ предметами не решает).
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
import { SUBJECT_NAME_MAP } from '@/types/homework';

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
 * Дефолт предмета: lastUsed (валидный) → первый контент-предмет профиля → physics.
 * `profileSubjects` может быть undefined (профиль ещё не загружен/нет строки).
 */
export function resolveTutorDefaultSubject(
  profileSubjects: readonly string[] | null | undefined,
  lastUsed: string | null | undefined,
): string {
  const fromLastUsed = normalizeSubjectId(lastUsed);
  if (fromLastUsed) return fromLastUsed;

  for (const s of profileSubjects ?? []) {
    const id = normalizeSubjectId(s);
    if (id) return id;
  }

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
