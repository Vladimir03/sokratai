// ═══════════════════════════════════════════════════════════════
// unified-task-model (2026-07-05) — ЕДИНСТВЕННЫЙ конвертер полей
// kb_tasks ↔ homework-снимок / шаблон-shape.
//
// Убивает трёхсторонний дрейф (path A / path B / шаблоны): любое место, где
// задача Базы превращается в homework-снимок или template-task-JSON (и
// обратно), обязано идти через этот модуль. Новое поле задачи → добавляется
// ЗДЕСЬ один раз (плюс миграция паритета kb_tasks ↔ homework_tutor_tasks).
//
// Чистый модуль без зависимостей (тривиально тестируется/бандлится).
// ═══════════════════════════════════════════════════════════════

/** Поля kb_tasks, участвующие в снимке/шаблоне (SELECT-подмножество). */
export const KB_TASK_SNAPSHOT_SELECT =
  "id, owner_id, folder_id, topic_id, subtopic_id, exam, kim_number, primary_score, difficulty, " +
  "text, answer, solution, answer_format, check_format, task_kind, cefr_level, grading_criteria_json, " +
  "rubric_text, rubric_image_urls, attachment_url, solution_attachment_url, " +
  "source_label, moderation_status, published_task_id, fingerprint, updated_at";

export interface KbTaskLike {
  id: string;
  owner_id: string | null;
  text: string | null;
  answer: string | null;
  solution: string | null;
  attachment_url: string | null;
  solution_attachment_url: string | null;
  rubric_text: string | null;
  rubric_image_urls: string | null;
  check_format: string | null;
  task_kind: string | null;
  cefr_level: string | null;
  grading_criteria_json: unknown;
  kim_number: number | null;
  exam: string | null;
  primary_score: number | null;
  difficulty: number | null;
  source_label: string | null;
  moderation_status?: string | null;
  updated_at?: string | null;
}

const CHECK_FORMATS = new Set(["short_answer", "detailed_solution"]);
const TASK_KINDS = new Set(["numeric", "extended", "proof", "speaking"]);
const CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1"]);

function asCheckFormat(v: unknown): string | null {
  return typeof v === "string" && CHECK_FORMATS.has(v) ? v : null;
}
function asTaskKind(v: unknown): string | null {
  return typeof v === "string" && TASK_KINDS.has(v) ? v : null;
}
function asCefr(v: unknown): string | null {
  return typeof v === "string" && CEFR_LEVELS.has(v) ? v : null;
}
function asCriteria(v: unknown): unknown[] | null {
  return Array.isArray(v) && v.length > 0 ? v : null;
}
function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Балл задачи Базы для снимка: primary_score (ЕГЭ/ОГЭ по ФИПИ или ручной) ??
 * difficulty (олимпиада: уровень = балл) ?? 1. Зеркало kbTaskToDraftTask.
 */
export function kbTaskMaxScore(kb: Pick<KbTaskLike, "primary_score" | "difficulty">): number {
  if (typeof kb.primary_score === "number" && kb.primary_score > 0) return kb.primary_score;
  if (typeof kb.difficulty === "number" && kb.difficulty > 0) return kb.difficulty;
  return 1;
}

/** Рекурсивно-стабильная сериализация (ключи объектов сортируются). */
function stableSerialize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    // undefined-ключи и явный null считаем одним и тем же «поля нет»: обе
    // стороны строятся разными функциями, но семантика отсутствия одна.
    .filter(([, val]) => val !== undefined && val !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableSerialize(val)}`).join(",")}}`;
}

/** Провенанс не влияет на то, что увидит репетитор → вне сравнения контента. */
const CONTENT_COMPARE_OMIT = new Set(["source_kb_task_id"]);

/**
 * Совпадает ли СИНТЕЗ из Базы (`kbTaskToTemplateTaskJson`) с сохранённым
 * снимком задачи шаблона ПО КОНТЕНТУ.
 *
 * Гейт промоушена шаблона в ССЫЛОЧНЫЙ режим (ревью ChatGPT-5.6, 2026-07-23):
 * после `tasks_migrated_at` GET синтезирует задачи из ЖИВЫХ строк Базы и
 * игнорирует audit-снимок, поэтому промоушен допустим ТОЛЬКО когда синтез
 * побайтово даст то же самое. Иначе шаблон молча покажет другую задачу:
 *   • задачу импортировали из Базы и правили в конструкторе без «Обновить в
 *     Базе» → в ДЗ новая версия, в Базе старая (P1 #1 ревью);
 *   • `max_score` 2.5 округляется при зеркалировании в `primary_score`;
 *   • `include_rubric=false` / `include_ai_settings=false` зануляют поля в
 *     снимке, а синтез из Базы вернёт их обратно (P1 #4 ревью).
 * Любое расхождение → остаёмся на legacy-снимке (он самодостаточен и точен).
 *
 * Сравнение намеренно КОНСЕРВАТИВНО: ложное «не равно» безопасно (легаси-путь),
 * ложное «равно» — нет. Новое поле в `kbTaskToTemplateTaskJson` автоматически
 * попадает в сравнение — отдельной синхронизации не требует.
 */
