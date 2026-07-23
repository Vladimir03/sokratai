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
 * Prefill предмета УЧЕНИКА при добавлении (subject-personalization Ф4,
 * решение владельца 2026-07-23: предмет обязателен, подстановка из профиля):
 * один контент-предмет → он; несколько → last-used ЕСЛИ он из профиля
 * (осмысленный дефолт, а не произвольный), иначе первый предмет профиля;
 * профиль пуст → null (поле пустое + required — гейт-диалог на /tutor/students
 * обычно уже заставил заполнить профиль). В отличие от
 * resolveTutorDefaultSubject НЕ падает в physics — молча сохранённый неверный
 * предмет ученика хуже пустого поля (ревью A2 спеки).
 */
export function resolveStudentSubjectPrefill(
  profileSubjects: readonly string[] | null | undefined,
  lastUsed: string | null | undefined,
): string | null {
  const contentSubjects = normalizeContentSubjects(profileSubjects);
  if (contentSubjects.length === 0) return null;
  if (contentSubjects.length === 1) return contentSubjects[0];
  const fromLastUsed = normalizeSubjectId(lastUsed);
  if (fromLastUsed && contentSubjects.includes(fromLastUsed)) return fromLastUsed;
  return contentSubjects[0];
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

// ─── Экзамен-фокус (subject-personalization Ф3, 2026-07-23) ──────────────────

export type ExamFocusValue = 'ege' | 'oge' | 'school' | 'olympiad';

const EXAM_FOCUS_VALUES: ReadonlySet<string> = new Set(['ege', 'oge', 'school', 'olympiad']);

export function isExamFocusValue(raw: unknown): raw is ExamFocusValue {
  return typeof raw === 'string' && EXAM_FOCUS_VALUES.has(raw);
}

/**
 * Нормализация JSONB-карты `tutors.exam_focus_by_subject` (клиентский ввод /
 * legacy-мусор): только канонические предметы → только валидные значения, дедуп.
 */
export function normalizeExamFocusMap(raw: unknown): Record<string, ExamFocusValue[]> {
  const out: Record<string, ExamFocusValue[]> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [subjectRaw, valuesRaw] of Object.entries(raw as Record<string, unknown>)) {
    const subjectId = normalizeSubjectId(subjectRaw);
    if (!subjectId || !Array.isArray(valuesRaw)) continue;
    const values: ExamFocusValue[] = [];
    for (const v of valuesRaw) {
      if (isExamFocusValue(v) && !values.includes(v)) values.push(v);
    }
    if (values.length > 0) out[subjectId] = values;
  }
  return out;
}

/**
 * Дефолт экзамена для ВЫБРАННОГО предмета (Ф3, prefill-only; ревью A2 спеки —
 * фокус пер-предметный, НЕ глобальный): ровно один фокус предмета → он;
 * несколько/ноль → last-used ЭТОГО предмета (валидный и не противоречащий
 * фокусам) → null (поверхность оставляет свой прежний дефолт).
 */
export function resolveTutorDefaultExam(
  subject: string | null | undefined,
  focusMapRaw: unknown,
  lastUsedExam: string | null | undefined,
): ExamFocusValue | null {
  const subjectId = normalizeSubjectId(subject);
  if (!subjectId) return null;
  const focuses = normalizeExamFocusMap(focusMapRaw)[subjectId] ?? [];
  if (focuses.length === 1) return focuses[0];
  if (isExamFocusValue(lastUsedExam) && (focuses.length === 0 || focuses.includes(lastUsedExam))) {
    return lastUsedExam;
  }
  return null;
}

/**
 * Дефолт для ege|oge-ONLY поверхностей (конструктор ДЗ, редактор вариантов,
 * «Тип» загрузчика; ревью P2-5): resolver может вернуть 'school'/'olympiad'
 * (единственный фокус предмета) — непригодный для поверхности результат НЕ
 * должен терять пригодный last-used («всегда делал ОГЭ» → залипание на 'ege').
 * null = у поверхности остаётся её прежний дефолт.
 */
export function resolveTutorDefaultExamEgeOge(
  subject: string | null | undefined,
  focusMapRaw: unknown,
): 'ege' | 'oge' | null {
  const subjectId = normalizeSubjectId(subject);
  const lastUsed = readExamLastUsed(subjectId);
  const resolved = resolveTutorDefaultExam(subject, focusMapRaw, lastUsed);
  if (resolved === 'ege' || resolved === 'oge') return resolved;
  return lastUsed === 'ege' || lastUsed === 'oge' ? lastUsed : null;
}

// last-used экзамен — ПЕР-ПРЕДМЕТНАЯ map (НЕ глобальный ключ — ревью A2:
// «физика ЕГЭ» вчера не должна тащить ЕГЭ во французскую форму сегодня).
const EXAM_LAST_USED_KEY = 'sokrat-exam-last-used';

export function readExamLastUsed(subjectId: string | null | undefined): ExamFocusValue | null {
  if (!subjectId) return null;
  try {
    const raw = localStorage.getItem(EXAM_LAST_USED_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, unknown>;
    const v = map?.[subjectId];
    return isExamFocusValue(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveExamLastUsed(subjectId: string, exam: ExamFocusValue): void {
  try {
    const raw = localStorage.getItem(EXAM_LAST_USED_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    map[subjectId] = exam;
    localStorage.setItem(EXAM_LAST_USED_KEY, JSON.stringify(map));
  } catch {
    /* localStorage unavailable — silently skip */
  }
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