export function templateTaskContentEquals(
  synthesized: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): boolean {
  const strip = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !CONTENT_COMPARE_OMIT.has(k)));
  return stableSerialize(strip(synthesized)) === stableSerialize(strip(snapshot));
}

/**
 * kb_task → элемент tasks_json (HomeworkTemplateTask-shape). Используется для
 * СИНТЕЗА legacy-формы GET /templates/:id из ссылок (deploy-skew: старый фронт
 * читает tasks_json, не зная о task_refs) — форма byte-совместима с тем, что
 * писал handleCreateTemplateFromAssignment.
 */
export function kbTaskToTemplateTaskJson(kb: KbTaskLike): Record<string, unknown> {
  const base: Record<string, unknown> = {
    task_text: nonEmpty(kb.text) ?? "[Задача на фото]",
    task_image_url: nonEmpty(kb.attachment_url),
    correct_answer: nonEmpty(kb.answer),
    max_score: kbTaskMaxScore(kb),
    solution_text: nonEmpty(kb.solution),
    solution_image_urls: nonEmpty(kb.solution_attachment_url),
    rubric_text: nonEmpty(kb.rubric_text),
    rubric_image_urls: nonEmpty(kb.rubric_image_urls),
    source_kb_task_id: kb.id,
  };
  const cf = asCheckFormat(kb.check_format);
  if (cf) base.check_format = cf;
  const tk = asTaskKind(kb.task_kind);
  if (tk) base.task_kind = tk;
  const cefr = asCefr(kb.cefr_level);
  if (cefr) base.cefr_level = cefr;
  if (typeof kb.kim_number === "number") base.kim_number = kb.kim_number;
  const gc = asCriteria(kb.grading_criteria_json);
  if (gc) base.grading_criteria_json = gc;
  return base;
}

/** Поля homework-задачи (payload ИЛИ строка homework_tutor_tasks), идущие в Базу. */
export interface HomeworkTaskFieldsForKb {
  task_text?: unknown;
  task_image_url?: unknown;
  correct_answer?: unknown;
  max_score?: unknown;
  rubric_text?: unknown;
  rubric_image_urls?: unknown;
  solution_text?: unknown;
  solution_image_urls?: unknown;
  check_format?: unknown;
  task_kind?: unknown;
  cefr_level?: unknown;
  kim_number?: unknown;
  grading_criteria_json?: unknown;
  // Ревью-фикс P1 (2026-07-06): каскад-классификация в push-body (конструктор
  // теперь её редактирует — F2). Присутствие ключа = «обнови», отсутствие =
  // «не трогай» (клиент шлёт только непустые — edit-prefill Базу не грузит).
  exam?: unknown;
  difficulty?: unknown;
  topic_id?: unknown;
  subtopic_id?: unknown;
  source_label?: unknown;
}

export interface KbMirrorOptions {
  ownerId: string;
  folderId: string;
  fingerprint: string;
  /** exam для классификации зеркала ('ege'|'oge'|null). */
  exam?: string | null;
  topicId?: string | null;
  subtopicId?: string | null;
  difficulty?: number | null;
  sourceLabel?: string | null;
}

/**
 * homework-задача → INSERT-объект kb_tasks (авто-зеркало / push-to-kb /
 * save-tasks-to-kb). primary_score = ROUND(max_score) (kb primary_score —
 * smallint; дробные half-step 12.5 округляются — единственная известная
 * потеря, редкая: ФИПИ-баллы целые).
 */
export function homeworkTaskFieldsToKbRow(
  t: HomeworkTaskFieldsForKb,
  opts: KbMirrorOptions,
): Record<string, unknown> {
  const maxScore = typeof t.max_score === "number" && Number.isFinite(t.max_score) && t.max_score > 0
    ? t.max_score
    : null;
  return {
    owner_id: opts.ownerId,
    folder_id: opts.folderId,
    topic_id: opts.topicId ?? null,
    subtopic_id: opts.subtopicId ?? null,
    exam: opts.exam === "ege" || opts.exam === "oge" ? opts.exam : null,
    kim_number: typeof t.kim_number === "number" && Number.isFinite(t.kim_number)
      ? Math.min(Math.max(Math.round(t.kim_number), 1), 40)
      : null,
    primary_score: maxScore != null ? Math.min(Math.round(maxScore), 32767) : null,
    difficulty: typeof opts.difficulty === "number" && opts.difficulty >= 1 && opts.difficulty <= 5
      ? Math.round(opts.difficulty)
      : null,
    text: nonEmpty(t.task_text) ?? "[Задача на фото]",
    answer: nonEmpty(t.correct_answer),
    solution: nonEmpty(t.solution_text),
    answer_format: null,
    check_format: asCheckFormat(t.check_format),
    task_kind: asTaskKind(t.task_kind),
    cefr_level: asCefr(t.cefr_level),
    grading_criteria_json: asCriteria(t.grading_criteria_json),
    rubric_text: nonEmpty(t.rubric_text),
    rubric_image_urls: nonEmpty(t.rubric_image_urls),
    attachment_url: nonEmpty(t.task_image_url),
    solution_attachment_url: nonEmpty(t.solution_image_urls),
    source_label: nonEmpty(opts.sourceLabel) ?? "my",
    fingerprint: opts.fingerprint,
  };
}

/**
 * UPDATE-объект kb_tasks для «Обновить в Базе» (push-to-kb): контент + вся
 * AI-настройка + новый fingerprint. Каскад-классификация (exam/difficulty/
 * topic_id/subtopic_id/source_label) включается УСЛОВНО — только когда ключ
 * ПРИСУТСТВУЕТ в body (ревью-фикс P1 2026-07-06): конструктор F2 её редактирует,
 * но edit-prefill Базу не грузит, поэтому отсутствие ключа = «не трогай» (иначе
 * слепой null затёр бы тему источника).
 */
export function homeworkTaskFieldsToKbUpdate(
  t: HomeworkTaskFieldsForKb,
  fingerprint: string,
): Record<string, unknown> {
  const maxScore = typeof t.max_score === "number" && Number.isFinite(t.max_score) && t.max_score > 0
    ? t.max_score
    : null;
  const row: Record<string, unknown> = {
    text: nonEmpty(t.task_text) ?? "[Задача на фото]",
    answer: nonEmpty(t.correct_answer),
    solution: nonEmpty(t.solution_text),
    attachment_url: nonEmpty(t.task_image_url),
    solution_attachment_url: nonEmpty(t.solution_image_urls),
    rubric_text: nonEmpty(t.rubric_text),
    rubric_image_urls: nonEmpty(t.rubric_image_urls),
    check_format: asCheckFormat(t.check_format),
    task_kind: asTaskKind(t.task_kind),
    cefr_level: asCefr(t.cefr_level),
    kim_number: typeof t.kim_number === "number" && Number.isFinite(t.kim_number)
      ? Math.min(Math.max(Math.round(t.kim_number), 1), 40)
      : null,
    grading_criteria_json: asCriteria(t.grading_criteria_json),
    primary_score: maxScore != null ? Math.min(Math.round(maxScore), 32767) : null,
    fingerprint,
    updated_at: new Date().toISOString(),
  };
  // Каскад: presence-семантика (не значение) — валидируем и пишем только
  // присланные ключи. exam принимает и 'olympiad' (kb_tasks.exam nullable,
  // kind-классификация темы живёт на kb_topics — сам exam='olympiad' не пишем).
  if ("exam" in t) {
    row.exam = t.exam === "ege" || t.exam === "oge" ? t.exam : null;
  }
  if ("difficulty" in t) {
    row.difficulty = typeof t.difficulty === "number" && t.difficulty >= 1 && t.difficulty <= 5
      ? Math.round(t.difficulty)
      : null;
  }
  if ("topic_id" in t) {
    row.topic_id = typeof t.topic_id === "string" && t.topic_id.length > 0 ? t.topic_id : null;
  }
  if ("subtopic_id" in t) {
    row.subtopic_id = typeof t.subtopic_id === "string" && t.subtopic_id.length > 0 ? t.subtopic_id : null;
  }
  if ("source_label" in t) {
    row.source_label = nonEmpty(t.source_label);
  }
  return row;
}
