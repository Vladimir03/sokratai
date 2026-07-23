import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeAvailableScore,
  evaluateStudentAnswer,
  generateHint,
  renormalizeCriteriaToScore,
} from "./guided_ai.ts";
import { sendPushNotification, type PushSubscriptionData, type PushPayload } from "../_shared/push-sender.ts";
import {
  sendHomeworkNotificationEmail,
  sendHomeworkTutorMessageEmail,
  sendStudentInviteEmail,
} from "../_shared/email-sender.ts";
import { logAnalyticsEvent, logAnalyticsEventOnce } from "../_shared/analytics.ts";
import {
  MAX_GUIDED_CHAT_ATTACHMENTS,
  MAX_RUBRIC_IMAGES,
  MAX_SOLUTION_IMAGES,
  MAX_TASK_IMAGES,
  parseAttachmentUrls,
} from "../_shared/attachment-refs.ts";
import { rewriteToDirect, rewriteToProxy, SUPABASE_PROXY_URL } from "../_shared/proxy-url.ts";
import type { SubjectCriterionTemplate } from "../_shared/subject-rubrics/index.ts";
import { computeFinalScore } from "../_shared/score-compute.ts";
import { buildLearningContext, type LearningContext } from "../_shared/learning-context.ts";
import { buildLimitReachedResponse, checkAiQuota } from "../_shared/subscription-limits.ts";
import {
  subjectToWhisperLang,
  transcribeAudio,
  VoiceTranscriptionError,
} from "../_shared/voice-transcribe.ts";
import {
  homeworkTaskFieldsToKbRow,
  homeworkTaskFieldsToKbUpdate,
  KB_TASK_SNAPSHOT_SELECT,
  type KbTaskLike,
  kbTaskToTemplateTaskJson,
} from "./kb_snapshot.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

/**
 * Fire-and-forget: фоновая генерация AI-эталона решения задач ДЗ
 * (strict-criteria-grading Phase 3 / Phase A). НЕ ждём и НЕ валим create/update
 * при сбое. Функция `homework-generate-reference` сама фильтрует eligible задачи
 * (физика, развёрнутые, без tutor solution_text, без готового эталона). Если она
 * ещё не задеплоена — fetch свалится молча (как mock-exam-grade). Паттерн:
 * un-awaited fetch к отдельной edge-функции (rule 95, EdgeRuntime.waitUntil не
 * используется в кодовой базе).
 */
function enqueueReferenceGeneration(assignmentId: string): void {
  try {
    fetch(`${SUPABASE_URL}/functions/v1/homework-generate-reference`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ assignment_id: assignmentId }),
    }).catch((err) => {
      console.warn("hw_reference_enqueue_failed", { error: String(err) });
    });
  } catch (err) {
    console.warn("hw_reference_enqueue_throw", { error: String(err) });
  }
}

/**
 * Phase C (strict-criteria-grading, 2026-07-04): при правке существующей задачи
 * возвращает поля для сброса кэша AI-эталона — НО ТОЛЬКО если реально изменилось
 * условие (`task_text` / `task_image_url`) ИЛИ эталон репетитора (`solution_text`).
 * Иначе стаёт баг: (а) условие поменяли, а эталон старый → грейдинг сверяет новое
 * решение со старым эталоном; (б) тутор добавил своё решение, а stale AI-эталон
 * побеждает его (reference-priority `aiReferenceSolution ?? solutionText`). После
 * сброса `enqueueReferenceGeneration` перегенерирует eligible задачи (физика,
 * развёрнутые, без tutor solution_text). Сравниваем ТОЛЬКО поля, реально
 * присутствующие в `updateFields` (в partial-update ветке они условны).
 */
function referenceResetFieldsIfChanged(
  stored: Record<string, unknown> | undefined,
  updateFields: Record<string, unknown>,
): Record<string, unknown> {
  if (!stored) return {};
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
  const keys = ["task_text", "task_image_url", "solution_text"] as const;
  let changed = false;
  for (const k of keys) {
    if (!(k in updateFields)) continue; // поле не пишется → не изменилось
    if (norm(stored[k]) !== norm(updateFields[k])) {
      changed = true;
      break;
    }
  }
  if (!changed) return {};
  return {
    ai_reference_solution: null,
    ai_reference_confidence: null,
    ai_reference_status: null,
    ai_reference_generated_at: null,
  };
}

// ─── unified-task-model (2026-07-05): авто-зеркало + провенанс ────────────────

/** Имя авто-папки Базы для задач, созданных прямо в конструкторе ДЗ. */
const KB_MIRROR_FOLDER_NAME = "Из ДЗ";

/**
 * Find-or-create корневой папки Базы владельца (case-insensitive дедуп —
 * извлечено из handleSaveTasksToKB, чтобы двойной вызов не плодил близнецов).
 * null при сбое (caller деградирует).
 */
async function resolveOrCreateRootKbFolder(
  db: SupabaseClient,
  ownerId: string,
  name: string,
): Promise<string | null> {
  const nameTrimmed = name.trim();
  const { data: existingFolders, error: existingErr } = await db
    .from("kb_folders")
    .select("id, name")
    .eq("owner_id", ownerId)
    .is("parent_id", null)
    .ilike("name", nameTrimmed);
  if (existingErr) {
    console.warn("hw_kb_mirror_folder_lookup_failed", { error: existingErr.message });
    return null;
  }
  const existing = (existingFolders ?? []).find(
    (f) => typeof f.name === "string" && f.name.trim().toLowerCase() === nameTrimmed.toLowerCase(),
  );
  if (existing) return existing.id as string;
  const { data: inserted, error: insertErr } = await db
    .from("kb_folders")
    .insert({ owner_id: ownerId, parent_id: null, name: nameTrimmed })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.warn("hw_kb_mirror_folder_create_failed", { error: insertErr?.message });
    return null;
  }
  return inserted.id as string;
}

/** Fingerprint через каноничную RPC (формула идентична moderation V2). null при сбое. */
async function computeKbFingerprint(
  db: SupabaseClient,
  text: string,
  answer: string,
  attachmentUrl: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("kb_normalize_fingerprint", {
    p_text: text,
    p_answer: answer,
    p_attachment_url: attachmentUrl,
  });
  if (error || typeof data !== "string") {
    console.warn("hw_kb_fingerprint_failed", { error: error?.message ?? "non_string" });
    return null;
  }
  return data;
}

/**
 * Валидация client-supplied kb_task_id (tri-state, провенанс снимка): задача
 * читаема тутором = своя ИЛИ активная каталожная. Невалидный id → null
 * (degrade: снимок сохраняется без провенанса, ДЗ не блокируется).
 */
async function resolveProvidedKbTaskId(
  db: SupabaseClient,
  tutorUserId: string,
  kbTaskId: unknown,
): Promise<string | null> {
  if (!isUUID(kbTaskId)) return null;
  const { data, error } = await db
    .from("kb_tasks")
    .select("id, owner_id, moderation_status")
    .eq("id", kbTaskId as string)
    .maybeSingle();
  if (error || !data) return null;
  const readable = data.owner_id === tutorUserId ||
    (data.owner_id === null && data.moderation_status === "active");
  return readable ? (data.id as string) : null;
}

/**
 * Авто-зеркало НОВОЙ задачи конструктора в Базу («двойное авторство»,
 * решение владельца 2026-07-05): fingerprint-дедуп против существующих задач
 * владельца (идемпотентный ретрай save) → иначе INSERT в папку «Из ДЗ» (или
 * mirror_folder_id). ДЕГРАДАЦИЯ, НЕ БЛОК: любой сбой → null (ДЗ сохраняется
 * без провенанса; recovery — «Сохранить в мою базу»). Выдача ДЗ — money-path.
 */
async function mirrorNewTaskToKb(
  db: SupabaseClient,
  tutorUserId: string,
  t: Record<string, unknown>,
  opts: { folderId: string | null; exam: string | null },
): Promise<string | null> {
  try {
    const folderId = opts.folderId ??
      await resolveOrCreateRootKbFolder(db, tutorUserId, KB_MIRROR_FOLDER_NAME);
    if (!folderId) return null;

    const taskText = isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]";
    const answer = isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : "";
    const attachment = isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : "";

    const fingerprint = await computeKbFingerprint(db, taskText, answer, attachment);
    if (!fingerprint) return null;

    const { data: existing } = await db
      .from("kb_tasks")
      .select("id")
      .eq("owner_id", tutorUserId)
      .eq("fingerprint", fingerprint)
      .limit(1)
      .maybeSingle();
    if (existing) return existing.id as string;

    // Классификация зеркала из нового каскада конструктора (best-effort:
    // невалидные topic/subtopic просто не пишутся — метаданные, не money-path).
    const topicId = isUUID(t.topic_id) ? (t.topic_id as string) : null;
    const subtopicId = isUUID(t.subtopic_id) ? (t.subtopic_id as string) : null;
    const row = homeworkTaskFieldsToKbRow(t, {
      ownerId: tutorUserId,
      folderId,
      fingerprint,
      exam: opts.exam,
      topicId,
      subtopicId,
      difficulty: typeof t.difficulty === "number" ? (t.difficulty as number) : null,
      sourceLabel: isNonEmptyString(t.source_label) ? (t.source_label as string) : null,
    });
    const { data: inserted, error: insertErr } = await db
      .from("kb_tasks")
      .insert(row)
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.warn("homework_api_auto_mirror_failed", { error: insertErr?.message });
      return null;
    }
    return inserted.id as string;
  } catch (e) {
    console.warn("homework_api_auto_mirror_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Статистика авто-зеркала для create/update-ответа (ревью-фикс P1 2026-07-06). */
interface KbMirrorStats {
  requested: number;
  succeeded: number;
  failed: number;
}

/**
 * БАТЧ-провенанс задач из tri-state `kb_task_id` (ревью-фикс P1 2026-07-06 —
 * прежний последовательный per-task цикл давал до ~3×N round-trips до вставки
 * задач, затягивая «Отправить»):
 *   uuid      → валидированный провенанс (ОДИН .in()-SELECT на все);
 *   null      → ЯВНО новая → авто-зеркало: fingerprints параллельно →
 *               дедуп внутри payload (закрывает same-request гонку) →
 *               ОДИН lookup существующих → ОДИН batch-INSERT недостающих;
 *   undefined → legacy-клиент → без зеркала.
 * Итог ≈ 4-5 round-trips + параллельные fingerprint-RPC вместо 60-90.
 * ДЕГРАДАЦИЯ, НЕ БЛОК: любой сбой → null-провенанс + failed-счётчик (ответ
 * несёт kb_mirror — фронт показывает нейтральный toast, выдача не блокируется).
 * Cross-request гонка дубля (нет unique на owner+fingerprint) — то же
 * best-effort, что у handleSaveTasksToKB (rule 40, осознанно).
 */
async function resolveTaskProvenanceBatch(
  db: SupabaseClient,
  tutorUserId: string,
  tasks: Record<string, unknown>[],
  opts: { mirrorFolderId: string | null; examFor: (t: Record<string, unknown>) => string | null },
): Promise<{ ids: (string | null)[]; mirror: KbMirrorStats }> {
  const ids: (string | null)[] = new Array(tasks.length).fill(null);
  const providedIdx: number[] = [];
  const newIdx: number[] = [];
  tasks.forEach((t, i) => {
    if (isUUID(t.kb_task_id)) providedIdx.push(i);
    else if (t.kb_task_id === null) newIdx.push(i);
    // undefined → legacy, остаётся null
  });
  const mirror: KbMirrorStats = { requested: newIdx.length, succeeded: 0, failed: 0 };

  try {
    // 1) Валидация переданных kb_task_id — один SELECT.
    if (providedIdx.length > 0) {
      const uniqueIds = Array.from(new Set(providedIdx.map((i) => tasks[i].kb_task_id as string)));
      const { data: kbRows } = await db
        .from("kb_tasks")
        .select("id, owner_id, moderation_status")
        .in("id", uniqueIds);
      const readable = new Set(
        (kbRows ?? [])
          .filter((k) =>
            k.owner_id === tutorUserId || (k.owner_id === null && k.moderation_status === "active")
          )
          .map((k) => k.id as string),
      );
      for (const i of providedIdx) {
        const id = tasks[i].kb_task_id as string;
        if (readable.has(id)) ids[i] = id;
      }
    }

    // 2) Авто-зеркало новых.
    if (newIdx.length > 0 && opts.mirrorFolderId) {
      const folderId = opts.mirrorFolderId;
      // Fingerprints — параллельно (RPC read-only).
      const fps = await Promise.all(
        newIdx.map((i) => {
          const t = tasks[i];
          const taskText = isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]";
          const answer = isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : "";
          const attachment = isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : "";
          return computeKbFingerprint(db, taskText, answer, attachment);
        }),
      );
      const idxByFp = new Map<string, number[]>();
      newIdx.forEach((taskIdx, k) => {
        const fp = fps[k];
        if (!fp) return; // fingerprint-сбой → failed
        const list = idxByFp.get(fp) ?? [];
        list.push(taskIdx);
        idxByFp.set(fp, list);
      });
      const uniqueFps = Array.from(idxByFp.keys());

      if (uniqueFps.length > 0) {
        // Один lookup существующих задач владельца (идемпотентный ретрай save).
        const { data: existingRows } = await db
          .from("kb_tasks")
          .select("id, fingerprint")
          .eq("owner_id", tutorUserId)
          .in("fingerprint", uniqueFps);
        const existingByFp = new Map(
          (existingRows ?? []).map((r) => [r.fingerprint as string, r.id as string]),
        );

        // Batch-INSERT недостающих (по одному ряду на unique fingerprint —
        // дубли внутри payload схлопываются на одну kb-задачу).
        const missingFps = uniqueFps.filter((fp) => !existingByFp.has(fp));
        if (missingFps.length > 0) {
          const rows = missingFps.map((fp) => {
            const firstIdx = (idxByFp.get(fp) as number[])[0];
            const t = tasks[firstIdx];
            return homeworkTaskFieldsToKbRow(t, {
              ownerId: tutorUserId,
              folderId,
              fingerprint: fp,
              exam: opts.examFor(t),
              topicId: isUUID(t.topic_id) ? (t.topic_id as string) : null,
              subtopicId: isUUID(t.subtopic_id) ? (t.subtopic_id as string) : null,
              difficulty: typeof t.difficulty === "number" ? (t.difficulty as number) : null,
              sourceLabel: isNonEmptyString(t.source_label) ? (t.source_label as string) : null,
            });
          });
          const { data: inserted, error: insertErr } = await db
            .from("kb_tasks")
            .insert(rows)
            .select("id, fingerprint");
          if (insertErr) {
            console.warn("homework_api_auto_mirror_failed", { error: insertErr.message, batch: rows.length });
          }
          for (const r of inserted ?? []) {
            existingByFp.set(r.fingerprint as string, r.id as string);
          }
        }

        for (const [fp, idxList] of idxByFp) {
          const kbId = existingByFp.get(fp);
          if (!kbId) continue;
          for (const i of idxList) {
            ids[i] = kbId;
            mirror.succeeded += 1;
          }
        }
      }
    }
  } catch (e) {
    console.warn("homework_api_auto_mirror_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  mirror.failed = mirror.requested - mirror.succeeded;
  return { ids, mirror };
}

const VALID_SUBJECTS_CREATE = [
  "maths", "physics", "informatics",
  "russian", "literature", "history", "social",
  "english", "french", "chemistry", "biology",
  "geography", "spanish", "other",
] as const;
const VALID_SUBJECTS_UPDATE = [
  ...VALID_SUBJECTS_CREATE,
  "math", "cs", "rus", "algebra", "geometry",
] as const;
const VALID_STATUSES = ["draft", "active", "closed"] as const;
const VALID_STATUS_FILTERS = ["draft", "active", "closed", "all"] as const;
const VALID_CHECK_FORMATS = ["short_answer", "detailed_solution"] as const;
const VALID_EXAM_TYPES = ["ege", "oge"] as const;
const VALID_CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

/**
 * Normalize a client-supplied CEFR level for `homework_tutor_tasks.cefr_level`
 * (CEFR-level fix 2026-05-29). Returns one of A2/B1/B2/C1 or null (= auto-detect).
 * `null` preserves the previous text-heuristic behaviour; an explicit value
 * forces the language rubric level in `resolveSubjectRubric`.
 */
function normalizeCefrLevel(v: unknown): "A1" | "A2" | "B1" | "B2" | "C1" | null {
  return typeof v === "string" && (VALID_CEFR_LEVELS as readonly string[]).includes(v)
    ? (v as "A1" | "A2" | "B1" | "B2" | "C1")
    : null;
}

/**
 * Normalize a client-supplied КИМ number for `homework_tutor_tasks.kim_number`
 * (Phase 2, 2026-06-21). Переносится из KB-задачи, чтобы AI грейдил по критериям
 * ФИПИ конкретного номера (`resolveSubjectRubric`). Integer 1..40 или null.
 */
function normalizeKimNumber(v: unknown): number | null {
  const n = typeof v === "number"
    ? v
    : typeof v === "string" && /^\d+$/.test(v.trim())
      ? parseInt(v.trim(), 10)
      : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 40 ? n : null;
}

/** Max criteria per task (defensive cap; ЕГЭ-русский = 10). */
const MAX_GRADING_CRITERIA = 30;

/**
 * Normalize client-supplied structured grading criteria for
 * `homework_tutor_tasks.grading_criteria_json` (criteria-grading feature, 2026-06).
 * Returns a clean `SubjectCriterionTemplate[]` (ANY subject) or null. Drops
 * malformed entries; clamps `max` to a positive half-step (mirror max_score
 * 0.5-step invariant, rule 40); whitelists `kind`; caps array + string lengths.
 * A bad payload never reaches grading. Written by all task write-paths.
 */
function normalizeGradingCriteria(v: unknown): SubjectCriterionTemplate[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: SubjectCriterionTemplate[] = [];
  const seenLabels = new Set<string>();
  for (const raw of v.slice(0, MAX_GRADING_CRITERIA)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 200) : "";
    if (!label) continue;
    // Dedupe by label — the cascade keys depends_on_zero / scoreByLabel on label
    // (guided_ai.ts::applyCriteriaCascade), so duplicate labels would collapse to
    // one Map entry and silently misroute a dependency. First label wins.
    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    const maxNum = typeof o.max === "number"
      ? o.max
      : typeof o.max === "string" && o.max.trim() !== ""
        ? Number(o.max)
        : NaN;
    if (!Number.isFinite(maxNum) || maxNum <= 0) continue;
    const max = Math.round(maxNum * 2) / 2; // snap to 0.5 step
    if (max <= 0) continue;
    seenLabels.add(labelKey);
    const entry: SubjectCriterionTemplate = { label, max };
    if (o.kind === "tutor_only") entry.kind = "tutor_only";
    if (typeof o.description === "string" && o.description.trim()) {
      entry.description = o.description.trim().slice(0, 1000);
    }
    if (Array.isArray(o.depends_on_zero)) {
      const deps = o.depends_on_zero
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.trim().slice(0, 200))
        .slice(0, MAX_GRADING_CRITERIA);
      if (deps.length > 0) entry.depends_on_zero = deps;
    }
    out.push(entry);
  }
  if (out.length === 0) return null;
  // Second pass: drop depends_on_zero refs that don't resolve to a real label in
  // THIS set (stale ref after a label rename → cascade would no-op anyway; this
  // keeps the data clean and the cascade deterministic). Self-refs dropped too.
  const validLabels = new Set(out.map((e) => e.label.toLowerCase()));
  for (const e of out) {
    if (!e.depends_on_zero) continue;
    const selfKey = e.label.toLowerCase();
    const resolved = e.depends_on_zero.filter(
      (d) => validLabels.has(d.toLowerCase()) && d.toLowerCase() !== selfKey,
    );
    if (resolved.length > 0) e.depends_on_zero = resolved;
    else delete e.depends_on_zero;
  }
  return out;
}

const VALID_FEEDBACK_LANGUAGES = ["auto", "russian", "target"] as const;

// Phase 11 (2026-05-31): foreign-language subjects где письменные/устные задачи
// ОБЯЗАНЫ нести явный CEFR-уровень (иначе silent default B1 — баг Эмилии).
// Mirror frontend `cefrLevelEnabled`. NOTE: 'russian'/'literature' — родной язык,
// CEFR не применяется.
const LANGUAGE_SUBJECTS_REQUIRING_CEFR = new Set<string>(["french", "english", "spanish"]);

/**
 * Phase 11 (2026-05-31): normalize assignment-level `feedback_language`.
 * Persist path returns 'auto'/'russian'/'target' or null (→ DB default 'auto').
 * Read path (passed to AI resolver) coerces null/invalid → 'auto'.
 */
function normalizeFeedbackLanguage(v: unknown): "auto" | "russian" | "target" | null {
  return typeof v === "string" && (VALID_FEEDBACK_LANGUAGES as readonly string[]).includes(v)
    ? (v as "auto" | "russian" | "target")
    : null;
}

/**
 * Derive `task_kind` (Phase 1 student-screen enum) from `check_format`.
 *
 * Mapping (mirrors backfill in migration `20260509120000_add_task_kind_to_homework_tasks.sql`):
 *   - `short_answer`       → `numeric`
 *   - `detailed_solution`  → `extended`
 *   - any other / null     → `extended` (safe DB default)
 *
 * Bug 2026-05-12: tutor save paths (`handleCreateAssignment`,
 * `handleUpdateAssignment`) wrote `check_format` but not `task_kind`, leaving
 * rows with the DB default `'extended'` even when tutor selected
 * «Краткий ответ». Frontend `ProblemContext.tsx` reads `task_kind` for the
 * warn banner → all numeric tasks looked like extended on student-side.
 *
 * Call this at EVERY write-path that touches `check_format` so the two
 * columns stay in sync. Backfill migration `20260513120000` resyncs existing
 * rows; this helper keeps new writes consistent going forward.
 */
function deriveTaskKind(
  checkFormat: string | null | undefined,
): "numeric" | "extended" {
  if (checkFormat === "short_answer") return "numeric";
  return "extended"; // detailed_solution | unknown | null
}

/**
 * Resolve the persisted `task_kind` for a write-path (voice-speaking-mvp,
 * 2026-05-29).
 *
 * `'speaking'` (устный монолог) is an explicit tutor choice — it is NOT
 * derivable from `check_format`. When the client sends `task_kind='speaking'`
 * verbatim, persist it as-is; otherwise fall back to
 * `deriveTaskKind(check_format)`.
 *
 * Keeps the §0 dual-derive invariant: speaking must be set explicitly at EVERY
 * write-path and never overwritten by check_format-based derivation. Only
 * `'speaking'` is special-cased — numeric/extended stay derived (the tutor UI
 * controls them via `check_format`).
 */
function resolveWriteTaskKind(
  clientTaskKind: unknown,
  checkFormat: string | null | undefined,
): "numeric" | "extended" | "speaking" {
  if (clientTaskKind === "speaking") return "speaking";
  return deriveTaskKind(checkFormat);
}
type NotifyFailureReason =
  | "missing_telegram_link" | "telegram_send_failed" | "telegram_send_error"
  | "push_expired" | "push_send_failed"
  | "email_send_failed"
  | "no_channels_available" | "all_channels_failed";

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("HOMEWORK_API_ALLOWED_ORIGINS");
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return FALLBACK_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  // Allow any *.lovableproject.com and *.lovable.app preview domains
  const isLovableOrigin =
    origin.endsWith(".lovableproject.com") ||
    origin.endsWith(".lovable.app");
  const matchedOrigin = allowed.includes(origin) || isLovableOrigin
    ? origin
    : allowed[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Helpers: Response ───────────────────────────────────────────────────────

function jsonOk(
  cors: Record<string, string>,
  payload: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonError(
  cors: Record<string, string>,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonTaskReorderFailed(
  cors: Record<string, string>,
  details?: unknown,
): Response {
  return jsonError(
    cors,
    500,
    "TASK_REORDER_FAILED",
    "Failed to reorder tasks",
    details,
  );
}

// ─── Helpers: Validation ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_THREAD_ATTACHMENTS = MAX_GUIDED_CHAT_ATTACHMENTS;
const THREAD_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp"]);
const THREAD_ATTACHMENT_EXTENSIONS = new Set([...THREAD_IMAGE_EXTENSIONS, "pdf"]);
const THREAD_ATTACHMENT_BUCKETS = new Set(["homework-submissions", "homework-images"]);
// Audio extensions for voice-speaking-mvp `voice_ref` validation (2026-05-29).
// Same bucket/namespace/SSRF/path-safety guards as image attachments (reuses
// extractStudentThreadAttachmentRefs) — only the allowed-extension set differs.
// Mirrors getVoiceFilename() outputs (ogg/mp3/m4a/wav/webm) + a couple aliases.
const THREAD_VOICE_EXTENSIONS = new Set(["webm", "m4a", "mp4", "ogg", "oga", "mp3", "wav"]);
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const VOICE_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const ALLOWED_VOICE_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
]);

function isUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

// max_score теперь допускает шаг 0.5 (см. миграцию
// 20260523120000_homework_tutor_tasks_max_score_halfstep.sql + .claude/rules/40-homework-system.md
// "Score step invariant 0.5 для max_score"). Tolerance 1e-9 защищает от
// floating-point junk (12.5 * 2 = 25.000000...01 в некоторых браузерах).
function isPositiveHalfStepNumber(v: unknown): v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
  const scaled = v * 2;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isMissingColumnError(message: string, column: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes(column.toLowerCase()) && (
    lower.includes("schema cache") ||
    (lower.includes("column") && lower.includes("does not exist"))
  );
}

function validateAttachmentRefLimit(
  cors: Record<string, string>,
  value: unknown,
  maxCount: number,
  fieldPath: string,
): Response | null {
  if (value === undefined || value === null || !isString(value)) return null;
  const refs = parseAttachmentUrls(value);
  if (refs.length > maxCount) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `${fieldPath} exceeds maximum of ${maxCount} images`,
    );
  }
  return null;
}

async function cleanupInsertedTasksAfterFailedReorder(
  db: SupabaseClient,
  assignmentId: string,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;

  const { error } = await db
    .from("homework_tutor_tasks")
    .delete()
    .eq("assignment_id", assignmentId)
    .in("id", taskIds);

  if (error) {
    console.error("homework_api_task_reorder_cleanup_failed", {
      assignment_id: assignmentId,
      inserted_task_ids: taskIds,
      error: error.message,
    });
  }
}

function hasUnsafeObjectPath(path: string): boolean {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => (
      segment === ".." ||
      segment.includes("\\") ||
      segment.includes("\0")
    ));
}

function normalizeThreadAttachmentRefs(refs: string[]): string[] {
  const unique = new Set<string>();
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function parseStoredThreadAttachmentRefs(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return normalizeThreadAttachmentRefs(
        parsed.filter((item): item is string => typeof item === "string"),
      );
    } catch {
      return [];
    }
  }

  return [trimmed];
}

async function cleanupThreadAttachmentRefs(
  db: SupabaseClient,
  rawRefs: unknown[],
): Promise<void> {
  const refs = normalizeThreadAttachmentRefs(
    rawRefs.flatMap((value) => parseStoredThreadAttachmentRefs(value)),
  ).filter((ref) => ref.startsWith("storage://"));

  if (refs.length === 0) return;

  const pathsByBucket = new Map<string, Set<string>>();
  for (const ref of refs) {
    const parsed = parseStorageRef(ref, "homework-submissions");
    if (!parsed?.bucket || !parsed.objectPath) continue;
    if (!THREAD_ATTACHMENT_BUCKETS.has(parsed.bucket)) continue;

    let bucketPaths = pathsByBucket.get(parsed.bucket);
    if (!bucketPaths) {
      bucketPaths = new Set<string>();
      pathsByBucket.set(parsed.bucket, bucketPaths);
    }
    bucketPaths.add(parsed.objectPath);
  }

  for (const [bucket, objectPaths] of pathsByBucket.entries()) {
    const paths = Array.from(objectPaths);
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await db.storage.from(bucket).remove(batch);
      if (error) {
        console.warn("homework_api_thread_attachments_cleanup_failed", {
          bucket,
          count: batch.length,
          error: error.message,
        });
      }
    }
  }
}

function serializeThreadAttachmentRefs(refs: string[]): string | null {
  const normalized = normalizeThreadAttachmentRefs(refs);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0];
  return JSON.stringify(normalized);
}

function getThreadAttachmentExtension(value: string): string {
  const trimmed = value.trim();
  const rawPath = trimmed.startsWith("storage://")
    ? trimmed.slice("storage://".length).split("/").slice(1).join("/")
    : (() => {
      try {
        return new URL(trimmed).pathname;
      } catch {
        return trimmed;
      }
    })();
  const cleanPath = rawPath.split("?")[0].split("#")[0];
  const lastSegment = cleanPath.split("/").filter(Boolean).pop() ?? "";
  const dotIdx = lastSegment.lastIndexOf(".");
  return dotIdx >= 0 ? lastSegment.slice(dotIdx + 1).toLowerCase() : "";
}

function isImageThreadAttachmentRef(value: string): boolean {
  return THREAD_IMAGE_EXTENSIONS.has(getThreadAttachmentExtension(value));
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function isAcceptedVoiceMimeType(mimeType: string): boolean {
  if (!mimeType) return false;

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return ALLOWED_VOICE_MIME_TYPES.has(normalized);
}

function getVoiceFilename(mimeType: string, providedName?: string): string {
  if (providedName && providedName.trim()) {
    return providedName;
  }

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized.includes("ogg")) return "voice.ogg";
  if (normalized.includes("mpeg")) return "voice.mp3";
  if (normalized.includes("mp4")) return "voice.m4a";
  if (normalized.includes("wav")) return "voice.wav";
  return "voice.webm";
}

// Reverse of getVoiceFilename: derive a Whisper-friendly MIME from a stored
// voice_ref's file extension (voice-speaking-mvp, 2026-05-29). The ref carries
// no MIME, so we infer it for transcribeAudio's Blob type + filename.
function voiceMimeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "webm":
      return "audio/webm";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    default:
      return "audio/webm";
  }
}

// ─── Helpers: Auth & Ownership ───────────────────────────────────────────────

interface AuthResult {
  userId: string;
}

async function authenticateUser(
  req: Request,
  cors: Record<string, string>,
): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Missing Authorization header");
  }
  // Use GoTrue API directly to validate token — avoids SDK session issues
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: authHeader,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("homework_api_auth_failed", {
      status: resp.status,
      body: body.slice(0, 200),
    });
    return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  return { userId: user.id };
}

async function getTutorOrThrow(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
): Promise<{ id: string } | Response> {
  const { data, error } = await db
    .from("tutors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    return jsonError(cors, 403, "NOT_TUTOR", "Tutor profile not found");
  }
  return { id: data.id };
}

async function getOwnedAssignmentOrThrow(
  db: SupabaseClient,
  assignmentId: string,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID format");
  }
  const { data, error } = await db
    .from("homework_tutor_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error || !data) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }
  if (data.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Assignment does not belong to you");
  }
  return data as Record<string, unknown>;
}

async function validateOwnedSourceGroupId(
  db: SupabaseClient,
  tutorId: string,
  sourceGroupId: unknown,
  cors: Record<string, string>,
): Promise<string | null | undefined | Response> {
  if (sourceGroupId === undefined) return undefined;
  if (sourceGroupId === null) return null;
  if (!isUUID(sourceGroupId)) {
    return jsonError(cors, 400, "VALIDATION", "source_group_id must be a UUID or null");
  }

  const { data, error } = await db
    .from("tutor_groups")
    .select("id")
    .eq("id", sourceGroupId)
    .eq("tutor_id", tutorId)
    .maybeSingle();

  if (error) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to validate source group");
  }
  if (!data) {
    return jsonError(cors, 403, "FORBIDDEN", "source_group_id does not belong to you");
  }

  return sourceGroupId as string;
}

// folder_id ownership (homework_folders). rule 40 FK-drift: homework_folders.tutor_id
// → auth.users(id), поэтому ключ — tutorUserId (auth.uid), НЕ tutors.id PK.
// Возврат: undefined = поле не передано (не трогать), null = «Без папки», string = валидный folder_id.
async function validateOwnedFolderId(
  db: SupabaseClient,
  tutorUserId: string,
  folderId: unknown,
  cors: Record<string, string>,
): Promise<string | null | undefined | Response> {
  if (folderId === undefined) return undefined;
  if (folderId === null) return null;
  if (!isUUID(folderId)) {
    return jsonError(cors, 400, "VALIDATION", "Папка указана неверно.");
  }

  const { data, error } = await db
    .from("homework_folders")
    .select("id")
    .eq("id", folderId)
    .eq("tutor_id", tutorUserId)
    .maybeSingle();

  if (error) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось проверить папку.");
  }
  if (!data) {
    return jsonError(cors, 403, "FORBIDDEN", "Эта папка вам не принадлежит.");
  }

  return folderId as string;
}

// ─── Routing ─────────────────────────────────────────────────────────────────

interface RouteMatch {
  segments: string[];
  method: string;
  searchParams: URLSearchParams;
}

function parseRoute(req: Request): RouteMatch {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const idx = pathname.indexOf("homework-api");
  const rest = idx >= 0 ? pathname.slice(idx + "homework-api".length) : "";
  const segments = rest.split("/").filter(Boolean);
  return { segments, method: req.method, searchParams: url.searchParams };
}

// ─── Endpoint: POST /assignments ─────────────────────────────────────────────

async function handleCreateAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  tutorId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required (non-empty string)");
  }
  if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS_CREATE as readonly string[]).includes(b.subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_CREATE.join(", ")}`);
  }
  if (b.topic !== undefined && b.topic !== null && !isString(b.topic)) {
    return jsonError(cors, 400, "VALIDATION", "topic must be a string or null");
  }
  if (b.description !== undefined && b.description !== null && !isString(b.description)) {
    return jsonError(cors, 400, "VALIDATION", "description must be a string or null");
  }
  if (b.deadline !== undefined && b.deadline !== null && !isString(b.deadline)) {
    return jsonError(cors, 400, "VALIDATION", "deadline must be an ISO date string or null");
  }
  if (b.exam_type !== undefined && b.exam_type !== null && !(VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string)) {
    return jsonError(cors, 400, "VALIDATION", `exam_type must be one of: ${VALID_EXAM_TYPES.join(", ")}`);
  }
  if (!Array.isArray(b.tasks) || b.tasks.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "tasks must be a non-empty array");
  }
  for (let i = 0; i < b.tasks.length; i++) {
    const t = b.tasks[i];
    if (!t || typeof t !== "object") {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}] must be an object`);
    }
    if (!isNonEmptyString(t.task_text) && !isNonEmptyString(t.task_image_url)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].task_text is required (or provide task_image_url)`);
    }
    if (t.max_score !== undefined && t.max_score !== null && !isPositiveHalfStepNumber(t.max_score)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].max_score must be a positive number with step 0.5`);
    }
    if (t.order_num !== undefined && t.order_num !== null && !isPositiveInt(t.order_num)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].order_num must be a positive integer`);
    }
    if (t.check_format !== undefined && t.check_format !== null && !(VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].check_format must be one of: ${VALID_CHECK_FORMATS.join(", ")}`);
    }
    // Phase 11 (2026-05-31): для языковых subjects письменные/устные задачи ОБЯЗАНЫ
    // нести явный CEFR-уровень (defense-in-depth; frontend тоже блокирует save).
    // Без уровня resolveSubjectRubric молча берёт B1 → A2-ДЗ грейдится по B1 (баг Эмилии).
    if (LANGUAGE_SUBJECTS_REQUIRING_CEFR.has(b.subject as string)) {
      const tk = resolveWriteTaskKind(
        (t as { task_kind?: unknown }).task_kind,
        (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
          ? (t.check_format as string)
          : "short_answer",
      );
      const needsCefr = tk === "extended" || tk === "proof" || tk === "speaking";
      if (needsCefr && !normalizeCefrLevel((t as { cefr_level?: unknown }).cefr_level)) {
        return jsonError(
          cors,
          400,
          "MISSING_CEFR_LEVEL",
          "Для языкового ДЗ укажи уровень CEFR (A2 / B1 / B2) — без него AI проверит работу по B1.",
        );
      }
    }
    const taskImageLimitError = validateAttachmentRefLimit(
      cors,
      t.task_image_url,
      MAX_TASK_IMAGES,
      `tasks[${i}].task_image_url`,
    );
    if (taskImageLimitError) return taskImageLimitError;
    const rubricImageLimitError = validateAttachmentRefLimit(
      cors,
      t.rubric_image_urls,
      MAX_RUBRIC_IMAGES,
      `tasks[${i}].rubric_image_urls`,
    );
    if (rubricImageLimitError) return rubricImageLimitError;
    const solutionImageLimitError = validateAttachmentRefLimit(
      cors,
      t.solution_image_urls,
      MAX_SOLUTION_IMAGES,
      `tasks[${i}].solution_image_urls`,
    );
    if (solutionImageLimitError) return solutionImageLimitError;
  }

  const sourceGroupIdOrErr = await validateOwnedSourceGroupId(
    db,
    tutorId,
    b.source_group_id,
    cors,
  );
  if (sourceGroupIdOrErr instanceof Response) return sourceGroupIdOrErr;

  // folder_id — необязательная папка-организация (homework_folders). Запрос Елены.
  const folderIdOrErr = await validateOwnedFolderId(db, tutorUserId, b.folder_id, cors);
  if (folderIdOrErr instanceof Response) return folderIdOrErr;

  // unified-task-model (2026-07-05): провенанс шаблона — «выдано из шаблона»
  // (source_template_id + usage_count для Банка ДЗ). Невалидный/чужой id →
  // молча null (не блокируем выдачу).
  let sourceTemplateId: string | null = null;
  if (isUUID(b.template_id)) {
    const { data: tpl } = await db
      .from("homework_tutor_templates")
      .select("id, tutor_id, visibility, usage_count")
      .eq("id", b.template_id as string)
      .maybeSingle();
    if (tpl && (tpl.tutor_id === tutorUserId || tpl.visibility === "shared")) {
      sourceTemplateId = tpl.id as string;
      // Best-effort счётчик (social proof Банка): read-then-write, редкая гонка
      // теряет инкремент — приемлемо для счётчика использований.
      const { error: usageErr } = await db
        .from("homework_tutor_templates")
        .update({ usage_count: ((tpl.usage_count as number) ?? 0) + 1 })
        .eq("id", sourceTemplateId);
      if (usageErr) {
        console.warn("homework_api_template_usage_count_failed", { error: usageErr.message });
      }
    }
  }

  const { data: assignment, error: assignErr } = await db
    .from("homework_tutor_assignments")
    .insert({
      tutor_id: tutorUserId,
      title: (b.title as string).trim(),
      subject: b.subject,
      topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
      description: isNonEmptyString(b.description) ? (b.description as string).trim() : null,
      deadline: isNonEmptyString(b.deadline) ? b.deadline : null,
      status: "draft",
      exam_type: (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string) ? b.exam_type : "ege",
      disable_ai_bootstrap: b.disable_ai_bootstrap === true,
      // Phase 11 (2026-05-31): assignment-level AI feedback language (null → DB default 'auto').
      feedback_language: normalizeFeedbackLanguage(b.feedback_language) ?? "auto",
      source_group_id: sourceGroupIdOrErr ?? null,
      // folder_id: undefined (поле не передано) → NULL «Без папки».
      folder_id: folderIdOrErr ?? null,
      // unified-task-model: шаблон-источник (null для ДЗ не из шаблона).
      source_template_id: sourceTemplateId,
    })
    .select("id")
    .single();

  if (assignErr || !assignment) {
    console.error("homework_api_request_error", { route: "POST /assignments", error: assignErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to create assignment");
  }

  // unified-task-model (2026-07-05): провенанс/авто-зеркало per task.
  // Tri-state kb_task_id: uuid = снимок KB-задачи; null = ЯВНО новая →
  // авто-зеркало в Базу («двойное авторство»); undefined = старый клиент →
  // legacy (без зеркала). Сбой зеркала = degrade (warn + null), НЕ блок выдачи.
  const tasksPayloadForProvenance = b.tasks as Record<string, unknown>[];
  const needsMirror = tasksPayloadForProvenance.some((t) => t.kb_task_id === null);
  let mirrorFolderId: string | null = null;
  if (needsMirror) {
    if (isUUID(b.mirror_folder_id)) {
      const { data: mf } = await db
        .from("kb_folders")
        .select("id, owner_id")
        .eq("id", b.mirror_folder_id as string)
        .maybeSingle();
      if (mf && mf.owner_id === tutorUserId) mirrorFolderId = mf.id as string;
    }
    if (!mirrorFolderId) {
      mirrorFolderId = await resolveOrCreateRootKbFolder(db, tutorUserId, KB_MIRROR_FOLDER_NAME);
    }
  }
  const assignmentExam = (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string)
    ? (b.exam_type as string)
    : "ege";
  // Батч (ревью-фикс P1): ~4-5 round-trips вместо ~3×N последовательных.
  const provenanceBatch = await resolveTaskProvenanceBatch(db, tutorUserId, tasksPayloadForProvenance, {
    mirrorFolderId,
    // Per-task Тип из каскада выигрывает; undefined + № КИМ → exam_type ДЗ.
    examFor: (t) =>
      t.exam === "ege" || t.exam === "oge"
        ? (t.exam as string)
        : (t.exam === undefined && normalizeKimNumber(t.kim_number) != null ? assignmentExam : null),
  });
  const sourceKbIds = provenanceBatch.ids;
  const provenanceSyncedAt = new Date().toISOString();

  const taskRows = (b.tasks as Record<string, unknown>[]).map((t, i) => {
    const normalizedCheckFormat = (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
      ? (t.check_format as string)
      : "short_answer";
    return {
      assignment_id: assignment.id,
      order_num: isPositiveInt(t.order_num) ? t.order_num : i + 1,
      task_text: isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]",
      task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
      correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
      max_score: isPositiveHalfStepNumber(t.max_score) ? t.max_score : 1,
      rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
      rubric_image_urls: isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null,
      solution_text: isNonEmptyString(t.solution_text) ? (t.solution_text as string).trim() : null,
      solution_image_urls: isNonEmptyString(t.solution_image_urls) ? (t.solution_image_urls as string).trim() : null,
      check_format: normalizedCheckFormat,
      // Phase 3.1 hotfix (2026-05-13): keep `task_kind` in sync with `check_format`
      // at every write. voice-speaking-mvp (2026-05-29): explicit 'speaking' wins
      // over derive (§0 dual-derive — устный монолог не выводится из check_format).
      task_kind: resolveWriteTaskKind(t.task_kind, normalizedCheckFormat),
      // CEFR-level fix (2026-05-29): persist explicit «Уровень» (A2/B1/B2/C1) or null.
      cefr_level: normalizeCefrLevel(t.cefr_level),
      // Phase 2 (2026-06-21): № КИМ из KB → grading по критериям ФИПИ этого номера.
      kim_number: normalizeKimNumber(t.kim_number),
      // Criteria-grading feature (2026-06): структурные критерии репетитора (любой
      // предмет) → покритериальная AI-оценка. Normalize защищает от битого payload.
      grading_criteria_json: normalizeGradingCriteria(t.grading_criteria_json),
      // unified-task-model: провенанс снимка (per-row, вместо позиционного
      // homework_kb_tasks). NULL = legacy-клиент или сбой авто-зеркала.
      source_kb_task_id: sourceKbIds[i] ?? null,
      source_kb_synced_at: sourceKbIds[i] ? provenanceSyncedAt : null,
    };
  });

  const { error: tasksErr } = await db
    .from("homework_tutor_tasks")
    .insert(taskRows);

  if (tasksErr) {
    console.error("homework_api_request_error", { route: "POST /assignments", error: tasksErr.message });
    await db.from("homework_tutor_assignments").delete().eq("id", assignment.id);
    return jsonError(cors, 500, "DB_ERROR", "Failed to create tasks");
  }

  // Feature 1: save_as_template
  if (b.save_as_template === true) {
    // Field-parity fix (2026-06-03): шаблон обязан нести check_format / task_kind
    // (иначе reuse откатывал «развёрнутый»→«краткий» и task_kind→numeric).
    // cefr_level — только для языковых предметов (на физике/математике поля нет).
    const isLanguageTemplate = LANGUAGE_SUBJECTS_REQUIRING_CEFR.has(b.subject as string);
    const templateTasksJson = taskRows.map((t) => ({
      task_text: t.task_text,
      task_image_url: t.task_image_url,
      correct_answer: t.correct_answer,
      max_score: t.max_score,
      rubric_text: t.rubric_text,
      rubric_image_urls: t.rubric_image_urls,
      solution_text: t.solution_text,
      solution_image_urls: t.solution_image_urls,
      check_format: t.check_format,
      task_kind: t.task_kind,
      cefr_level: isLanguageTemplate ? t.cefr_level : null,
      kim_number: t.kim_number,
      grading_criteria_json: t.grading_criteria_json,
    }));
    const { error: templateErr } = await db
      .from("homework_tutor_templates")
      .insert({
        tutor_id: tutorUserId,
        title: (b.title as string).trim(),
        subject: b.subject,
        topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
        tags: [],
        tasks_json: templateTasksJson,
        // Assignment-level settings parity (field-parity fix 2026-06-03).
        exam_type: (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string) ? b.exam_type : "ege",
        disable_ai_bootstrap: b.disable_ai_bootstrap === true,
        // feedback_language — только для языковых (на не-языковых null).
        feedback_language: isLanguageTemplate ? (normalizeFeedbackLanguage(b.feedback_language) ?? "auto") : null,
      });
    if (templateErr) {
      console.warn("homework_api_template_save_failed", {
        assignment_id: assignment.id,
        error: templateErr.message,
      });
    }
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments",
    tutor_id: tutorUserId,
    assignment_id: assignment.id,
  });

  // Воронка (онбординг v2 T9): первое созданное ДЗ репетитора (раз на репетитора).
  await logAnalyticsEventOnce(
    db,
    {
      event_name: "tutor_first_homework_created",
      tutor_id: tutorId,
      actor_user_id: tutorUserId,
      assignment_id: assignment.id as string,
    },
    { tutor_id: tutorId },
  );

  // Phase A: фоновая генерация AI-эталона (физика — фильтрует сама функция).
  enqueueReferenceGeneration(assignment.id as string);

  // kb_mirror — additive telemetry авто-зеркала (ревью-фикс P1 2026-07-06):
  // фронт показывает нейтральный toast при failed>0 (обещание «→ в Базу» не
  // нарушается молча); старые клиенты поле игнорируют.
  return jsonOk(cors, { assignment_id: assignment.id, kb_mirror: provenanceBatch.mirror }, 201);
}

// ─── Shared score helpers (used by handleListAssignments + handleGetResults) ──

interface TaskStateScoreFields {
  thread_id: string;
  task_id: string;
  earned_score: number | null;
  status: string | null;
  ai_score: number | null;
  tutor_score_override: number | null;
  hint_count: number | null;
  attempts: number | null;
}

// computeFinalScore moved to `../_shared/score-compute.ts` (student-progress R2)
// so the tutor-progress aggregate reuses the SAME priority chain (not duplicated).
// `TaskStateScoreFields` is structurally assignable to the shared `FinalScoreFields`.
// Priority: tutor_score_override → earned_score → ai_score → (completed ? max : 0).

/**
 * Wall-clock minutes between the first and last `homework_tutor_thread_messages.created_at`
 * for a student. `Math.max(1, …)` ensures any non-empty thread reports ≥1 min.
 * Returns `null` when there is no thread or no messages (frontend renders «—»).
 * See: docs/delivery/features/homework-student-totals/spec.md AC-9.
 */
function computeTotalMinutes(times: { first: string; last: string } | undefined): number | null {
  if (!times) return null;
  const diffMs = new Date(times.last).getTime() - new Date(times.first).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.max(1, Math.round(diffMs / 60000));
}

// ─── Endpoint: GET /assignments ──────────────────────────────────────────────

async function handleListAssignments(
  db: SupabaseClient,
  tutorUserId: string,
  searchParams: URLSearchParams,
  cors: Record<string, string>,
): Promise<Response> {
  const statusFilter = searchParams.get("status") ?? "all";
  if (!(VALID_STATUS_FILTERS as readonly string[]).includes(statusFilter)) {
    return jsonError(cors, 400, "VALIDATION", `status must be one of: ${VALID_STATUS_FILTERS.join(", ")}`);
  }

  const groupFilter = searchParams.get("group_id");
  if (groupFilter && !isUUID(groupFilter)) {
    return jsonError(cors, 400, "VALIDATION", "group_id must be a UUID");
  }

  let query = db
    .from("homework_tutor_assignments")
    // folder_id — tutor-only organization (homework_folders). Безопасно для tutor
    // list; в student-эндпоинтах (handleGetStudentAssignment и т.п.) НЕ селектится.
    .select("id, title, subject, topic, deadline, status, created_at, source_group_id, folder_id")
    .eq("tutor_id", tutorUserId)
    .order("created_at", { ascending: false });

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  if (groupFilter) {
    query = query.eq("source_group_id", groupFilter);
  }

  const { data: assignments, error } = await query;
  if (error) {
    console.error("homework_api_request_error", { route: "GET /assignments", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to fetch assignments");
  }

  if (!assignments || assignments.length === 0) {
    return jsonOk(cors, []);
  }

  const assignmentIds = assignments.map((a) => a.id);
  const sourceGroupIds = [...new Set(
    assignments
      .map((assignment) => assignment.source_group_id)
      .filter((groupId): groupId is string => typeof groupId === "string" && groupId.length > 0),
  )];

  const groupMetaById: Record<string, { name: string | null; color: string | null }> = {};
  if (sourceGroupIds.length > 0) {
    const { data: groups } = await db
      .from("tutor_groups")
      .select("id, name, short_name, color")
      .eq("tutor_id", tutorUserId)
      .in("id", sourceGroupIds);

    for (const group of groups ?? []) {
      groupMetaById[group.id] = {
        name: (group.short_name?.trim() || group.name) ?? null,
        color: group.color ?? null,
      };
    }
  }

  const { data: assignedCounts } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, delivery_status")
    .in("assignment_id", assignmentIds);

  const assignedMap: Record<string, number> = {};
  const deliveredMap: Record<string, number> = {};
  const notConnectedMap: Record<string, number> = {};
  const saIdToAssignment: Record<string, string> = {};
  const allSaIds: string[] = [];
  for (const r of assignedCounts ?? []) {
    assignedMap[r.assignment_id] = (assignedMap[r.assignment_id] ?? 0) + 1;
    saIdToAssignment[r.id as string] = r.assignment_id as string;
    allSaIds.push(r.id as string);
    const ds = r.delivery_status as string;
    if (ds === "delivered" || ds === "delivered_push" || ds === "delivered_telegram" || ds === "delivered_email") {
      deliveredMap[r.assignment_id] = (deliveredMap[r.assignment_id] ?? 0) + 1;
    } else if (ds === "failed_not_connected" || ds === "failed_no_channel") {
      notConnectedMap[r.assignment_id] = (notConnectedMap[r.assignment_id] ?? 0) + 1;
    }
  }

  const submittedMap: Record<string, number> = {};
  const startedMap: Record<string, number> = {};
  const scoreMap: Record<string, { sum: number; count: number }> = {};
  // Отметка «Проверено» на карточке ДЗ (запрос Елены 2026-06-18): число сдавших
  // учеников, чья работа НЕ полностью проверена (есть задача с tutor_reviewed_at IS NULL).
  const reviewPendingMap: Record<string, number> = {};
  let totalMaxByAssignment: Record<string, number> = {};

  // "Started" count = distinct student_assignment_id with at least one user
  // message. Threads are provisioned eagerly at assign-time, so thread existence
  // alone would overcount and make started_count ~= assigned_count.
  if (allSaIds.length > 0) {
    const { data: allThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status")
      .in("student_assignment_id", allSaIds);

    const threadIdToAssignment: Record<string, string> = {};
    const completedThreads: Array<{ id: string; student_assignment_id: string }> = [];
    const allThreadIds: string[] = [];

    for (const thread of allThreads ?? []) {
      const threadId = thread.id as string;
      const studentAssignmentId = thread.student_assignment_id as string;
      const assignmentId = saIdToAssignment[studentAssignmentId];
      if (!assignmentId) continue;

      threadIdToAssignment[threadId] = assignmentId;
      allThreadIds.push(threadId);

      if (thread.status === "completed") {
        submittedMap[assignmentId] = (submittedMap[assignmentId] ?? 0) + 1;
        completedThreads.push({
          id: threadId,
          student_assignment_id: studentAssignmentId,
        });
      }
    }

    if (allThreadIds.length > 0) {
      const { data: startedMessages } = await db
        .from("homework_tutor_thread_messages")
        .select("thread_id")
        .in("thread_id", allThreadIds)
        .eq("role", "user");

      const startedThreadIds = new Set<string>();
      for (const row of startedMessages ?? []) {
        const threadId = row.thread_id as string;
        if (!threadId || startedThreadIds.has(threadId)) continue;
        startedThreadIds.add(threadId);
        const assignmentId = threadIdToAssignment[threadId];
        if (assignmentId) {
          startedMap[assignmentId] = (startedMap[assignmentId] ?? 0) + 1;
        }
      }
    }

    if (completedThreads && completedThreads.length > 0) {
      const threadIds = completedThreads.map((t) => t.id);

      // Get ALL task states for completed threads (no status filter — active tasks
      // contribute 0/max to the average, matching handleGetResults behaviour).
      const { data: taskStates } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, task_id, earned_score, ai_score, tutor_score_override, status, tutor_reviewed_at, tutor_force_completed_at")
        .in("thread_id", threadIds);

      // Fetch max_score from tasks for guided assignments
      const { data: guidedTasks } = await db
        .from("homework_tutor_tasks")
        .select("id, max_score, assignment_id")
        .in("assignment_id", assignmentIds);

      const guidedTaskMaxScore: Record<string, number> = {};
      const tasksByAssignment: Record<string, string[]> = {};
      totalMaxByAssignment = {};
      for (const t of guidedTasks ?? []) {
        guidedTaskMaxScore[t.id] = t.max_score ?? 1;
        if (!tasksByAssignment[t.assignment_id]) tasksByAssignment[t.assignment_id] = [];
        tasksByAssignment[t.assignment_id].push(t.id as string);
        totalMaxByAssignment[t.assignment_id] =
          (totalMaxByAssignment[t.assignment_id] ?? 0) + (t.max_score ?? 1);
      }

      // Множество подтверждённых задач на каждый тред. «Проверено» =
      // tutor_reviewed_at ИЛИ tutor_force_completed_at (force-close = решение
      // репетитора, 2026-07-20) — Deno-зеркало isTaskScoreReviewed
      // (src/lib/homeworkReview.ts).
      const reviewedTasksByThread: Record<string, Set<string>> = {};
      for (const ts of taskStates ?? []) {
        if (ts.tutor_reviewed_at != null || ts.tutor_force_completed_at != null) {
          const tid = ts.thread_id as string;
          if (!reviewedTasksByThread[tid]) reviewedTasksByThread[tid] = new Set();
          reviewedTasksByThread[tid].add(ts.task_id as string);
        }
      }

      // Aggregate scores per thread using the same computeFinalScore chain as
      // handleGetResults so both surfaces show the same value.
      const threadScores: Record<string, { earned: number; maxTotal: number }> = {};
      for (const ts of taskStates ?? []) {
        const maxScore = guidedTaskMaxScore[ts.task_id] ?? 1;
        if (!threadScores[ts.thread_id]) {
          threadScores[ts.thread_id] = { earned: 0, maxTotal: 0 };
        }
        threadScores[ts.thread_id].earned += computeFinalScore(
          ts as TaskStateScoreFields,
          maxScore,
        );
        threadScores[ts.thread_id].maxTotal += maxScore;
      }

      for (const thread of completedThreads) {
        const aId = saIdToAssignment[thread.student_assignment_id];
        if (!aId) continue;

        const scores = threadScores[thread.id];
        if (scores && scores.maxTotal > 0) {
          if (!scoreMap[aId]) {
            scoreMap[aId] = { sum: 0, count: 0 };
          }
          // Accumulate absolute score (not %) — divided at the end to get avg.
          scoreMap[aId].sum += scores.earned;
          scoreMap[aId].count += 1;
        }

        // «Полностью проверено» = каждая задача ДЗ подтверждена для этого ученика
        // (mirror frontend isStudentWorkFullyReviewed). Иначе работа на проверку.
        // ДЗ без задач (edge, code review P2) → vacuously reviewed, не «на проверку».
        const assignmentTaskIds = tasksByAssignment[aId] ?? [];
        const reviewedSet = reviewedTasksByThread[thread.id] ?? new Set<string>();
        const fullyReviewed =
          assignmentTaskIds.length === 0 ||
          assignmentTaskIds.every((tid) => reviewedSet.has(tid));
        if (!fullyReviewed) {
          reviewPendingMap[aId] = (reviewPendingMap[aId] ?? 0) + 1;
        }
      }
    }
  }

  const result = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    subject: a.subject,
    topic: a.topic,
    deadline: a.deadline,
    status: a.status,
    created_at: a.created_at,
    source_group_id: a.source_group_id ?? null,
    source_group_name: groupMetaById[a.source_group_id ?? ""]?.name ?? null,
    source_group_color: groupMetaById[a.source_group_id ?? ""]?.color ?? null,
    folder_id: a.folder_id ?? null,
    assigned_count: assignedMap[a.id] ?? 0,
    submitted_count: submittedMap[a.id] ?? 0,
    started_count: startedMap[a.id] ?? 0,
    // Запрос Елены (2026-06-18): сдавшие, чья работа НЕ полностью проверена → бейдж на карточке.
    review_pending_count: reviewPendingMap[a.id] ?? 0,
    delivered_count: deliveredMap[a.id] ?? 0,
    not_connected_count: notConnectedMap[a.id] ?? 0,
    // Absolute average score (e.g. 3.2 out of 5). Use max_score_total for display.
    avg_score: scoreMap[a.id]?.count
      ? Math.round((scoreMap[a.id].sum / scoreMap[a.id].count) * 100) / 100
      : null,
    max_score_total: totalMaxByAssignment[a.id] ?? null,
  }));

  console.log("homework_api_request_success", {
    route: "GET /assignments",
    tutor_id: tutorUserId,
    count: result.length,
  });
  return jsonOk(cors, result);
}

// ─── Endpoint: GET /assignments/:id ──────────────────────────────────────────

async function handleGetAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  // НЕ глотать error (rule 45, инцидент 2026-07-04): проглоченный
  // «column does not exist» превращался в tasks=[] → «В задании нет задач»
  // во всех ДЗ. Схема-дрейф должен падать громко, не тихо пустеть.
  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, correct_answer, max_score, rubric_text, rubric_image_urls, solution_text, solution_image_urls, check_format, task_kind, kim_number, cefr_level, grading_criteria_json, ai_reference_solution, ai_reference_confidence, ai_reference_status, ai_reference_generated_at, source_kb_task_id, source_kb_synced_at")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });
  if (tasksError) {
    console.error("homework_api_get_assignment_tasks_error", {
      assignment_id: assignmentId,
      error: tasksError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить задачи задания");
  }

  const { data: kbTaskLinks, error: kbTaskLinksError } = await db
    .from("homework_kb_tasks")
    .select(`
      task_id,
      sort_order,
      task_text_snapshot,
      task_answer_snapshot,
      task_solution_snapshot,
      snapshot_edited,
      kb_tasks (
        solution_attachment_url,
        source_label
      )
    `)
    .eq("homework_id", assignmentId);
  if (kbTaskLinksError) {
    // KB-провенанс — декоративный слой (бейджи «из БЗ»): логируем и
    // продолжаем без него, задачи ДЗ важнее.
    console.error("homework_api_get_assignment_kb_links_error", {
      assignment_id: assignmentId,
      error: kbTaskLinksError.message,
    });
  }

  const kbProvenanceBySortOrder = new Map<number, {
    kb_task_id: string | null;
    kb_snapshot_text: string | null;
    kb_snapshot_answer: string | null;
    kb_snapshot_solution: string | null;
    kb_snapshot_edited: boolean;
    kb_snapshot_solution_image_refs: string | null;
    kb_source_label: string | null;
  }>();

  for (const link of kbTaskLinks ?? []) {
    if (typeof link.sort_order !== "number") continue;
    const kbTask = Array.isArray(link.kb_tasks) ? link.kb_tasks[0] : link.kb_tasks;
    kbProvenanceBySortOrder.set(link.sort_order, {
      kb_task_id: typeof link.task_id === "string" ? link.task_id : null,
      kb_snapshot_text: link.task_text_snapshot ?? null,
      kb_snapshot_answer: link.task_answer_snapshot ?? null,
      kb_snapshot_solution: link.task_solution_snapshot ?? null,
      kb_snapshot_edited: link.snapshot_edited === true,
      kb_snapshot_solution_image_refs: kbTask?.solution_attachment_url ?? null,
      kb_source_label: kbTask?.source_label ?? null,
    });
  }

  // unified-task-model (2026-07-05): per-row провенанс source_kb_task_id
  // ПРЕДПОЧИТАЕТСЯ позиционному homework_kb_tasks (legacy-fallback). Гидрация
  // живых kb-полей для divergence-бейджа («Обновить в Базе») у тутора.
  const sourceKbIdsForHydration = Array.from(
    new Set(
      (tasks ?? [])
        .map((t) => t.source_kb_task_id)
        .filter((id): id is string => isUUID(id)),
    ),
  );
  const kbSourceById = new Map<string, {
    owner_id: string | null;
    source_label: string | null;
    solution_attachment_url: string | null;
    updated_at: string | null;
  }>();
  if (sourceKbIdsForHydration.length > 0) {
    const { data: kbSources, error: kbSourcesErr } = await db
      .from("kb_tasks")
      .select("id, owner_id, source_label, solution_attachment_url, updated_at")
      .in("id", sourceKbIdsForHydration);
    if (kbSourcesErr) {
      // Провенанс — декоративный слой: логируем и продолжаем.
      console.error("homework_api_get_assignment_kb_sources_error", {
        assignment_id: assignmentId,
        error: kbSourcesErr.message,
      });
    }
    for (const row of kbSources ?? []) {
      kbSourceById.set(row.id as string, {
        owner_id: (row.owner_id as string | null) ?? null,
        source_label: (row.source_label as string | null) ?? null,
        solution_attachment_url: (row.solution_attachment_url as string | null) ?? null,
        updated_at: (row.updated_at as string | null) ?? null,
      });
    }
  }

  const tasksWithKbProvenance = (tasks ?? []).map((task) => {
    // Приоритет 1: per-row провенанс (новый путь).
    if (isUUID(task.source_kb_task_id)) {
      const kb = kbSourceById.get(task.source_kb_task_id as string);
      return {
        ...task,
        kb_task_id: task.source_kb_task_id,
        kb_snapshot_text: null,
        kb_snapshot_answer: null,
        kb_snapshot_solution: null,
        kb_snapshot_edited: false,
        kb_snapshot_solution_image_refs: kb?.solution_attachment_url ?? null,
        kb_source_label: kb?.source_label ?? (kb ? (kb.owner_id ? "my" : "socrat") : null),
        // Живые метки для divergence-детекта на фронте:
        kb_source_updated_at: kb?.updated_at ?? null,
        kb_source_owner: kb ? (kb.owner_id ? "my" : "socrat") : null,
      };
    }
    // Приоритет 2: legacy позиционный homework_kb_tasks.
    const sortOrder = Number(task.order_num ?? 0) - 1;
    const provenance = kbProvenanceBySortOrder.get(sortOrder);
    if (!provenance) {
      return task;
    }
    return {
      ...task,
      kb_task_id: provenance.kb_task_id,
      kb_snapshot_text: provenance.kb_snapshot_text,
      kb_snapshot_answer: provenance.kb_snapshot_answer,
      kb_snapshot_solution: provenance.kb_snapshot_solution,
      kb_snapshot_edited: provenance.kb_snapshot_edited,
      kb_snapshot_solution_image_refs: provenance.kb_snapshot_solution_image_refs,
      kb_source_label: provenance.kb_source_label,
    };
  });

  const { data: studentAssignments } = await db
    .from("homework_tutor_student_assignments")
    .select("id, student_id, notified, notified_at, delivery_status, delivery_error_code")
    .eq("assignment_id", assignmentId);

  let assignedStudents: unknown[] = [];
  if (studentAssignments && studentAssignments.length > 0) {
    const studentIds = studentAssignments.map((sa) => sa.student_id);
    const { data: profiles } = await db
      .from("profiles")
      .select("id, username, telegram_user_id")
      .in("id", studentIds);

    const profileMap: Record<string, string | null> = {};
    const telegramFromProfile: Record<string, boolean> = {};
    for (const p of profiles ?? []) {
      profileMap[p.id] = p.username;
      if (p.telegram_user_id != null) telegramFromProfile[p.id] = true;
    }

    // Resolve has_telegram_link via profiles.telegram_user_id OR
    // telegram_sessions.user_id (used by web Telegram login flow).
    const { data: tgSessions } = await db
      .from("telegram_sessions")
      .select("user_id, telegram_user_id")
      .in("user_id", studentIds);

    const telegramFromSessions: Record<string, boolean> = {};
    for (const s of tgSessions ?? []) {
      if (s.telegram_user_id != null) {
        telegramFromSessions[s.user_id as string] = true;
      }
    }

    // Resolve has_email via auth.users.email (skip placeholder temp emails so
    // "Напомнить на email" doesn't offer a dead channel for Telegram-only users).
    const emailByUser: Record<string, boolean> = {};
    for (const uid of studentIds) {
      try {
        const { data: userRes } = await db.auth.admin.getUserById(uid);
        const email = userRes?.user?.email;
        if (email && !email.endsWith("@temp.sokratai.ru")) {
          emailByUser[uid] = true;
        }
      } catch {
        // treat lookup failure as "no email" — channel will just be unavailable
      }
    }

    assignedStudents = studentAssignments.map((sa) => ({
      student_id: sa.student_id,
      name: profileMap[sa.student_id] ?? null,
      notified: sa.notified,
      notified_at: sa.notified_at,
      delivery_status: sa.delivery_status,
      delivery_error_code: sa.delivery_error_code,
      has_telegram_link:
        Boolean(telegramFromProfile[sa.student_id]) ||
        Boolean(telegramFromSessions[sa.student_id]),
      has_email: Boolean(emailByUser[sa.student_id]),
    }));
  }

  const { data: materials } = await db
    .from("homework_tutor_materials")
    .select("id, type, storage_ref, url, title, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });

  const statusCounts: Record<string, number> = {};
  let scoreSum = 0;
  let scoreCount = 0;
  let guidedCompletedCount = 0;
  // `has_interactions` mirrors the destructive-change gate in PUT /assignments/:id:
  // any user message across all threads counts as "student has started solving".
  // The tutor editor reads this to lock add/remove task actions.
  let hasInteractions = false;

  // Guided chat: add completed thread data to submissions summary
  if (studentAssignments && studentAssignments.length > 0) {
    const saIds = studentAssignments.map((sa) => sa.id);

    const { data: allThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status")
      .in("student_assignment_id", saIds);

    const allThreadIds = (allThreads ?? []).map((t) => t.id as string);
    if (allThreadIds.length > 0) {
      const { count: userMsgCount } = await db
        .from("homework_tutor_thread_messages")
        .select("id", { count: "exact", head: true })
        .in("thread_id", allThreadIds)
        .eq("role", "user");
      hasInteractions = (userMsgCount ?? 0) > 0;
    }

    const completedThreads = (allThreads ?? []).filter((t) => t.status === "completed");

    if (completedThreads.length > 0) {
      const threadIds = completedThreads.map((t) => t.id);

      const { data: taskStates } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, task_id, earned_score")
        .in("thread_id", threadIds)
        .eq("status", "completed");

      // Build max_score lookup from tasks already fetched above
      const taskMaxScoreMap: Record<string, number> = {};
      for (const t of tasks ?? []) {
        taskMaxScoreMap[t.id] = t.max_score ?? 1;
      }

      const threadScores: Record<string, { earned: number; maxTotal: number }> = {};
      for (const ts of taskStates ?? []) {
        if (!threadScores[ts.thread_id]) {
          threadScores[ts.thread_id] = { earned: 0, maxTotal: 0 };
        }
        threadScores[ts.thread_id].earned += Number(ts.earned_score ?? 0);
        threadScores[ts.thread_id].maxTotal += taskMaxScoreMap[ts.task_id] ?? 1;
      }

      for (const thread of completedThreads) {
        guidedCompletedCount++;
        statusCounts["completed"] = (statusCounts["completed"] ?? 0) + 1;

        const scores = threadScores[thread.id];
        if (scores && scores.maxTotal > 0) {
          scoreSum += (scores.earned / scores.maxTotal) * 100;
          scoreCount += 1;
        }
      }
    }
  }

  const submissionsSummary = {
    total: guidedCompletedCount,
    by_status: statusCounts,
    avg_percent: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
    has_interactions: hasInteractions,
  };

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });

  return jsonOk(cors, {
    assignment,
    tasks: tasksWithKbProvenance,
    assigned_students: assignedStudents,
    materials: materials ?? [],
    submissions_summary: submissionsSummary,
  });
}

// ─── Endpoint: PUT /assignments/:id ──────────────────────────────────────────

async function handleUpdateAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  tutorId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  // kb_mirror — additive telemetry авто-зеркала новых задач (ревью-фикс P1
  // 2026-07-06); null когда tasks не менялись / вставок не было.
  let updateKbMirror: KbMirrorStats | null = null;

  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    if (!isNonEmptyString(b.title)) return jsonError(cors, 400, "VALIDATION", "title must be a non-empty string");
    patch.title = (b.title as string).trim();
  }
  if (b.subject !== undefined) {
    if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS_UPDATE as readonly string[]).includes(b.subject)) {
      return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_UPDATE.join(", ")}`);
    }
    patch.subject = b.subject;
  }
  if (b.topic !== undefined) {
    patch.topic = isNonEmptyString(b.topic) ? (b.topic as string).trim() : null;
  }
  if (b.description !== undefined) {
    patch.description = isNonEmptyString(b.description) ? (b.description as string).trim() : null;
  }
  if (b.deadline !== undefined) {
    patch.deadline = isNonEmptyString(b.deadline) ? b.deadline : null;
  }
  if (b.exam_type !== undefined) {
    if (!isNonEmptyString(b.exam_type) || !(VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type)) {
      return jsonError(cors, 400, "VALIDATION", `exam_type must be one of: ${VALID_EXAM_TYPES.join(", ")}`);
    }
    patch.exam_type = b.exam_type;
  }
  if (b.status !== undefined) {
    if (!isNonEmptyString(b.status) || !(VALID_STATUSES as readonly string[]).includes(b.status)) {
      return jsonError(cors, 400, "VALIDATION", `status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    patch.status = b.status;
  }
  if (b.disable_ai_bootstrap !== undefined) {
    patch.disable_ai_bootstrap = b.disable_ai_bootstrap === true;
  }
  // Phase 11 (2026-05-31): assignment-level AI feedback language.
  if (b.feedback_language !== undefined) {
    patch.feedback_language = normalizeFeedbackLanguage(b.feedback_language) ?? "auto";
  }
  if (b.source_group_id !== undefined) {
    const sourceGroupIdOrErr = await validateOwnedSourceGroupId(
      db,
      tutorId,
      b.source_group_id,
      cors,
    );
    if (sourceGroupIdOrErr instanceof Response) return sourceGroupIdOrErr;
    patch.source_group_id = sourceGroupIdOrErr ?? null;
  }
  // folder_id — перемещение ДЗ в папку (homework_folders) / null = «Без папки». Запрос Елены.
  if (b.folder_id !== undefined) {
    const folderIdOrErr = await validateOwnedFolderId(db, tutorUserId, b.folder_id, cors);
    if (folderIdOrErr instanceof Response) return folderIdOrErr;
    patch.folder_id = folderIdOrErr ?? null;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db
      .from("homework_tutor_assignments")
      .update(patch)
      .eq("id", assignmentId);
    if (error) {
      console.error("homework_api_request_error", { route: "PUT /assignments/:id", error: error.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to update assignment");
    }
  }

  if (b.tasks !== undefined) {
    if (!Array.isArray(b.tasks)) {
      return jsonError(cors, 400, "VALIDATION", "tasks must be an array");
    }
    // ДЗ обязано иметь ≥1 задачу (mirror CREATE). Иначе 0-task ДЗ ломает рассчёты
    // (review_pending_count, очередь проверки — code review P2). UI так не делает.
    if (b.tasks.length === 0) {
      return jsonError(cors, 400, "VALIDATION", "В домашнем задании должна быть хотя бы одна задача.");
    }

    // Phase 11 review fix R2 (2026-06-01): зеркалим CREATE-валидацию CEFR на UPDATE.
    // Direct API / старый клиент могли обновить языковые письменные задачи без
    // cefr_level → silent B1 (ровно то, что Phase 11 убивает). Валидируем только
    // когда tasks present (status/assign-only апдейты задачи не шлют — не затронуты).
    // Effective subject = новый (если меняется) ИЛИ текущий из БД.
    const updateEffectiveSubject = isNonEmptyString(b.subject)
      ? (b.subject as string)
      : (typeof (assignmentOrErr as Record<string, unknown>).subject === "string"
          ? ((assignmentOrErr as { subject: string }).subject)
          : "");
    const updateRequiresCefr = LANGUAGE_SUBJECTS_REQUIRING_CEFR.has(updateEffectiveSubject);

    for (let i = 0; i < b.tasks.length; i++) {
      const t = b.tasks[i];
      if (!t || typeof t !== "object") {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}] must be an object`);
      }
      if (!isNonEmptyString(t.task_text) && !isNonEmptyString(t.task_image_url)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].task_text is required (or provide task_image_url)`);
      }
      if (t.max_score !== undefined && t.max_score !== null && !isPositiveHalfStepNumber(t.max_score)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].max_score must be a positive number with step 0.5`);
      }
      if (t.order_num !== undefined && t.order_num !== null && !isPositiveInt(t.order_num)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].order_num must be a positive integer`);
      }
      if (t.check_format !== undefined && t.check_format !== null && !(VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].check_format must be one of: ${VALID_CHECK_FORMATS.join(", ")}`);
      }
      // Phase 11 review fix R2: язык. subject + письменная/устная задача → cefr_level обязателен.
      if (updateRequiresCefr) {
        const tk = resolveWriteTaskKind(
          (t as { task_kind?: unknown }).task_kind,
          (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
            ? (t.check_format as string)
            : "short_answer",
        );
        const needsCefr = tk === "extended" || tk === "proof" || tk === "speaking";
        if (needsCefr && !normalizeCefrLevel((t as { cefr_level?: unknown }).cefr_level)) {
          return jsonError(
            cors,
            400,
            "MISSING_CEFR_LEVEL",
            "Для языкового ДЗ укажи уровень CEFR (A2 / B1 / B2) — без него AI проверит работу по B1.",
          );
        }
      }
      const taskImageLimitError = validateAttachmentRefLimit(
        cors,
        t.task_image_url,
        MAX_TASK_IMAGES,
        `tasks[${i}].task_image_url`,
      );
      if (taskImageLimitError) return taskImageLimitError;
      const rubricImageLimitError = validateAttachmentRefLimit(
        cors,
        t.rubric_image_urls,
        MAX_RUBRIC_IMAGES,
        `tasks[${i}].rubric_image_urls`,
      );
      if (rubricImageLimitError) return rubricImageLimitError;
      const solutionImageLimitError = validateAttachmentRefLimit(
        cors,
        t.solution_image_urls,
        MAX_SOLUTION_IMAGES,
        `tasks[${i}].solution_image_urls`,
      );
      if (solutionImageLimitError) return solutionImageLimitError;
    }

    // Detect if any student has interacted with the assignment via guided threads.
    // Block destructive task changes only if there are existing thread messages.
    let hasSubmissions = false;
    {
      const { data: existingSAs } = await db
        .from("homework_tutor_student_assignments")
        .select("id")
        .eq("assignment_id", assignmentId);
      const existingSAIds = (existingSAs ?? []).map((sa) => sa.id as string);
      if (existingSAIds.length > 0) {
        const { data: existingThreads } = await db
          .from("homework_tutor_threads")
          .select("id")
          .in("student_assignment_id", existingSAIds);
        const existingThreadIds = (existingThreads ?? []).map((t) => t.id as string);
        if (existingThreadIds.length > 0) {
          const { count: msgCount } = await db
            .from("homework_tutor_thread_messages")
            .select("id", { count: "exact", head: true })
            .in("thread_id", existingThreadIds)
            .eq("role", "user");
          hasSubmissions = (msgCount ?? 0) > 0;
        }
      }
    }

    const { data: existingTasks } = await db
      .from("homework_tutor_tasks")
      // Phase C: task_text/task_image_url/solution_text — для сравнения «до/после»
      // и сброса кэша AI-эталона только при реальном изменении условия/решения.
      .select("id, order_num, task_text, task_image_url, solution_text")
      .eq("assignment_id", assignmentId);
    const existingTaskRows = existingTasks ?? [];
    const existingIds = new Set(existingTaskRows.map((t) => t.id));
    const existingTaskById = new Map(
      existingTaskRows.map((t) => [t.id as string, t as Record<string, unknown>]),
    );
    const maxCurrentOrder = Math.max(
      0,
      ...existingTaskRows.map((t) => (typeof t.order_num === "number" ? t.order_num : 0)),
    );

    const incomingTasks = b.tasks as Record<string, unknown>[];
    const normalizedIncomingTasks = incomingTasks.map((task, index) => {
      const taskId = isUUID(task.id) ? (task.id as string) : null;
      return {
        task,
        desiredOrder: isPositiveInt(task.order_num) ? (task.order_num as number) : index + 1,
        existingId: taskId && existingIds.has(taskId) ? taskId : null,
      };
    });
    const incomingIds = new Set(
      normalizedIncomingTasks
        .filter((t) => t.existingId)
        .map((t) => t.existingId as string),
    );
    const desiredOrderNums = new Set(normalizedIncomingTasks.map((t) => t.desiredOrder));
    if (desiredOrderNums.size !== normalizedIncomingTasks.length) {
      return jsonError(cors, 400, "VALIDATION", "Duplicate order_num values in tasks");
    }

    if (hasSubmissions) {
      const newTasks = normalizedIncomingTasks.filter((t) => !t.existingId);
      const removedIds = [...existingIds].filter((id) => !incomingIds.has(id));

      if (newTasks.length > 0 || removedIds.length > 0) {
        return jsonError(
          cors,
          400,
          "DESTRUCTIVE_CHANGE",
          "Cannot add or remove tasks when submissions exist. Only updating existing tasks is allowed.",
          { new_tasks: newTasks.length, removed_tasks: removedIds.length },
        );
      }

      // Atomic reorder via PL/pgSQL transaction (avoids UNIQUE constraint corruption)
      const taskOrder = normalizedIncomingTasks
        .filter((t) => t.existingId)
        .map((t) => ({ id: t.existingId as string, order_num: t.desiredOrder }));
      if (taskOrder.length > 0) {
        const { error: reorderErr } = await db.rpc("hw_reorder_tasks", {
          p_assignment_id: assignmentId,
          p_task_order: taskOrder,
        });
        if (reorderErr) {
          console.error("homework_api_task_reorder_failed", {
            route: "PUT /assignments/:id",
            assignment_id: assignmentId,
            stage: "update_existing_with_submissions",
            error: reorderErr.message,
            task_order_size: taskOrder.length,
          });
          return jsonTaskReorderFailed(cors, {
            stage: "update_existing_with_submissions",
            reason: reorderErr.message,
          });
        }
      }
      // Update task fields (order_num already set atomically above)
      for (let i = 0; i < incomingTasks.length; i++) {
        const t = incomingTasks[i];
        if (!isUUID(t.id)) continue;
        const updateFields: Record<string, unknown> = {};
        updateFields.task_text = isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]";
        if (t.task_image_url !== undefined) {
          updateFields.task_image_url = isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null;
        }
        if (t.correct_answer !== undefined) {
          updateFields.correct_answer = isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null;
        }
        if (t.max_score !== undefined) {
          updateFields.max_score = isPositiveHalfStepNumber(t.max_score) ? t.max_score : 1;
        }
        if (t.rubric_text !== undefined) {
          updateFields.rubric_text = isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null;
        }
        if (t.rubric_image_urls !== undefined) {
          updateFields.rubric_image_urls = isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null;
        }
        if (t.solution_text !== undefined) {
          updateFields.solution_text = isNonEmptyString(t.solution_text) ? (t.solution_text as string).trim() : null;
        }
        if (t.solution_image_urls !== undefined) {
          updateFields.solution_image_urls = isNonEmptyString(t.solution_image_urls) ? (t.solution_image_urls as string).trim() : null;
        }
        if (t.check_format !== undefined) {
          const normalizedCheckFormat = (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
            ? (t.check_format as string)
            : "short_answer";
          updateFields.check_format = normalizedCheckFormat;
          // Phase 3.1 hotfix (2026-05-13): keep task_kind in sync with check_format.
          // voice-speaking-mvp (2026-05-29): explicit 'speaking' wins over derive (§0).
          updateFields.task_kind = resolveWriteTaskKind(t.task_kind, normalizedCheckFormat);
        } else if (t.task_kind === "speaking") {
          // Speaking-задача может прислать task_kind без check_format — фиксируем явно (§0).
          updateFields.task_kind = "speaking";
        }
        if (t.cefr_level !== undefined) {
          // CEFR-level fix (2026-05-29): partial-update path persists explicit level.
          updateFields.cefr_level = normalizeCefrLevel(t.cefr_level);
        }
        if (t.kim_number !== undefined) {
          // Phase 2 (2026-06-21): № КИМ round-trips on edit (grading по ФИПИ).
          updateFields.kim_number = normalizeKimNumber(t.kim_number);
        }
        if (t.grading_criteria_json !== undefined) {
          // Criteria-grading feature (2026-06): структурные критерии round-trip on edit.
          updateFields.grading_criteria_json = normalizeGradingCriteria(t.grading_criteria_json);
        }

        // Phase C: сброс кэша AI-эталона при изменении условия/эталона (regen ниже).
        Object.assign(
          updateFields,
          referenceResetFieldsIfChanged(existingTaskById.get(t.id as string), updateFields),
        );
        const { error } = await db
          .from("homework_tutor_tasks")
          .update(updateFields)
          .eq("id", t.id)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks update", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to update task fields");
        }
      }
    } else {
      const toUpdate = normalizedIncomingTasks.filter((t) => t.existingId);
      const toInsert = normalizedIncomingTasks.filter((t) => !t.existingId);
      const toDeleteIds = [...existingIds].filter((id) => !incomingIds.has(id));

      // Order: insert new at temp orders → atomic final reorder → update existing fields → delete removed.
      // This keeps reorder failures free of partial field writes on existing tasks.

      // 1. Insert new tasks at temporary high order_num values to avoid UNIQUE conflicts.
      const tempOrderBase =
        Math.max(
          maxCurrentOrder,
          ...normalizedIncomingTasks.map((t) => t.desiredOrder),
          0,
        ) + 1000;
      const insertedTaskIds: string[] = [];
      // unified-task-model (2026-07-05): провенанс/авто-зеркало для НОВЫХ задач
      // (mirror create-path; существующие задачи провенанс НЕ ретро-зеркалят —
      // решение владельца №5, recovery = «Сохранить в мою базу»).
      let updMirrorFolderId: string | null = null;
      if (toInsert.some((entry) => entry.task.kb_task_id === null)) {
        if (isUUID(b.mirror_folder_id)) {
          const { data: mf } = await db
            .from("kb_folders")
            .select("id, owner_id")
            .eq("id", b.mirror_folder_id as string)
            .maybeSingle();
          if (mf && mf.owner_id === tutorUserId) updMirrorFolderId = mf.id as string;
        }
        if (!updMirrorFolderId) {
          updMirrorFolderId = await resolveOrCreateRootKbFolder(db, tutorUserId, KB_MIRROR_FOLDER_NAME);
        }
      }
      const updAssignmentExam = (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string)
        ? (b.exam_type as string)
        : ((VALID_EXAM_TYPES as readonly string[]).includes(
            (assignmentOrErr as Record<string, unknown>).exam_type as string,
          )
          ? ((assignmentOrErr as Record<string, unknown>).exam_type as string)
          : "ege");
      // Батч-провенанс для новых задач (ревью-фикс P1, mirror create-path).
      const updProvenance = await resolveTaskProvenanceBatch(
        db,
        tutorUserId,
        toInsert.map((entry) => entry.task),
        {
          mirrorFolderId: updMirrorFolderId,
          examFor: (t) =>
            t.exam === "ege" || t.exam === "oge"
              ? (t.exam as string)
              : (t.exam === undefined && normalizeKimNumber(t.kim_number) != null ? updAssignmentExam : null),
        },
      );
      updateKbMirror = updProvenance.mirror;
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i++) {
          const t = toInsert[i].task;
          const normalizedCheckFormat = (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
            ? (t.check_format as string)
            : "short_answer";
          const sourceKbId = updProvenance.ids[i];
          const { data: insertedRow, error } = await db
            .from("homework_tutor_tasks")
            .insert({
              assignment_id: assignmentId,
              order_num: tempOrderBase + i + 1,
              task_text: isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]",
              task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
              correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
              max_score: isPositiveHalfStepNumber(t.max_score) ? t.max_score : 1,
              rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
              rubric_image_urls: isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null,
              solution_text: isNonEmptyString(t.solution_text) ? (t.solution_text as string).trim() : null,
              solution_image_urls: isNonEmptyString(t.solution_image_urls) ? (t.solution_image_urls as string).trim() : null,
              check_format: normalizedCheckFormat,
              // Phase 3.1 hotfix (2026-05-13): keep task_kind in sync.
              // voice-speaking-mvp (2026-05-29): explicit 'speaking' wins over derive (§0).
              task_kind: resolveWriteTaskKind(t.task_kind, normalizedCheckFormat),
              cefr_level: normalizeCefrLevel(t.cefr_level),
              kim_number: normalizeKimNumber(t.kim_number),
              grading_criteria_json: normalizeGradingCriteria(t.grading_criteria_json),
              // unified-task-model: провенанс снимка (tri-state, mirror create).
              source_kb_task_id: sourceKbId,
              source_kb_synced_at: sourceKbId ? new Date().toISOString() : null,
            })
            .select("id")
            .single();
          const insertedId = (insertedRow as { id?: string } | null)?.id ?? null;
          if (error || !isUUID(insertedId)) {
            console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks insert", error: error?.message ?? "missing inserted id" });
            return jsonError(cors, 500, "DB_ERROR", "Failed to insert new tasks");
          }
          insertedTaskIds.push(insertedId);
        }
      }

      // 2. Final atomic reorder:
      // kept tasks get their final desired order, removed tasks are parked at the tail,
      // then the actual delete happens last.
      const insertedIdQueue = [...insertedTaskIds];
      const keptTaskOrder = normalizedIncomingTasks.map((entry) => {
        if (entry.existingId) {
          return { id: entry.existingId, order_num: entry.desiredOrder };
        }
        const insertedId = insertedIdQueue.shift();
        return insertedId ? { id: insertedId, order_num: entry.desiredOrder } : null;
      });
      if (keptTaskOrder.some((entry) => entry === null)) {
        await cleanupInsertedTasksAfterFailedReorder(db, assignmentId, insertedTaskIds);
        console.error("homework_api_task_reorder_failed", {
          route: "PUT /assignments/:id",
          assignment_id: assignmentId,
          stage: "map_inserted_tasks_for_reorder",
          inserted_task_ids: insertedTaskIds,
          error: "missing inserted task mapping",
        });
        return jsonTaskReorderFailed(cors, {
          stage: "map_inserted_tasks_for_reorder",
          reason: "missing inserted task mapping",
        });
      }
      const parkingBase = tempOrderBase + toInsert.length;
      const parkingTaskOrder = toDeleteIds.map((id, index) => ({
        id,
        order_num: parkingBase + index + 1,
      }));
      const reorderPayload = [
        ...(keptTaskOrder as Array<{ id: string; order_num: number }>),
        ...parkingTaskOrder,
      ];
      if (reorderPayload.length > 0) {
        const { error: reorderErr } = await db.rpc("hw_reorder_tasks", {
          p_assignment_id: assignmentId,
          p_task_order: reorderPayload,
        });
        if (reorderErr) {
          await cleanupInsertedTasksAfterFailedReorder(db, assignmentId, insertedTaskIds);
          console.error("homework_api_task_reorder_failed", {
            route: "PUT /assignments/:id",
            assignment_id: assignmentId,
            stage: "replace_tasks_without_submissions",
            inserted_task_ids: insertedTaskIds,
            error: reorderErr.message,
            task_order_size: reorderPayload.length,
          });
          return jsonTaskReorderFailed(cors, {
            stage: "replace_tasks_without_submissions",
            reason: reorderErr.message,
          });
        }
      }

      // 3. Update existing task fields only after reorder succeeds, so a
      // failed reorder never persists a half-applied edit state.
      for (let i = 0; i < toUpdate.length; i++) {
        const entry = toUpdate[i];
        const t = entry.task;
        const normalizedCheckFormat = (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
          ? (t.check_format as string)
          : "short_answer";
        const updateFields: Record<string, unknown> = {
          task_text: isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]",
          task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
          correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
          max_score: isPositiveHalfStepNumber(t.max_score) ? t.max_score : 1,
          rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
          rubric_image_urls: isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null,
          solution_text: isNonEmptyString(t.solution_text) ? (t.solution_text as string).trim() : null,
          solution_image_urls: isNonEmptyString(t.solution_image_urls) ? (t.solution_image_urls as string).trim() : null,
          check_format: normalizedCheckFormat,
          // Phase 3.1 hotfix (2026-05-13): keep task_kind in sync.
          // voice-speaking-mvp (2026-05-29): explicit 'speaking' wins over derive (§0).
          task_kind: resolveWriteTaskKind(t.task_kind, normalizedCheckFormat),
          cefr_level: normalizeCefrLevel(t.cefr_level),
          kim_number: normalizeKimNumber(t.kim_number),
          grading_criteria_json: normalizeGradingCriteria(t.grading_criteria_json),
        };
        // Phase C: сброс кэша AI-эталона при изменении условия/эталона (regen ниже).
        Object.assign(
          updateFields,
          referenceResetFieldsIfChanged(existingTaskById.get(entry.existingId as string), updateFields),
        );
        const { error } = await db
          .from("homework_tutor_tasks")
          .update(updateFields)
          .eq("id", entry.existingId as string)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks update", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to update task fields");
        }
      }

      // 4. Delete removed tasks only after the final order is safely in place.
      if (toDeleteIds.length > 0) {
        const { error } = await db
          .from("homework_tutor_tasks")
          .delete()
          .in("id", toDeleteIds)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks delete", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to delete removed tasks");
        }
      }
    }

    await syncThreadCursorOrdersForAssignment(db, assignmentId);
  }

  console.log("homework_api_request_success", {
    route: "PUT /assignments/:id",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });

  // Phase A: (ре)генерация AI-эталона для новых/failed задач (фильтрует функция).
  enqueueReferenceGeneration(assignmentId);

  return jsonOk(cors, { ok: true, kb_mirror: updateKbMirror });
}

// ─── Endpoint: POST /assignments/:id/assign ──────────────────────────────────

// Онбординг v2 — display-name плейсхолдера для гейта «Подключить».
function onboardingStudentName(
  profile: { username?: unknown; telegram_username?: unknown } | undefined,
  sid: string,
): string {
  if (profile?.username && String(profile.username).trim().length > 0) {
    return String(profile.username);
  }
  if (profile?.telegram_username && String(profile.telegram_username).trim().length > 0) {
    return `@${String(profile.telegram_username).replace(/^@/, "")}`;
  }
  return sid;
}

/**
 * Онбординг v2 (T3) — ученики без канала доставки И не подключённые (нужен
 * share-gate «Подключить»). Зеркало students_without_telegram (rule 40), но
 * шире: учитывает claim (`tutor_students.claimed_at`) + реальный email + telegram.
 *
 * «Без канала» = НЕ claim'нул (claimed_at IS NULL) И нет telegram_user_id И
 * email временный/отсутствует (`@temp.sokratai.ru`). Claim'нувшие / с реальным
 * email / с telegram — исключены → после подключения гейт не появляется.
 * Auth-email проверяется ТОЛЬКО для кандидатов (no-telegram + not-claimed) —
 * это и есть свежие плейсхолдеры, их обычно немного.
 */
async function computeStudentsWithoutChannel(
  db: SupabaseClient,
  tutorId: string,
  studentIds: string[],
  profileById: Map<string, { username?: unknown; telegram_username?: unknown; telegram_user_id?: unknown }>,
): Promise<{ ids: string[]; names: string[] }> {
  const { data: links } = await db
    .from("tutor_students")
    .select("student_id, claimed_at")
    .eq("tutor_id", tutorId)
    .in("student_id", studentIds);
  const claimedByStudent = new Map(
    (links ?? []).map((l) => [l.student_id as string, l.claimed_at as string | null]),
  );

  const candidates = studentIds.filter(
    (sid) => !profileById.get(sid)?.telegram_user_id && !claimedByStudent.get(sid),
  );

  const ids: string[] = [];
  for (const sid of candidates) {
    let noRealEmail = true;
    try {
      const { data } = await db.auth.admin.getUserById(sid);
      const em = data?.user?.email ?? "";
      noRealEmail = !em || em.toLowerCase().endsWith("@temp.sokratai.ru");
    } catch {
      noRealEmail = true; // при сбое — безопаснее показать гейт
    }
    if (noRealEmail) ids.push(sid);
  }
  const names = ids.map((sid) => onboardingStudentName(profileById.get(sid), sid));
  return { ids, names };
}

async function handleAssignStudents(
  db: SupabaseClient,
  tutorUserId: string,
  tutorId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (b.group_id !== undefined && b.group_id !== null && !isUUID(b.group_id)) {
    return jsonError(cors, 400, "VALIDATION", "group_id must be a UUID or null");
  }

  let studentIds: string[] = [];
  if (Array.isArray(b.student_ids) && b.student_ids.length > 0) {
    for (let i = 0; i < b.student_ids.length; i++) {
      if (!isUUID(b.student_ids[i])) {
        return jsonError(cors, 400, "VALIDATION", `student_ids[${i}] is not a valid UUID`);
      }
    }
    studentIds = [...new Set(b.student_ids as string[])];
  }

  if (isUUID(b.group_id)) {
    const { data: memberships, error: membershipsError } = await db
      .from("tutor_group_memberships")
      .select("tutor_student_id")
      .eq("tutor_id", tutorId)
      .eq("tutor_group_id", b.group_id)
      .eq("is_active", true);

    if (membershipsError) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load group members");
    }

    const tutorStudentIds = (memberships ?? []).map((m) => m.tutor_student_id as string);
    if (tutorStudentIds.length > 0) {
      const { data: mappedStudents, error: mapError } = await db
        .from("tutor_students")
        .select("id, student_id")
        .eq("tutor_id", tutorId)
        .in("id", tutorStudentIds);
      if (mapError) {
        return jsonError(cors, 500, "DB_ERROR", "Failed to resolve group students");
      }
      studentIds = [...new Set([
        ...studentIds,
        ...(mappedStudents ?? []).map((m) => m.student_id as string),
      ])];
    }
  }

  if (studentIds.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Provide student_ids or group_id with members");
  }

  const { data: tutorStudents } = await db
    .from("tutor_students")
    .select("student_id")
    .eq("tutor_id", tutorId)
    .in("student_id", studentIds);

  const validStudentIds = new Set((tutorStudents ?? []).map((ts) => ts.student_id));
  const invalidIds = studentIds.filter((id) => !validStudentIds.has(id));

  if (invalidIds.length > 0) {
    return jsonError(cors, 403, "INVALID_STUDENTS", "Some student_ids are not your students", {
      invalid_student_ids: invalidIds,
    });
  }

  let studentsWithoutTelegram: string[] = [];
  let studentsWithoutTelegramNames: string[] = [];
  // Онбординг v2 (T3) — гейт «Подключить».
  let studentsWithoutChannel: string[] = [];
  let studentsWithoutChannelNames: string[] = [];

  const { data: studentProfiles, error: studentProfilesError } = await db
    .from("profiles")
    .select("id, username, telegram_username, telegram_user_id")
    .in("id", studentIds);

  if (studentProfilesError) {
    console.warn("homework_api_student_profile_lookup_failed", {
      route: "POST /assignments/:id/assign",
      assignment_id: assignmentId,
      error: studentProfilesError.message,
    });
  } else {
    const profileById = new Map((studentProfiles ?? []).map((p) => [p.id as string, p]));
    studentsWithoutTelegram = studentIds.filter((sid) => {
      const profile = profileById.get(sid);
      return !profile?.telegram_user_id;
    });
    studentsWithoutTelegramNames = studentsWithoutTelegram.map((sid) =>
      onboardingStudentName(profileById.get(sid), sid),
    );
    const withoutChannel = await computeStudentsWithoutChannel(db, tutorId, studentIds, profileById);
    studentsWithoutChannel = withoutChannel.ids;
    studentsWithoutChannelNames = withoutChannel.names;
  }

  const rows = studentIds.map((sid) => ({
    assignment_id: assignmentId,
    student_id: sid,
  }));

  if (isUUID(b.group_id)) {
    await db
      .from("homework_tutor_assignments")
      .update({ group_id: b.group_id })
      .eq("id", assignmentId);
  }

  const { data: upserted, error } = await db
    .from("homework_tutor_student_assignments")
    .upsert(rows, { onConflict: "assignment_id,student_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("homework_api_request_error", { route: "POST /assignments/:id/assign", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to assign students");
  }

  // Provision guided threads eagerly for newly assigned students
  if (upserted && upserted.length > 0) {
    for (const sa of upserted as { id: string }[]) {
      await provisionGuidedThread(db, assignmentId, sa.id);
    }
  }

  let assignmentStatus = String(assignment.status ?? "draft");
  if (assignmentStatus === "draft") {
    const { data: updatedAssignment, error: statusUpdateError } = await db
      .from("homework_tutor_assignments")
      .update({ status: "active" })
      .eq("id", assignmentId)
      .eq("status", "draft")
      .select("status")
      .maybeSingle();

    if (statusUpdateError) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/assign",
        assignment_id: assignmentId,
        error: statusUpdateError.message,
      });
      return jsonError(cors, 500, "DB_ERROR", "Failed to activate assignment after assign");
    }

    if (updatedAssignment?.status) {
      assignmentStatus = updatedAssignment.status as string;
    }
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments/:id/assign",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    added: (upserted ?? []).length,
    assignment_status_after_assign: assignmentStatus,
  });

  if ((upserted ?? []).length > 0) {
    await logAnalyticsEvent(db, {
      event_name: "homework_sent_to_student",
      tutor_id: tutorId,
      actor_user_id: tutorUserId,
      assignment_id: assignmentId,
      source: "assign",
      meta: { added: (upserted ?? []).length, without_channel: studentsWithoutChannel.length },
    });
  }

  return jsonOk(cors, {
    added: (upserted ?? []).length,
    assignment_status: assignmentStatus,
    assigned_group_id: isUUID(b.group_id) ? b.group_id : null,
    students_without_telegram: studentsWithoutTelegram,
    students_without_telegram_names: studentsWithoutTelegramNames,
    students_without_channel: studentsWithoutChannel,
    students_without_channel_names: studentsWithoutChannelNames,
  });
}

// ─── Endpoint: POST /assignments/:id/assign-students (quick add + notify) ────
//
// Single-shot add для UX «+ Добавить учеников» в шапке TutorHomeworkDetail.
// Mirror mock-exam-tutor-api::handleAssignStudents (см. .claude/rules/40-homework-system.md):
//  - Ownership через getOwnedAssignmentOrThrow
//  - Idempotent skip уже-assigned (newStudentIds = requested - existing)
//  - Eager guided thread provisioning для новых
//  - Activate draft → active если первый assign
//  - Cascade notify per new student (push → telegram, БЕЗ email — mirror моков)
//
// Отличается от существующего POST /assignments/:id/assign:
//  - notify cascade встроен (single round-trip для frontend)
//  - НЕ принимает group_id (HWAssignSection резолвит группы client-side
//    и присылает плоский student_ids[])
//  - Возвращает counters {push, telegram, failed_no_channel} вместо
//    students_without_telegram_names (детальная UI-логика остаётся
//    у /assign + /notify edit-flow)
//
// Status gates: ОТСУТСТВУЮТ (Vladimir UX choice — разрешаем на любом
// status, mirror моков). Drafts/active/archived все допустимы.

interface QuickAssignCascadeResult {
  channel: "push" | "telegram" | null;
  failed_reason: string | null;
}

async function notifyHomeworkStudentAssigned(
  db: SupabaseClient,
  studentId: string,
  assignmentId: string,
  assignmentTitle: string,
  subject: string,
  deadline: string | null,
  tutorName: string | null,
): Promise<QuickAssignCascadeResult> {
  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
    "https://sokratai.ru";
  const url = `${appUrl}/homework/${assignmentId}`;
  const deadlineHint = deadline
    ? ` Дедлайн: ${new Date(deadline).toLocaleDateString("ru-RU")}.`
    : "";
  const tutorHint = tutorName ? `${tutorName} назначил` : "Тебе назначили";
  const pushPayload: PushPayload = {
    title: `Новое ДЗ: ${assignmentTitle}`,
    body: `${tutorHint} домашнее задание по ${subject}.${deadlineHint}`,
    url,
  };

  // 1) Push
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    const { data: subs } = await db
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", studentId);
    for (const sub of (subs ?? []) as PushSubscriptionData[]) {
      try {
        const result = await sendPushNotification(
          sub,
          pushPayload,
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY,
          VAPID_SUBJECT,
        );
        if (result.success) {
          return { channel: "push", failed_reason: null };
        }
      } catch (err) {
        console.warn("homework_assign_quick_push_send_error", {
          student_id: studentId,
          error: String(err),
        });
      }
    }
  }

  // 2) Telegram fallback
  if (TELEGRAM_BOT_TOKEN) {
    const { data: profile } = await db
      .from("profiles")
      .select("telegram_user_id")
      .eq("id", studentId)
      .maybeSingle();
    let chatId = (profile?.telegram_user_id as number | null) ?? null;
    if (!chatId) {
      const { data: session } = await db
        .from("telegram_sessions")
        .select("telegram_user_id")
        .eq("user_id", studentId)
        .maybeSingle();
      chatId = (session?.telegram_user_id as number | null) ?? null;
    }
    if (chatId) {
      try {
        const text =
          `📚 Новое домашнее задание: <b>${escapeHtmlEntities(assignmentTitle)}</b>\n` +
          `Предмет: ${escapeHtmlEntities(subject)}` +
          (deadline
            ? `\nДедлайн: ${new Date(deadline).toLocaleDateString("ru-RU")}`
            : "") +
          `\n\n<a href="${escapeHtmlEntities(url)}">Открыть ДЗ</a>`;
        const tgResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              disable_web_page_preview: false,
            }),
          },
        );
        if (tgResp.ok) {
          return { channel: "telegram", failed_reason: null };
        }
      } catch (err) {
        console.warn("homework_assign_quick_telegram_send_error", {
          student_id: studentId,
          error: String(err),
        });
      }
    }
  }

  // 3) Email — out of scope (Vladimir UX choice mirror моков).
  return { channel: null, failed_reason: "no_channels_available" };
}

// ─── Phase 12 (2026-06-07): уведомление об общем комментарии к ДЗ ─────────────
//
// Каскад push → telegram (БЕЗ email, mirror notifyHomeworkStudentAssigned /
// quick-add). Вызывается из handleSetStudentOverallComment когда репетитор
// сохраняет НОВЫЙ/ИЗМЕНЁННЫЙ непустой комментарий. Репетитор часто комментирует
// уже ПОСЛЕ завершения ДЗ учеником → без пуша ученик может не увидеть.
async function notifyHomeworkOverallComment(
  db: SupabaseClient,
  studentId: string,
  assignmentId: string,
  assignmentTitle: string,
  commentText: string,
  tutorName: string | null,
): Promise<QuickAssignCascadeResult> {
  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
    "https://sokratai.ru";
  const url = `${appUrl}/homework/${assignmentId}`;
  const who = tutorName && tutorName.trim().length > 0 ? tutorName.trim() : "Репетитор";
  // Push body — короткий сниппет (длинный комментарий не влезет в баннер).
  const snippet = commentText.length > 160 ? `${commentText.slice(0, 157)}…` : commentText;
  const pushPayload: PushPayload = {
    title: `Комментарий к ДЗ: ${assignmentTitle}`,
    body: `${who}: ${snippet}`,
    url,
  };

  // 1) Push
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    const { data: subs } = await db
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", studentId);
    for (const sub of (subs ?? []) as PushSubscriptionData[]) {
      try {
        const result = await sendPushNotification(
          sub,
          pushPayload,
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY,
          VAPID_SUBJECT,
        );
        if (result.success) {
          return { channel: "push", failed_reason: null };
        }
      } catch (err) {
        console.warn("homework_overall_comment_push_send_error", {
          student_id: studentId,
          error: String(err),
        });
      }
    }
  }

  // 2) Telegram fallback — полный текст комментария + ссылка.
  if (TELEGRAM_BOT_TOKEN) {
    const { data: profile } = await db
      .from("profiles")
      .select("telegram_user_id")
      .eq("id", studentId)
      .maybeSingle();
    let chatId = (profile?.telegram_user_id as number | null) ?? null;
    if (!chatId) {
      const { data: session } = await db
        .from("telegram_sessions")
        .select("telegram_user_id")
        .eq("user_id", studentId)
        .maybeSingle();
      chatId = (session?.telegram_user_id as number | null) ?? null;
    }
    if (chatId) {
      try {
        const text =
          `💬 ${escapeHtmlEntities(who)} оставил(а) комментарий к ДЗ <b>${escapeHtmlEntities(assignmentTitle)}</b>\n\n` +
          `${escapeHtmlEntities(commentText)}\n\n` +
          `<a href="${escapeHtmlEntities(url)}">Открыть ДЗ</a>`;
        const tgResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              disable_web_page_preview: false,
            }),
          },
        );
        if (tgResp.ok) {
          return { channel: "telegram", failed_reason: null };
        }
      } catch (err) {
        console.warn("homework_overall_comment_telegram_send_error", {
          student_id: studentId,
          error: String(err),
        });
      }
    }
  }

  // Email — намеренно не используем (mirror push→telegram quick-add).
  return { channel: null, failed_reason: "no_channels_available" };
}

async function handleQuickAssignStudentsWithNotify(
  db: SupabaseClient,
  tutorUserId: string,
  tutorId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(
    db,
    assignmentId,
    tutorUserId,
    cors,
  );
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.student_ids) || b.student_ids.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids must be non-empty array");
  }
  const requestedIds = Array.from(new Set(b.student_ids as string[]));
  const invalidIds = requestedIds.filter((id) => !isUUID(id));
  if (invalidIds.length > 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids must be UUIDs", {
      invalid_student_ids: invalidIds,
    });
  }
  if (requestedIds.length > 100) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      "Cannot assign more than 100 students at once",
    );
  }
  const notify = b.notify === true || b.notify === undefined; // default true

  // Whitelist: all student_ids must be tutor's own students.
  const { data: tutorStudents, error: tutorStudentsError } = await db
    .from("tutor_students")
    .select("student_id")
    .eq("tutor_id", tutorId)
    .in("student_id", requestedIds);
  if (tutorStudentsError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/assign-students",
      assignment_id: assignmentId,
      error: tutorStudentsError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to validate students");
  }
  const validIds = new Set(
    (tutorStudents ?? []).map((r) => r.student_id as string),
  );
  const notMine = requestedIds.filter((id) => !validIds.has(id));
  if (notMine.length > 0) {
    return jsonError(
      cors,
      403,
      "INVALID_STUDENTS",
      "Some student_ids are not your students",
      { invalid_student_ids: notMine },
    );
  }

  // Idempotent skip: filter out already-assigned.
  const { data: existing, error: existingErr } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id")
    .eq("assignment_id", assignmentId)
    .in("student_id", requestedIds);
  if (existingErr) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/assign-students",
      assignment_id: assignmentId,
      error: existingErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load existing assignments");
  }
  const existingIds = new Set(
    (existing ?? []).map((r) => r.student_id as string),
  );
  const newStudentIds = requestedIds.filter((id) => !existingIds.has(id));
  const skippedExisting = requestedIds.length - newStudentIds.length;

  if (newStudentIds.length === 0) {
    return jsonOk(cors, {
      added: 0,
      skipped_existing: skippedExisting,
      assignment_status: assignment.status,
      notify: { sent_push: 0, sent_telegram: 0, failed: 0, failed_no_channel: 0 },
    });
  }

  // Insert new rows + provision threads + activate draft.
  const rows = newStudentIds.map((sid) => ({
    assignment_id: assignmentId,
    student_id: sid,
  }));
  const { data: inserted, error: insertErr } = await db
    .from("homework_tutor_student_assignments")
    .upsert(rows, { onConflict: "assignment_id,student_id", ignoreDuplicates: true })
    .select("id, student_id");
  if (insertErr) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/assign-students",
      assignment_id: assignmentId,
      error: insertErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to assign students");
  }

  // Provision guided threads for the newly inserted rows.
  if (inserted && inserted.length > 0) {
    for (const sa of inserted as { id: string }[]) {
      await provisionGuidedThread(db, assignmentId, sa.id);
    }
  }

  // Activate draft → active (mirror existing /assign flow).
  let assignmentStatus = String(assignment.status ?? "draft");
  if (assignmentStatus === "draft") {
    const { data: updated, error: statusErr } = await db
      .from("homework_tutor_assignments")
      .update({ status: "active" })
      .eq("id", assignmentId)
      .eq("status", "draft")
      .select("status")
      .maybeSingle();
    if (statusErr) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/assign-students",
        assignment_id: assignmentId,
        error: statusErr.message,
      });
      // Non-fatal — students уже добавлены, статус подтянется при следующем edit.
    } else if (updated?.status) {
      assignmentStatus = updated.status as string;
    }
  }

  // Cascade notify per new student (parallel, best-effort).
  let sentPush = 0;
  let sentTelegram = 0;
  let failed = 0;
  let failedNoChannel = 0;

  if (notify) {
    const { data: tutorRow } = await db
      .from("tutors")
      .select("name")
      .eq("user_id", tutorUserId)
      .maybeSingle();
    const tutorName = (tutorRow?.name as string | null) ?? null;
    const assignmentTitle = assignment.title as string;
    const subject = assignment.subject as string;
    const deadlineStr = (assignment.deadline as string | null) ?? null;

    const results = await Promise.all(
      newStudentIds.map((sid) =>
        notifyHomeworkStudentAssigned(
          db,
          sid,
          assignmentId,
          assignmentTitle,
          subject,
          deadlineStr,
          tutorName,
        ).catch((err): QuickAssignCascadeResult => {
          console.warn("homework_assign_quick_notify_student_failed", {
            student_id: sid,
            error: String(err),
          });
          return { channel: null, failed_reason: "exception" };
        })
      ),
    );

    for (const r of results) {
      if (r.channel === "push") sentPush += 1;
      else if (r.channel === "telegram") sentTelegram += 1;
      else if (r.failed_reason === "no_channels_available") failedNoChannel += 1;
      else failed += 1;
    }
  }

  // Онбординг v2 (T3) — гейт «Подключить» для новых учеников без канала.
  let studentsWithoutChannel: string[] = [];
  let studentsWithoutChannelNames: string[] = [];
  {
    const { data: newProfiles } = await db
      .from("profiles")
      .select("id, username, telegram_username, telegram_user_id")
      .in("id", newStudentIds);
    const profileById = new Map((newProfiles ?? []).map((p) => [p.id as string, p]));
    const wc = await computeStudentsWithoutChannel(db, tutorId, newStudentIds, profileById);
    studentsWithoutChannel = wc.ids;
    studentsWithoutChannelNames = wc.names;
  }

  console.info("homework_assign_students_quick_completed", {
    assignment_id: assignmentId,
    requested: requestedIds.length,
    added: newStudentIds.length,
    skipped_existing: skippedExisting,
    assignment_status_after: assignmentStatus,
    notify,
    sent_push: sentPush,
    sent_telegram: sentTelegram,
    failed,
    failed_no_channel: failedNoChannel,
  });

  if (newStudentIds.length > 0) {
    await logAnalyticsEvent(db, {
      event_name: "homework_sent_to_student",
      tutor_id: tutorId,
      actor_user_id: tutorUserId,
      assignment_id: assignmentId,
      source: "quick_assign",
      meta: { added: newStudentIds.length, without_channel: studentsWithoutChannel.length },
    });
  }

  return jsonOk(cors, {
    added: newStudentIds.length,
    skipped_existing: skippedExisting,
    assignment_status: assignmentStatus,
    notify: {
      sent_push: sentPush,
      sent_telegram: sentTelegram,
      failed,
      failed_no_channel: failedNoChannel,
    },
    students_without_channel: studentsWithoutChannel,
    students_without_channel_names: studentsWithoutChannelNames,
  });
}

// ─── Endpoint: POST /assignments/:id/connect-student-email (онбординг v2 T3) ──
//
// Гейт «Подключить» → «Отправить на email»: захватывает email как канал
// (admin.updateUserById, email_confirm:true — без верификации) + шлёт письмо с
// claim-ссылкой и названием ДЗ через наш RU-safe пайплайн. Telegram-доставку
// не делаем (бот не пишет первым без привязки) — фронт даёт deep-link/копировать.
async function handleConnectStudentByEmail(
  db: SupabaseClient,
  tutorUserId: string,
  tutorId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const studentId = typeof b.student_id === "string" ? b.student_id.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "student_id должен быть UUID");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@temp.sokratai.ru")) {
    return jsonError(cors, 400, "INVALID_EMAIL", "Укажите корректный email ученика.");
  }

  // Ownership: ученик принадлежит репетитору (tutor_students.tutor_id → tutors.id).
  const { data: link, error: linkErr } = await db
    .from("tutor_students")
    .select("id, claim_token")
    .eq("tutor_id", tutorId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (linkErr) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось проверить ученика. Попробуйте ещё раз.");
  }
  if (!link) {
    return jsonError(cors, 403, "INVALID_STUDENT", "Это не ваш ученик.");
  }

  // Review P1 #6: ученик должен быть назначен на ЭТО ДЗ (иначе письмо ссылается
  // на задание, которое ему не выдано, а preview ведёт на другое/пустое).
  const { data: saLink, error: saErr } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (saErr) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось проверить назначение. Попробуйте ещё раз.");
  }
  if (!saLink) {
    return jsonError(cors, 400, "STUDENT_NOT_ASSIGNED", "Сначала назначьте это ДЗ ученику, затем подключайте.");
  }

  // P0 (review round 2, defense-in-depth): connect-email — тоже token-gen путь
  // + смена email. НЕ трогать уже заходивший аккаунт (last_sign_in_at) — иначе
  // репетитор мог бы сменить email зарегистрированному ученику + сгенерить claim
  // (impersonation). UI и так не показывает гейт активным, но API-путь закрываем.
  // ⚠ НАМЕРЕННО строже гейта «зарегистрирован» из student-claim/RPC (2026-07-20,
  // №43): этот хендлер СТАВИТ реальный email и шлёт письмо с claim-ссылкой —
  // для заходившего ученика такая ссылка сразу упёрлась бы в registered-гейт
  // student-claim (реальный email + вход) = мёртвая ссылка в письме. Заходивший
  // незарегистрированный подключается многоразовым КОДОМ (ConnectStudentSheet).
  const { data: connAuthU, error: connAuthErr } = await db.auth.admin.getUserById(studentId);
  if (connAuthErr || !connAuthU?.user) {
    // Auth-gate → fail-closed (review round-3 P2): не менять email вслепую при сбое.
    return jsonError(cors, 503, "ACCOUNT_LOOKUP_FAILED", "Не удалось проверить ученика. Попробуйте ещё раз через минуту.");
  }
  if (connAuthU.user.last_sign_in_at) {
    return jsonError(cors, 409, "STUDENT_ALREADY_ACTIVE", "Ученик уже заходил в Сократ — отправь ему код для входа (кнопка «Подключить» на карточке ученика).");
  }

  // Collision: email уже у другого аккаунта.
  const { data: foundId, error: lookupErr } = await db.rpc("find_auth_user_id_by_email", {
    p_email: email,
  });
  if (lookupErr) {
    return jsonError(cors, 503, "EMAIL_LOOKUP_FAILED", "Не удалось проверить email. Попробуйте ещё раз через минуту.");
  }
  if (foundId && foundId !== studentId) {
    return jsonError(cors, 409, "EMAIL_TAKEN", "Этот email уже занят другим аккаунтом. Используйте другой.");
  }

  // Захват канала: ставим реальный email плейсхолдеру (без верификации).
  const { error: updErr } = await db.auth.admin.updateUserById(studentId, {
    email,
    email_confirm: true,
  });
  if (updErr) {
    const taken = (updErr as { code?: string })?.code === "email_exists" ||
      updErr.message?.includes("already been registered");
    if (taken) {
      return jsonError(cors, 409, "EMAIL_TAKEN", "Этот email уже занят другим аккаунтом. Используйте другой.");
    }
    console.error(JSON.stringify({ event: "connect_email_update_failed", error: updErr.message }));
    return jsonError(cors, 500, "UPDATE_FAILED", "Не удалось сохранить email. Попробуйте ещё раз.");
  }

  // Claim-токен (генерим-если-NULL; с 2026-07-20 МНОГОРАЗОВЫЙ до регистрации —
  // rule 96; legacy 32-hex формат здесь валиден, student-claim принимает оба).
  let token = (link.claim_token as string | null) ?? null;
  let generated = false;
  if (!token) {
    const newToken = crypto.randomUUID().replace(/-/g, "");
    const { data: upd } = await db
      .from("tutor_students")
      .update({ claim_token: newToken, claim_token_created_at: new Date().toISOString() })
      .eq("id", link.id)
      .is("claim_token", null)
      .select("claim_token")
      .maybeSingle();
    if (upd?.claim_token) {
      token = upd.claim_token as string;
      generated = true;
    } else {
      // гонка — перечитать
      const { data: re } = await db
        .from("tutor_students")
        .select("claim_token")
        .eq("id", link.id)
        .maybeSingle();
      token = (re?.claim_token as string | null) ?? null;
    }
  }
  if (!token) {
    return jsonError(cors, 500, "TOKEN_FAILED", "Не удалось подготовить ссылку. Попробуйте ещё раз.");
  }

  // Имя репетитора + отправка письма-приглашения с claim-ссылкой.
  const { data: tutorRow } = await db
    .from("tutors")
    .select("name")
    .eq("id", tutorId)
    .maybeSingle();
  const claimUrl = `${SUPABASE_PROXY_URL}/functions/v1/student-claim?t=${token}`;
  const emailResult = await sendStudentInviteEmail(db, email, {
    tutorName: (tutorRow?.name as string | null) ?? null,
    claimUrl,
    homeworkTitle: (assignment.title as string | null) ?? null,
  });

  if (generated) {
    await logAnalyticsEvent(db, {
      event_name: "invite_generated",
      tutor_id: tutorId,
      actor_user_id: tutorUserId,
      student_id: studentId,
      tutor_student_id: link.id as string,
      assignment_id: assignmentId,
      source: "email",
    });
  }
  await logAnalyticsEvent(db, {
    event_name: "homework_sent_to_student",
    tutor_id: tutorId,
    actor_user_id: tutorUserId,
    student_id: studentId,
    tutor_student_id: link.id as string,
    assignment_id: assignmentId,
    source: "connect_email",
    meta: { email_enqueued: emailResult.success },
  });

  return jsonOk(cors, { ok: true, email_enqueued: emailResult.success });
}

// ─── Endpoint: POST /assignments/:id/notify ──────────────────────────────────

async function handleNotifyStudents(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const messageTemplate = isNonEmptyString(b.message_template)
    ? (b.message_template as string).trim()
    : null;
  let requestedStudentIds: string[] | null = null;
  if (b.student_ids !== undefined) {
    if (!Array.isArray(b.student_ids)) {
      return jsonError(cors, 400, "VALIDATION", "student_ids must be an array of UUIDs");
    }
    const invalidStudentIds = b.student_ids.filter((studentId) => !isUUID(studentId));
    if (invalidStudentIds.length > 0) {
      return jsonError(cors, 400, "VALIDATION", "student_ids must be an array of UUIDs", {
        invalid_student_ids: invalidStudentIds,
      });
    }
    requestedStudentIds = Array.from(new Set(b.student_ids as string[]));
  }

  const { data: studentAssignments, error: studentAssignmentsError } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id, notified")
    .eq("assignment_id", assignmentId);

  if (studentAssignmentsError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/notify",
      assignment_id: assignmentId,
      error: studentAssignmentsError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load assigned students");
  }

  const assignedStudentIds = new Set(
    (studentAssignments ?? []).map((studentAssignment) => studentAssignment.student_id as string),
  );

  if (requestedStudentIds) {
    const invalidStudentIds = requestedStudentIds.filter((studentId) => !assignedStudentIds.has(studentId));
    if (invalidStudentIds.length > 0) {
      return jsonError(
        cors,
        400,
        "INVALID_STUDENTS",
        "Some student_ids are not assigned to this homework",
        { invalid_student_ids: invalidStudentIds },
      );
    }
  }

  const requestedStudentIdSet = requestedStudentIds ? new Set(requestedStudentIds) : null;
  const pendingStudents = (studentAssignments ?? []).filter((studentAssignment) => {
    if (studentAssignment.notified) return false;
    if (!requestedStudentIdSet) return true;
    return requestedStudentIdSet.has(studentAssignment.student_id as string);
  });

  if (!pendingStudents || pendingStudents.length === 0) {
    return jsonOk(cors, { sent: 0, failed: 0, failed_student_ids: [], failed_by_reason: {} });
  }

  const studentIds = pendingStudents.map((s) => s.student_id);

  // ─── Resolve all delivery channels ──────────────────────────────────────────

  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, telegram_user_id")
    .in("id", studentIds);

  if (profilesError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/notify",
      assignment_id: assignmentId,
      error: profilesError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve students telegram links");
  }

  const { data: sessions, error: sessionsError } = await db
    .from("telegram_sessions")
    .select("user_id, telegram_user_id")
    .in("user_id", studentIds);

  if (sessionsError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/notify",
      assignment_id: assignmentId,
      error: sessionsError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve telegram sessions");
  }

  // Service-role client for push_subscriptions (RLS limits to own user)
  const dbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: pushSubs, error: pushSubsError } = await dbService
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", studentIds);

  if (pushSubsError) {
    console.error("homework_notify_push_subs_query_error", {
      assignment_id: assignmentId,
      error: pushSubsError.message,
    });
    // Continue without push — cascade to telegram/email
  }

  // Build lookup maps
  const profileTgMap: Record<string, number> = {};
  for (const p of profiles ?? []) {
    if (p.telegram_user_id) {
      profileTgMap[p.id] = p.telegram_user_id;
    }
  }

  // Fetch emails from auth.users (profiles table has no email column)
  const emailMap: Record<string, string> = {};
  for (const sid of studentIds) {
    try {
      const { data } = await dbService.auth.admin.getUserById(sid);
      if (data?.user?.email && !data.user.email.endsWith("@temp.sokratai.ru")) {
        emailMap[sid] = data.user.email;
      }
    } catch {
      // Skip — student won't get email fallback
    }
  }

  const sessionTgMap: Record<string, number> = {};
  for (const s of sessions ?? []) {
    if (s.telegram_user_id) {
      sessionTgMap[s.user_id] = s.telegram_user_id;
    }
  }

  const pushSubsMap: Record<string, PushSubscriptionData[]> = {};
  for (const sub of pushSubs ?? []) {
    const uid = sub.user_id as string;
    if (!pushSubsMap[uid]) pushSubsMap[uid] = [];
    pushSubsMap[uid].push({
      endpoint: sub.endpoint as string,
      p256dh: sub.p256dh as string,
      auth: sub.auth as string,
    });
  }

  // Fetch tutor name for email template
  const { data: tutorProfile } = await dbService
    .from("profiles")
    .select("display_name")
    .eq("id", tutorUserId)
    .single();
  const tutorName = (tutorProfile?.display_name as string) || "Репетитор";

  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ?? "https://sokratai.ru";
  const homeworkUrl = `${appUrl}/homework/${assignmentId}`;
  const defaultMessage = `📚 Новое домашнее задание: <b>${escapeHtmlEntities(assignment.title as string)}</b>\n\nПредмет: ${escapeHtmlEntities(assignment.subject as string)}\n<a href="${escapeHtmlEntities(homeworkUrl)}">Открыть ДЗ</a>`;
  const tgText = messageTemplate ?? defaultMessage;

  const pushPayload: PushPayload = {
    title: `Новое ДЗ: ${assignment.title as string}`,
    body: `Новое задание по ${assignment.subject as string}`,
    url: homeworkUrl,
  };

  // ─── Cascade delivery per student ───────────────────────────────────────────

  let sent = 0;
  let failed = 0;
  const sentByChannel = { push: 0, telegram: 0, email: 0 };
  const deliveredStudents: { sid: string; status: string; channel: string }[] = [];
  const failedStudentIds: string[] = [];
  const failedByReason: Record<string, NotifyFailureReason> = {};

  for (const sid of studentIds) {
    let hasPush = (pushSubsMap[sid]?.length ?? 0) > 0;
    const chatId = profileTgMap[sid] ?? sessionTgMap[sid];
    const hasTelegram = Boolean(chatId);
    const hasEmail = Boolean(emailMap[sid]);

    console.log("homework_assignment_delivery_diagnostics", {
      assignment_id: assignmentId,
      student_id: sid,
      has_push: hasPush,
      has_telegram: hasTelegram,
      has_email: hasEmail,
    });

    let delivered = false;
    let deliveryChannel: string | null = null;
    let deliveryStatus: string | null = null;
    let lastFailedReason: NotifyFailureReason | null = null;

    // ── Step 1: Try Push ──────────────────────────────────────────────────────
    if (hasPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const subs = pushSubsMap[sid];
      let allGone = true;
      for (const sub of subs) {
        let pushResult = await sendPushNotification(sub, pushPayload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);

        if (pushResult.success) {
          delivered = true;
          deliveryChannel = "push";
          deliveryStatus = "delivered_push";
          allGone = false;
          console.log("homework_notify_push_ok", { assignment_id: assignmentId, student_id: sid });
          break;
        }

        if (pushResult.gone) {
          // 410 Gone — subscription expired, clean up
          console.warn("homework_notify_push_gone", { assignment_id: assignmentId, student_id: sid, endpoint: sub.endpoint });
          await dbService.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", sid);
          continue;
        }

        allGone = false;
        // 5xx — retry once
        if (pushResult.status >= 500) {
          console.warn("homework_notify_push_retry", { assignment_id: assignmentId, student_id: sid, status: pushResult.status });
          pushResult = await sendPushNotification(sub, pushPayload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
          if (pushResult.success) {
            delivered = true;
            deliveryChannel = "push";
            deliveryStatus = "delivered_push";
            console.log("homework_notify_push_ok_retry", { assignment_id: assignmentId, student_id: sid });
            break;
          }
          if (pushResult.gone) {
            await dbService.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", sid);
          }
        }
        // Try next subscription
      }
      if (!delivered) {
        lastFailedReason = allGone ? "push_expired" : "push_send_failed";
        // If all subscriptions expired, this student effectively has no push channel
        if (allGone) hasPush = false;
      }
    }

    // ── Step 2: Try Telegram (preserved existing logic) ───────────────────────
    if (!delivered && hasTelegram) {
      try {
        const payload: Record<string, unknown> = {
          chat_id: chatId,
          text: tgText,
        };
        if (!messageTemplate) {
          payload.parse_mode = "HTML";
        }

        let lastResp: Response | null = null;
        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          lastResp = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
          );
          if (lastResp.ok) break;

          const status = lastResp.status;
          // Retry only on transient errors (429 rate limit, 5xx server errors)
          if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
            console.warn("homework_notify_telegram_retry", {
              assignment_id: assignmentId,
              student_id: sid,
              attempt: attempt + 1,
              status,
            });
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          break;
        }

        if (lastResp?.ok) {
          delivered = true;
          deliveryChannel = "telegram";
          deliveryStatus = "delivered_telegram";
          console.log("homework_notify_telegram_ok", { assignment_id: assignmentId, student_id: sid });
        } else {
          const errBody = await lastResp?.text().catch(() => "unknown");
          console.error("homework_api_telegram_send_failed", {
            assignment_id: assignmentId,
            student_id: sid,
            chat_id: chatId,
            status: lastResp?.status,
            error: errBody,
          });
        }
        if (!delivered) lastFailedReason = "telegram_send_failed";
      } catch (err) {
        console.error("homework_api_telegram_send_error", {
          assignment_id: assignmentId,
          student_id: sid,
          error: String(err),
        });
        lastFailedReason = "telegram_send_error";
      }
    }

    // ── Step 3: Try Email ─────────────────────────────────────────────────────
    if (!delivered && hasEmail) {
      try {
        const emailResult = await sendHomeworkNotificationEmail(
          dbService,
          emailMap[sid],
          {
            tutorName,
            assignmentTitle: assignment.title as string,
            subject: assignment.subject as string,
            deadline: (assignment.deadline as string) ?? null,
            homeworkUrl: homeworkUrl ?? `https://sokratai.lovable.app/homework/${assignmentId}`,
          },
          assignmentId,
        );

        if (emailResult.success && !emailResult.skipped) {
          delivered = true;
          deliveryChannel = "email";
          deliveryStatus = "delivered_email";
          console.log("homework_notify_email_ok", { assignment_id: assignmentId, student_id: sid });
        } else if (emailResult.skipped) {
          console.log("homework_notify_email_skipped", { assignment_id: assignmentId, student_id: sid, reason: emailResult.skipped });
        } else {
          console.error("homework_notify_email_failed", { assignment_id: assignmentId, student_id: sid, error: emailResult.error });
        }
      } catch (err) {
        console.error("homework_notify_email_error", { assignment_id: assignmentId, student_id: sid, error: String(err) });
      }
      if (!delivered) lastFailedReason = "email_send_failed";
    }

    // ── Step 4: Record result ─────────────────────────────────────────────────
    if (delivered) {
      sent++;
      sentByChannel[deliveryChannel as keyof typeof sentByChannel]++;
      deliveredStudents.push({ sid, status: deliveryStatus!, channel: deliveryChannel! });
    } else {
      failed++;
      failedStudentIds.push(sid);
      if (!hasPush && !hasTelegram && !hasEmail) {
        failedByReason[sid] = "no_channels_available";
      } else {
        // Use the most specific reason from the last failed channel
        failedByReason[sid] = lastFailedReason ?? "all_channels_failed";
      }
      console.warn("homework_notify_student_failed", {
        assignment_id: assignmentId,
        student_id: sid,
        reason: failedByReason[sid],
        channels_tried: { push: hasPush, telegram: hasTelegram, email: hasEmail },
      });
    }
  }

  // ─── Update DB ────────────────────────────────────────────────────────────

  if (deliveredStudents.length > 0) {
    const now = new Date().toISOString();
    // Group by (status, channel) for batch update
    const groups: Record<string, string[]> = {};
    for (const s of deliveredStudents) {
      const key = `${s.status}|${s.channel}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s.sid);
    }
    for (const [key, sids] of Object.entries(groups)) {
      const [status, channel] = key.split("|");
      await db
        .from("homework_tutor_student_assignments")
        .update({ notified: true, notified_at: now, delivery_status: status, delivery_channel: channel, delivery_error_code: null })
        .eq("assignment_id", assignmentId)
        .in("student_id", sids);
    }
  }

  // Update failed students
  const noChannelStudents = failedStudentIds.filter((sid) => failedByReason[sid] === "no_channels_available");
  if (noChannelStudents.length > 0) {
    await db
      .from("homework_tutor_student_assignments")
      .update({ delivery_status: "failed_no_channel" })
      .eq("assignment_id", assignmentId)
      .in("student_id", noChannelStudents);
  }

  const allChannelsFailedStudents = failedStudentIds.filter((sid) => failedByReason[sid] !== "no_channels_available");
  if (allChannelsFailedStudents.length > 0) {
    await db
      .from("homework_tutor_student_assignments")
      .update({ delivery_status: "failed_all_channels" })
      .eq("assignment_id", assignmentId)
      .in("student_id", allChannelsFailedStudents);
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments/:id/notify",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    sent,
    failed,
    sent_by_channel: sentByChannel,
    failed_student_ids: failedStudentIds,
    failed_by_reason: failedByReason,
  });
  return jsonOk(cors, {
    sent,
    failed,
    sent_by_channel: sentByChannel,
    failed_student_ids: failedStudentIds,
    failed_by_reason: failedByReason,
  });
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Endpoint: POST /assignments/:id/students/:sid/remind ────────────────────
//
// Per-student re-engagement reminder used by Homework Results v2 action block
// (RemindStudentDialog). The tutor authors a free-text message and we deliver
// it via Telegram (preferred) or email-fallback (AC-7) in a single attempt.
//
// Differences vs. handleNotifyStudents:
//   - targets exactly one student (already in the assignment)
//   - tutor message is plain text (no HTML parse_mode)
//   - does NOT mutate notified / notified_at / delivery_status — this is a
//     re-engagement nudge, not initial delivery
//   - returns the resolved channel so the frontend can show a channel-specific
//     toast and emit telemetry without PII
//
// Body: { message: string } (1..2000 chars, trimmed)
// Response: { success, channel: 'telegram' | 'email', reason? }

const REMIND_MESSAGE_MIN_CHARS = 1;
const REMIND_MESSAGE_MAX_CHARS = 2000;

async function handleRemindStudent(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "studentId is not a valid UUID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  if (!isNonEmptyString(b.message)) {
    return jsonError(cors, 400, "VALIDATION", "message must be a non-empty string");
  }
  const message = (b.message as string).trim();
  if (message.length < REMIND_MESSAGE_MIN_CHARS) {
    return jsonError(cors, 400, "VALIDATION", "message is empty after trim");
  }
  if (message.length > REMIND_MESSAGE_MAX_CHARS) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `message must be at most ${REMIND_MESSAGE_MAX_CHARS} characters`,
    );
  }

  // Optional channel override. `'auto'` (default) = cascade telegram → email.
  // Explicit `'telegram'` / `'email'` forces that channel only — no fallback.
  const rawChannel = typeof b.channel === "string" ? b.channel : "auto";
  const channelPreference: "auto" | "telegram" | "email" =
    rawChannel === "telegram" || rawChannel === "email" ? rawChannel : "auto";

  // Confirm the student is actually assigned to this homework. Avoids
  // accidentally messaging students from other tutors via id-spoofing.
  const { data: studentAssignmentRow, error: saError } = await db
    .from("homework_tutor_student_assignments")
    .select("id, student_id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (saError) {
    console.error("homework_remind_student_sa_error", {
      assignment_id: assignmentId,
      student_id: studentId,
      error: saError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to validate student assignment");
  }
  if (!studentAssignmentRow) {
    return jsonError(cors, 404, "NOT_FOUND", "Student is not assigned to this homework");
  }

  // ── Resolve channels for this student ─────────────────────────────────────
  const dbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: studentProfile } = await db
    .from("profiles")
    .select("id, telegram_user_id")
    .eq("id", studentId)
    .maybeSingle();

  let chatId: number | null =
    studentProfile?.telegram_user_id != null
      ? (studentProfile.telegram_user_id as number)
      : null;

  if (chatId == null) {
    const { data: sessionRow } = await db
      .from("telegram_sessions")
      .select("telegram_user_id")
      .eq("user_id", studentId)
      .maybeSingle();
    if (sessionRow?.telegram_user_id != null) {
      chatId = sessionRow.telegram_user_id as number;
    }
  }

  let studentEmail: string | null = null;
  try {
    const { data } = await dbService.auth.admin.getUserById(studentId);
    if (data?.user?.email && !data.user.email.endsWith("@temp.sokratai.ru")) {
      studentEmail = data.user.email;
    }
  } catch {
    // ignore — student simply has no email fallback
  }

  if (chatId == null && !studentEmail) {
    console.warn("homework_remind_student_no_channel", {
      assignment_id: assignmentId,
      student_id: studentId,
    });
    return jsonError(
      cors,
      422,
      "NO_CHANNEL",
      "Student has neither a Telegram link nor a usable email",
    );
  }

  // Honor explicit channel preference: if the tutor picked a channel in the
  // dialog tab and it's unavailable, fail fast (no silent fallback — the UI
  // should never offer a tab for a channel that's unusable).
  if (channelPreference === "telegram" && chatId == null) {
    return jsonError(cors, 422, "NO_TELEGRAM", "Student has no Telegram link");
  }
  if (channelPreference === "email" && !studentEmail) {
    return jsonError(cors, 422, "NO_EMAIL", "Student has no usable email");
  }

  // ── Try Telegram first (skipped if tutor picked email explicitly) ────────
  if (chatId != null && channelPreference !== "email") {
    try {
      const appUrl =
        Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
        "https://sokratai.ru";
      const homeworkUrl = `${appUrl}/homework/${assignmentId}`;
      const textWithLink =
        `${escapeHtmlEntities(message)}\n\n<a href="${escapeHtmlEntities(homeworkUrl)}">Открыть ДЗ</a>`;

      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: textWithLink,
        parse_mode: "HTML",
      };

      let lastResp: Response | null = null;
      const maxAttempts = 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        lastResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (lastResp.ok) break;

        const status = lastResp.status;
        if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
          console.warn("homework_remind_student_telegram_retry", {
            assignment_id: assignmentId,
            student_id: studentId,
            attempt: attempt + 1,
            status,
          });
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        break;
      }

      if (lastResp?.ok) {
        console.log("homework_remind_student_ok", {
          assignment_id: assignmentId,
          student_id: studentId,
          channel: "telegram",
        });
        return jsonOk(cors, { success: true, channel: "telegram" });
      }

      const errBody = await lastResp?.text().catch(() => "unknown");
      console.error("homework_remind_student_telegram_failed", {
        assignment_id: assignmentId,
        student_id: studentId,
        status: lastResp?.status,
        error: errBody,
      });
      if (channelPreference === "telegram") {
        return jsonError(
          cors,
          502,
          "TELEGRAM_FAILED",
          "Failed to deliver via Telegram",
        );
      }
      // fall through to email fallback (auto cascade only)
    } catch (err) {
      console.error("homework_remind_student_telegram_error", {
        assignment_id: assignmentId,
        student_id: studentId,
        error: String(err),
      });
      if (channelPreference === "telegram") {
        return jsonError(
          cors,
          502,
          "TELEGRAM_FAILED",
          "Failed to deliver via Telegram",
        );
      }
      // fall through to email fallback (auto cascade only)
    }
  }

  // ── Email fallback ────────────────────────────────────────────────────────
  if (studentEmail) {
    // Resolve student/tutor display names for the email body. Falls back to
    // safe placeholders so we never leak raw uuids or block on missing rows.
    const { data: studentProfileForName } = await dbService
      .from("profiles")
      .select("display_name, username")
      .eq("id", studentId)
      .maybeSingle();
    const studentName =
      (studentProfileForName?.display_name as string) ||
      (studentProfileForName?.username as string) ||
      "Ученик";

    const { data: tutorProfile } = await dbService
      .from("profiles")
      .select("display_name")
      .eq("id", tutorUserId)
      .maybeSingle();
    const tutorName = (tutorProfile?.display_name as string) || "Репетитор";

    const appUrl =
      Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
      "https://sokratai.ru";
    const homeworkUrl = `${appUrl}/homework/${assignmentId}`;

    const emailResult = await sendHomeworkTutorMessageEmail(
      dbService,
      studentEmail,
      {
        tutorName,
        studentName,
        assignmentTitle: assignment.title as string,
        message,
        homeworkUrl,
      },
      assignmentId,
    );

    if (emailResult.success && !emailResult.skipped) {
      console.log("homework_remind_student_ok", {
        assignment_id: assignmentId,
        student_id: studentId,
        channel: "email",
      });
      return jsonOk(cors, { success: true, channel: "email" });
    }

    console.error("homework_remind_student_email_failed", {
      assignment_id: assignmentId,
      student_id: studentId,
      skipped: emailResult.skipped,
      error: emailResult.error,
    });
    return jsonError(
      cors,
      502,
      "EMAIL_FAILED",
      emailResult.skipped
        ? `Email skipped: ${emailResult.skipped}`
        : `Email send failed: ${emailResult.error ?? "unknown"}`,
    );
  }

  // Telegram failed AND no email available
  return jsonError(
    cors,
    502,
    "TELEGRAM_FAILED",
    "Failed to deliver via Telegram and no email fallback available",
  );
}

// ─── Endpoint: POST /assignments/:id/students/:sid/overall-comment ───────────
//
// Phase 12 (2026-06-07): репетитор оставляет общий комментарий ко всему ДЗ
// конкретному ученику (per-student wrap-up). Single write-path.
//
//   * Ownership через getOwnedAssignmentOrThrow + проверка, что ученик назначен
//     (anti id-spoofing, mirror handleRemindStudent).
//   * Пустой/пробельный comment → очистка (NULL).
//   * Anti-leak: comment + _at — student-visible by design; _by — audit-only.
//   * Notify push→telegram (БЕЗ email) ТОЛЬКО на непустой ИЗМЕНЁННЫЙ текст.
const OVERALL_COMMENT_MAX = 2000;

async function handleSetStudentOverallComment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "studentId не является валидным UUID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  // comment: string | null. Пусто/пробелы после trim → очистка (NULL).
  let comment: string | null = null;
  if (typeof b.comment === "string") {
    const trimmed = b.comment.trim();
    comment = trimmed.length === 0 ? null : trimmed;
  } else if (b.comment === null || b.comment === undefined) {
    comment = null;
  } else {
    return jsonError(cors, 400, "VALIDATION", "Поле «comment» должно быть строкой или null");
  }
  if (comment !== null && comment.length > OVERALL_COMMENT_MAX) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `Комментарий слишком длинный (максимум ${OVERALL_COMMENT_MAX} символов)`,
    );
  }

  // Confirm the student is actually assigned to this homework (anti id-spoofing).
  const { data: saRow, error: saError } = await db
    .from("homework_tutor_student_assignments")
    .select("id, tutor_overall_comment")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (saError) {
    console.error("homework_overall_comment_sa_error", {
      assignment_id: assignmentId,
      student_id: studentId,
      error: saError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось проверить, что ученик назначен на это ДЗ");
  }
  if (!saRow) {
    return jsonError(cors, 404, "NOT_FOUND", "Ученик не назначен на это ДЗ");
  }

  const previousComment = (saRow.tutor_overall_comment as string | null) ?? null;
  const nowIso = new Date().toISOString();

  const { error: updErr } = await db
    .from("homework_tutor_student_assignments")
    .update({
      tutor_overall_comment: comment,
      tutor_overall_comment_at: comment === null ? null : nowIso,
      tutor_overall_comment_by: comment === null ? null : tutorUserId,
    })
    .eq("id", saRow.id);

  if (updErr) {
    console.error("homework_overall_comment_update_error", {
      assignment_id: assignmentId,
      student_id: studentId,
      error: updErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить комментарий");
  }

  // Notify ТОЛЬКО на непустой ИЗМЕНЁННЫЙ текст (не пингуем на очистку /
  // повторное сохранение того же текста).
  let notify: { sent_push: boolean; sent_telegram: boolean; failed_no_channel: boolean } | null =
    null;
  const changed = comment !== null && comment !== previousComment;
  if (changed) {
    let tutorName: string | null = null;
    try {
      const { data: tutorProfile } = await db
        .from("profiles")
        .select("display_name")
        .eq("id", tutorUserId)
        .maybeSingle();
      tutorName = (tutorProfile?.display_name as string | null) ?? null;
    } catch {
      // non-fatal — уведомление уйдёт с «Репетитор»
    }

    const result = await notifyHomeworkOverallComment(
      db,
      studentId,
      assignmentId,
      assignment.title as string,
      comment,
      tutorName,
    );
    notify = {
      sent_push: result.channel === "push",
      sent_telegram: result.channel === "telegram",
      failed_no_channel: result.channel === null,
    };
  }

  // PII-free telemetry — без текста комментария и без имён.
  console.log("homework_overall_comment_saved", {
    assignment_id: assignmentId,
    student_id: studentId,
    cleared: comment === null,
    changed,
    notify_channel: notify
      ? (notify.sent_push ? "push" : notify.sent_telegram ? "telegram" : "none")
      : "skipped",
  });

  return jsonOk(cors, {
    ok: true,
    tutor_overall_comment: comment,
    tutor_overall_comment_at: comment === null ? null : nowIso,
    notify,
  });
}

// ─── Endpoint: GET /assignments/:id/results ──────────────────────────────────

async function handleGetResults(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, max_score")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  // Build taskMap for lookups by task_id
  const taskMap: Record<string, { order_num: number; task_text: string; max_score: number }> = {};
  for (const t of tasks ?? []) {
    taskMap[t.id] = { order_num: t.order_num, task_text: t.task_text, max_score: t.max_score };
  }

  // Sum of max_score across all tasks in the assignment (used as fallback
  // denominator when a student does not yet have any task_states).
  const assignmentMaxScoreTotal = (tasks ?? []).reduce(
    (sum, t) => sum + (t.max_score ?? 0),
    0,
  );

  // Hint overuse threshold per spec: ceil(tasks.length * 0.6).
  const hintOveruseThreshold = Math.max(1, Math.ceil((tasks?.length ?? 0) * 0.6));

  let totalScoreSum = 0;
  let totalScoreCount = 0;
  const distribution = { "0-24": 0, "25-49": 0, "50-74": 0, "75-100": 0 };

  // Guided chat: gather completed thread data for summary and perTask aggregates
  const guidedTaskScores: Record<string, { scoreSum: number; scoreCount: number; correctCount: number; total: number }> = {};

  const perStudent: {
    student_id: string;
    submitted: boolean;
    final_score_total: number;
    max_score_total: number;
    hint_total: number;
    needs_attention: boolean;
    task_scores: {
      task_id: string;
      final_score: number;
      hint_count: number;
      has_override: boolean;
      ai_score: number | null;
      ai_score_comment: string | null;
      tutor_score_override: number | null;
      tutor_score_override_comment: string | null;
      // 2026-05-16 (lexical-brewing-gadget): tutor force-complete marker.
      // Null = задача не была закрыта вручную (либо AI-CORRECT, либо ещё active).
      // ISO timestamp = закрыта репетитором; tutor-side UI рисует индикатор.
      tutor_force_completed_at: string | null;
      // 2026-06-02 (student-progress R1): tutor «проверено» marker. ISO = подтверждена;
      // null = в очереди на проверку. Drives bulk «Подтвердить всё, что AI проверил».
      tutor_reviewed_at: string | null;
      status: string;
    }[];
    total_score: number;
    total_max: number;
    total_time_minutes: number | null;
    // Phase 12 (2026-06-07): общий комментарий репетитора к ДЗ для этого ученика.
    // Прикрепляется post-pass'ом ниже (optional, чтобы 3 push-сайта не трогать).
    tutor_overall_comment?: string | null;
    tutor_overall_comment_at?: string | null;
  }[] = [];

  // Phase 12: student_id → общий комментарий к ДЗ (заполняется из
  // studentAssignments ниже; пусто если ученики ещё не назначены).
  const overallCommentByStudent: Record<
    string,
    { comment: string | null; at: string | null }
  > = {};

  // student_id → task_id → { final_score, hint_count, has_override, ... }.
  // Built alongside the aggregate accumulator so the per_student heatmap cells
  // and the totals use the same computeFinalScore priority chain. Only
  // submitted students get an entry — not-submitted students receive
  // `task_scores: []`. ai_score / ai_score_comment / tutor_score_override*
  // are surfaced to the EditScoreDialog so the tutor sees AI's raw view +
  // current override + previous comment without an extra round-trip.
  const taskScoresByStudent: Record<string, Record<string, {
    final_score: number;
    hint_count: number;
    has_override: boolean;
    ai_score: number | null;
    ai_score_comment: string | null;
    tutor_score_override: number | null;
    tutor_score_override_comment: string | null;
    tutor_force_completed_at: string | null;
    tutor_reviewed_at: string | null;
    status: string;
  }>> = {};

  const { data: studentAssignments } = await db
    .from("homework_tutor_student_assignments")
    .select("id, student_id, tutor_overall_comment, tutor_overall_comment_at")
    .eq("assignment_id", assignmentId);

  // Map student_assignment_id → student_id for joining threads → students.
  const studentBySa: Record<string, string> = {};
  for (const sa of studentAssignments ?? []) {
    studentBySa[sa.id] = sa.student_id;
    // Phase 12: общий комментарий → student_id (для post-pass на per_student).
    overallCommentByStudent[sa.student_id] = {
      comment: (sa.tutor_overall_comment as string | null) ?? null,
      at: (sa.tutor_overall_comment_at as string | null) ?? null,
    };
  }

  if (studentAssignments && studentAssignments.length > 0) {
    const saIds = studentAssignments.map((sa) => sa.id);

    // ─── Fetch ALL threads (any status) for both score aggregation and time ──
    // Previously only completed threads were fetched, which caused in-progress
    // students to appear with empty scores in tutor results (Bug 2 fix).
    const { data: allThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status")
      .in("student_assignment_id", saIds);

    // Split into completed (for submitted=true aggregates and summary stats)
    // and active (for partial progress display in heatmap).
    const completedThreadIds: string[] = [];
    const activeThreadIds: string[] = [];
    const threadStatusById: Record<string, string> = {};
    for (const t of allThreads ?? []) {
      threadStatusById[t.id] = t.status as string;
      if (t.status === "completed") {
        completedThreadIds.push(t.id);
      } else {
        activeThreadIds.push(t.id);
      }
    }

    // student_id → aggregate accumulator (built only for completed-thread students).
    const studentAcc: Record<string, { final: number; max: number; hints: number }> = {};
    // student_id → partial accumulator (built for active-thread students with partial progress).
    const activeStudentAcc: Record<string, { final: number; hints: number }> = {};

    const allThreadIdsForStates = [...completedThreadIds, ...activeThreadIds];

    if (allThreadIdsForStates.length > 0) {
      const { data: allTaskStates } = await db
        .from("homework_tutor_task_states")
        .select(
          "thread_id, task_id, earned_score, status, ai_score, ai_score_comment, tutor_score_override, tutor_score_override_comment, hint_count, attempts, tutor_force_completed_at, tutor_reviewed_at",
        )
        .in("thread_id", allThreadIdsForStates);

      // Group task states by thread
      const statesByThread: Record<string, TaskStateScoreFields[]> = {};
      for (const ts of allTaskStates ?? []) {
        const row = ts as TaskStateScoreFields;
        if (!statesByThread[row.thread_id]) statesByThread[row.thread_id] = [];
        statesByThread[row.thread_id]!.push(row);
      }

      for (const thread of allThreads ?? []) {
        const states = statesByThread[thread.id] ?? [];
        const studentId = studentBySa[thread.student_assignment_id as string];
        const isCompleted = threadStatusById[thread.id] === "completed";

        let threadFinal = 0;
        let threadMaxTotal = 0;
        let threadHints = 0;

        for (const ts of states) {
          const taskInfo = taskMap[ts.task_id];
          const maxScore = taskInfo?.max_score ?? 1;

          // Cell-inclusion invariant (post-pilot 2026-05-09):
          // task_state попадает в cellMap И в accumulator при ЛЮБОМ
          // scoring-сигнале, не только при status='completed'. Это покрывает:
          //   - status='completed' (полностью решённые задачи — historical)
          //   - tutor_score_override≠null (явная ручная правка репетитора —
          //     даже на active task без AI-оценки)
          //   - ai_score≠null (AI частично оценил ON_TRACK / INCORRECT —
          //     это полезный сигнал для tutor'а, без него override=null+AI=0.5
          //     раньше скрывался от heatmap, что путало пилот)
          // provisionGuidedThread-stub строки (status='active' БЕЗ override
          // и БЕЗ ai_score) остаются исключёнными — этим избегаем false-zero
          // ячеек на ещё не тронутых задачах. Полный контракт см. в
          // .claude/rules/40-homework-system.md → «Heatmap cell inclusion».
          const isTaskCompleted = ts.status === "completed";
          const hasOverride = ts.tutor_score_override != null;
          const hasAiScore = ts.ai_score != null;
          if (!isCompleted && !isTaskCompleted && !hasOverride && !hasAiScore) continue;

          const finalScore = computeFinalScore(ts, maxScore);
          const hintCount = Number(ts.hint_count ?? 0);

          threadFinal += finalScore;
          threadMaxTotal += maxScore;
          threadHints += hintCount;

          // Per-cell scores for the heatmap. Keyed by (student_id, task_id),
          // last-write-wins if the same student somehow has multiple threads.
          // Built for BOTH completed and active threads so partial progress
          // renders colored cells in the heatmap. For active threads, only
          // individually-completed tasks appear — unsolved tasks stay null
          // (grey dash in the frontend).
          if (studentId && taskInfo) {
            if (!taskScoresByStudent[studentId]) {
              taskScoresByStudent[studentId] = {};
            }
            // Expose AI's raw score (NOT degraded earned_score). The edit
            // dialog header shows "Текущий балл: X/Y (AI: Z/Y, снижено …)"
            // — the spread between final_score (= max(override, earned, ai))
            // and ai_score reveals hint/wrong-answer degradation. ai_score
            // null = AI hasn't evaluated yet.
            const aiScoreRounded = ts.ai_score != null
              ? Math.round(Number(ts.ai_score) * 100) / 100
              : null;
            const overrideRounded = ts.tutor_score_override != null
              ? Math.round(Number(ts.tutor_score_override) * 100) / 100
              : null;
            const aiCommentRaw = (ts as { ai_score_comment?: string | null }).ai_score_comment;
            const overrideCommentRaw = (ts as { tutor_score_override_comment?: string | null }).tutor_score_override_comment;

            const forceCompletedAtRaw = (ts as { tutor_force_completed_at?: string | null }).tutor_force_completed_at;
            const reviewedAtRaw = (ts as { tutor_reviewed_at?: string | null }).tutor_reviewed_at;
            taskScoresByStudent[studentId][ts.task_id] = {
              final_score: Math.round(finalScore * 100) / 100,
              hint_count: hintCount,
              has_override: ts.tutor_score_override != null,
              ai_score: aiScoreRounded,
              ai_score_comment: typeof aiCommentRaw === "string" && aiCommentRaw.trim().length > 0
                ? aiCommentRaw
                : null,
              tutor_score_override: overrideRounded,
              tutor_score_override_comment: typeof overrideCommentRaw === "string" && overrideCommentRaw.trim().length > 0
                ? overrideCommentRaw
                : null,
              tutor_force_completed_at: typeof forceCompletedAtRaw === "string" ? forceCompletedAtRaw : null,
              tutor_reviewed_at: typeof reviewedAtRaw === "string" ? reviewedAtRaw : null,
              status: typeof ts.status === "string" ? ts.status : "active",
            };
          }

          // Per-task aggregates — only count completed threads for summary stats
          // (avg_score, correct_rate) to keep them meaningful.
          if (taskInfo && isCompleted) {
            if (!guidedTaskScores[ts.task_id]) {
              guidedTaskScores[ts.task_id] = { scoreSum: 0, scoreCount: 0, correctCount: 0, total: 0 };
            }
            guidedTaskScores[ts.task_id].total++;
            if (ts.status === "completed") {
              guidedTaskScores[ts.task_id].scoreSum += finalScore;
              guidedTaskScores[ts.task_id].scoreCount++;
              if (finalScore > 0) {
                guidedTaskScores[ts.task_id].correctCount++;
              }
            }
          }
        }

        if (isCompleted) {
          // Summary stats: only completed threads count for avg_score / distribution.
          if (threadMaxTotal > 0) {
            const pct = (threadFinal / threadMaxTotal) * 100;
            totalScoreSum += pct;
            totalScoreCount++;

            if (pct < 25) distribution["0-24"]++;
            else if (pct < 50) distribution["25-49"]++;
            else if (pct < 75) distribution["50-74"]++;
            else distribution["75-100"]++;
          }

          if (studentId) {
            // Multiple completed threads per student should not happen, but if
            // they do, accumulate so we still return one entry per student.
            if (!studentAcc[studentId]) {
              studentAcc[studentId] = { final: 0, max: 0, hints: 0 };
            }
            studentAcc[studentId].final += threadFinal;
            studentAcc[studentId].max += threadMaxTotal;
            studentAcc[studentId].hints += threadHints;
          }
        } else if (studentId && !studentAcc[studentId]) {
          // Active thread — accumulate partial progress only if the student
          // does NOT already have a completed thread (completed takes priority).
          if (!activeStudentAcc[studentId]) {
            activeStudentAcc[studentId] = { final: 0, hints: 0 };
          }
          activeStudentAcc[studentId].final += threadFinal;
          activeStudentAcc[studentId].hints += threadHints;
        }
      }
    }

    // ─── Wall-clock time aggregation (homework-student-totals AC-9) ──────────
    // Reuses the already-fetched allThreads (any status) to populate
    // total_time_minutes for both submitted and in-progress students.
    const timeByStudent: Record<string, { first: string; last: string }> = {};
    const allThreadIds = (allThreads ?? []).map((t: { id: string }) => t.id);

    if (allThreadIds.length > 0) {
      const { data: msgRows } = await db
        .from("homework_tutor_thread_messages")
        .select("thread_id, created_at")
        .in("thread_id", allThreadIds);

      // thread_id → {first, last} (single pass over rows)
      const threadTimes: Record<string, { first: string; last: string }> = {};
      for (const m of msgRows ?? []) {
        const created = m.created_at as string;
        const t = threadTimes[m.thread_id as string];
        if (!t) {
          threadTimes[m.thread_id as string] = { first: created, last: created };
        } else {
          if (created < t.first) t.first = created;
          if (created > t.last) t.last = created;
        }
      }

      // thread_id → student_id (defensive accumulation if a student somehow
      // has multiple threads — DB invariant is UNIQUE(student_assignment_id),
      // but mirror the existing acc-pattern in this function).
      for (const th of allThreads ?? []) {
        const sid = studentBySa[th.student_assignment_id as string];
        if (!sid) continue;
        const tt = threadTimes[th.id as string];
        if (!tt) continue;
        const cur = timeByStudent[sid];
        if (!cur) {
          timeByStudent[sid] = { first: tt.first, last: tt.last };
        } else {
          if (tt.first < cur.first) cur.first = tt.first;
          if (tt.last > cur.last) cur.last = tt.last;
        }
      }
    }

    // total_max is stable across all students (Σ max_score over ALL tasks of
    // the assignment). Guard: empty assignment → 0/0 (frontend renders «—»).
    const totalMaxForAll = assignmentMaxScoreTotal;

    // Build per_student in the same order as student_assignments.
    // Three-way: completed thread → submitted:true, active thread →
    // submitted:false with partial data, no thread → submitted:false empty.
    for (const sa of studentAssignments) {
      const acc = studentAcc[sa.student_id];
      const activeAcc = activeStudentAcc[sa.student_id];
      const totalTimeMinutes = computeTotalMinutes(timeByStudent[sa.student_id]);

      // Heatmap cell data — shared between completed and active students.
      const cellMap = taskScoresByStudent[sa.student_id] ?? {};
      const taskScores = Object.entries(cellMap).map(([task_id, cell]) => ({
        task_id,
        final_score: cell.final_score,
        hint_count: cell.hint_count,
        has_override: cell.has_override,
        ai_score: cell.ai_score,
        ai_score_comment: cell.ai_score_comment,
        tutor_score_override: cell.tutor_score_override,
        tutor_score_override_comment: cell.tutor_score_override_comment,
        tutor_force_completed_at: cell.tutor_force_completed_at,
        tutor_reviewed_at: cell.tutor_reviewed_at,
        status: cell.status,
      }));

      if (acc) {
        // Completed thread: submitted=true, full aggregates.
        const lowScore = acc.max > 0 && acc.final < 0.3 * acc.max;
        const overuse = acc.hints >= hintOveruseThreshold;
        perStudent.push({
          student_id: sa.student_id,
          submitted: true,
          final_score_total: Math.round(acc.final * 100) / 100,
          max_score_total: acc.max,
          hint_total: acc.hints,
          needs_attention: lowScore || overuse,
          task_scores: taskScores,
          total_score: totalMaxForAll === 0 ? 0 : Math.round(acc.final * 100) / 100,
          total_max: totalMaxForAll,
          total_time_minutes: totalTimeMinutes,
        });
      } else if (activeAcc) {
        // Active thread with partial progress: submitted=false (frontend
        // derives in_progress from total_time_minutes !== null), but task_scores
        // and aggregates are populated so the heatmap and totals columns
        // show real partial data instead of blank dashes.
        const partialScore = Math.round(activeAcc.final * 100) / 100;
        perStudent.push({
          student_id: sa.student_id,
          submitted: false,
          final_score_total: partialScore,
          max_score_total: assignmentMaxScoreTotal,
          hint_total: activeAcc.hints,
          needs_attention: false,
          task_scores: taskScores,
          total_score: partialScore,
          total_max: totalMaxForAll,
          total_time_minutes: totalTimeMinutes,
        });
      } else {
        // No thread at all: not started.
        perStudent.push({
          student_id: sa.student_id,
          submitted: false,
          final_score_total: 0,
          max_score_total: assignmentMaxScoreTotal,
          hint_total: 0,
          needs_attention: false,
          task_scores: [],
          total_score: 0,
          total_max: totalMaxForAll,
          total_time_minutes: totalTimeMinutes,
        });
      }
    }
  }

  // Phase 12: прикрепляем общий комментарий к ДЗ каждому per_student (post-pass —
  // overallCommentByStudent пуст, если студентов нет → no-op).
  for (const ps of perStudent) {
    const oc = overallCommentByStudent[ps.student_id];
    ps.tutor_overall_comment = oc?.comment ?? null;
    ps.tutor_overall_comment_at = oc?.at ?? null;
  }

  const summary = {
    avg_score: totalScoreCount > 0
      ? Math.round((totalScoreSum / totalScoreCount) * 100) / 100
      : null,
    distribution,
    common_error_types: [] as { type: string; count: number }[],
  };

  const perTask = (tasks ?? []).map((t) => {
    const guidedData = guidedTaskScores[t.id];
    const scoreSum = guidedData?.scoreSum ?? 0;
    const scoreCount = guidedData?.scoreCount ?? 0;
    const correctCount = guidedData?.correctCount ?? 0;
    const totalCount = guidedData?.total ?? 0;

    return {
      task_id: t.id,
      order_num: t.order_num,
      max_score: t.max_score,
      avg_score: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
      correct_rate: totalCount > 0
        ? Math.round((correctCount / totalCount) * 100 * 100) / 100
        : null,
      error_type_histogram: [] as { type: string; count: number }[],
    };
  });

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/results",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });

  return jsonOk(cors, { summary, per_task: perTask, per_student: perStudent });
}

// ─── Endpoint: PATCH /assignments/:id/students/:sid/tasks/:tid/score-override
// ─────────────────────────────────────────────────────────────────────────────
//
// Manual score override (Homework Results v2 P0-5 / AC-5). Tutor sets a score
// for a single (student, task) pair without touching ai_score / ai_score_comment.
// `final_score = COALESCE(tutor_score_override, ai_score)` is computed via the
// shared `computeFinalScore` helper — never duplicate the priority chain here.
//
// Reset = same handler with `tutor_score_override: null`.
async function handleSetTutorScoreOverride(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  taskId: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId) || !isUUID(studentId) || !isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid id format");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  // Validate task belongs to this assignment & get max_score for range check.
  const { data: task, error: taskErr } = await db
    .from("homework_tutor_tasks")
    .select("id, max_score, assignment_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr || !task || task.assignment_id !== assignmentId) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Task not found");
  }
  const maxScore = Number(task.max_score ?? 0);

  // Validate body.
  const rawOverride = body?.tutor_score_override;
  let overrideValue: number | null;
  if (rawOverride === null) {
    overrideValue = null;
  } else if (typeof rawOverride === "number" && Number.isFinite(rawOverride)) {
    if (rawOverride < 0 || rawOverride > maxScore) {
      return jsonError(cors, 400, "VALIDATION", `tutor_score_override must be in [0, ${maxScore}]`);
    }
    // Step parity 0.1 (post-pilot 2026-05-09) — tutor и AI используют один шаг.
    // Tolerance 1e-9 защищает от floating-point junk типа `1.7 * 10 = 16.999...`
    // в некоторых JS-движках.
    const scaled = rawOverride * 10;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
      return jsonError(cors, 400, "VALIDATION", "tutor_score_override must be a multiple of 0.1");
    }
    overrideValue = rawOverride;
  } else {
    return jsonError(cors, 400, "VALIDATION", "tutor_score_override must be a number or null");
  }

  let commentValue: string | null = null;
  const rawComment = body?.tutor_score_override_comment;
  if (overrideValue !== null && typeof rawComment === "string") {
    const trimmed = rawComment.trim();
    if (trimmed.length > 1000) {
      return jsonError(cors, 400, "VALIDATION", "comment too long (max 1000)");
    }
    commentValue = trimmed.length > 0 ? trimmed : null;
  }

  // Resolve thread for (assignment, student) → task_state row.
  const { data: sa, error: saErr } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (saErr || !sa) {
    return jsonError(cors, 404, "STUDENT_NOT_ASSIGNED", "Student not assigned");
  }

  const { data: thread, error: threadErr } = await db
    .from("homework_tutor_threads")
    .select("id")
    .eq("student_assignment_id", sa.id)
    .maybeSingle();
  if (threadErr || !thread) {
    return jsonError(cors, 404, "THREAD_NOT_FOUND", "Guided thread not found");
  }

  const { data: existing, error: tsErr } = await db
    .from("homework_tutor_task_states")
    .select("id, ai_score, tutor_score_override, earned_score, status, hint_count, attempts, thread_id, task_id, tutor_force_completed_at")
    .eq("thread_id", thread.id)
    .eq("task_id", taskId)
    .maybeSingle();
  if (tsErr || !existing) {
    return jsonError(cors, 404, "TASK_STATE_NOT_FOUND", "Task state not found");
  }

  // ─── force_complete handling (2026-05-16, lexical-brewing-gadget) ─────────
  // Optional body field. Tutor explicit-control «считать задачу выполненной».
  //   'completed' → mark task as force-completed by tutor + advance thread
  //   'active'    → reopen previously force-completed task (guarded: nope для AI-CORRECT)
  //   null/undef  → backward-compat (status untouched)
  const rawForceComplete = body?.force_complete;
  let forceComplete: "completed" | "active" | null = null;
  if (rawForceComplete === "completed" || rawForceComplete === "active") {
    forceComplete = rawForceComplete;
  } else if (rawForceComplete !== undefined && rawForceComplete !== null) {
    return jsonError(cors, 400, "VALIDATION", "force_complete must be 'completed', 'active', or null");
  }

  // Reopen guard: only force-completed-by-tutor tasks can be reopened.
  // AI-CORRECT задачи (status='completed', tutor_force_completed_at=NULL) — НЕ reopenable.
  if (forceComplete === "active") {
    const existingForceCompletedAt = (existing as Record<string, unknown>).tutor_force_completed_at;
    if (existingForceCompletedAt === null || existingForceCompletedAt === undefined) {
      return jsonError(
        cors,
        409,
        "AI_COMPLETED_NOT_REOPENABLE",
        "AI-completed tasks cannot be reopened; only tutor force-completed tasks support reopen",
      );
    }
  }

  // ─── Force_complete branch — atomic RPC (2026-05-16, code review P1) ─────
  // Multi-query flow (UPDATE override → UPDATE marker → loadAdvanceContext →
  // performTaskAdvance) был неатомичен. RPC `hw_tutor_force_complete_task`
  // делает всё в одной транзакции (миграция `20260516120200`).
  if (forceComplete === "completed" && existing.status === "active") {
    const { data: rpcData, error: rpcErr } = await db.rpc("hw_tutor_force_complete_task", {
      p_assignment_id: assignmentId,
      p_student_id: studentId,
      p_task_id: taskId,
      p_tutor_id: tutorUserId,
      p_score: overrideValue,
      p_comment: commentValue,
    });
    if (rpcErr || !rpcData) {
      console.error("homework_api_request_error", {
        route: "PATCH score-override + force_complete (RPC)",
        error: rpcErr?.message,
      });
      const msg = rpcErr?.message ?? "Failed to force-complete task";
      // Map RPC RAISE EXCEPTION codes to HTTP responses.
      if (msg.includes("ASSIGNMENT_NOT_OWNED")) {
        return jsonError(cors, 403, "FORBIDDEN", "Assignment not owned by tutor");
      }
      if (msg.includes("TASK_NOT_FOUND")) {
        return jsonError(cors, 404, "TASK_NOT_FOUND", "Task not found");
      }
      if (msg.includes("THREAD_NOT_FOUND")) {
        return jsonError(cors, 404, "THREAD_NOT_FOUND", "Guided thread not found");
      }
      if (msg.includes("TASK_STATE_NOT_FOUND")) {
        return jsonError(cors, 404, "TASK_STATE_NOT_FOUND", "Task state not found");
      }
      if (msg.includes("TASK_NOT_ACTIVE")) {
        // Concurrent click race: первый клик уже закрыл задачу, второй RPC
        // дождался lock и увидел не-active status. 409 Conflict — клиент
        // должен refetch'нуть и обновить UI (`status='completed'`).
        return jsonError(cors, 409, "TASK_NOT_ACTIVE", "Task is no longer active (already closed by another request)");
      }
      if (msg.includes("SCORE_OUT_OF_RANGE") || msg.includes("SCORE_STEP_INVALID")) {
        return jsonError(cors, 400, "VALIDATION", msg);
      }
      return jsonError(cors, 500, "DB_ERROR", msg);
    }
    const result = rpcData as Record<string, unknown>;
    console.log("homework_api_request_success", {
      route: "PATCH score-override + force_complete (RPC)",
      tutor_id: tutorUserId,
      assignment_id: assignmentId,
      student_id: studentId,
      task_id: taskId,
      action: "force_complete",
    });
    // Analytics telemetry (2026-06-30): force-complete is a tutor correction
    // (closed without an AI verdict). Best-effort, never blocks the response.
    await recordHwCheckEvent(db, {
      event_type: "tutor_correction",
      tutor_id: tutorUserId,
      assignment_id: assignmentId,
      student_id: studentId,
      task_id: taskId,
      task_state_id: (result.task_state_id as string) ?? (existing.id as string),
      max_score: maxScore,
      correction_kind: "force_complete",
      tutor_score_override: overrideValue,
      ai_score_at_correction: existing.ai_score == null ? null : Number(existing.ai_score),
      override_delta: (overrideValue != null && existing.ai_score != null)
        ? overrideValue - Number(existing.ai_score)
        : null,
    });
    return jsonOk(cors, {
      ok: true,
      task_state: {
        id: result.task_state_id,
        thread_id: result.thread_id,
        task_id: result.task_id,
        ai_score: existing.ai_score,
        tutor_score_override: result.tutor_score_override,
        tutor_score_override_comment: result.tutor_score_override_comment,
        tutor_score_override_at: result.tutor_score_override_at,
        tutor_force_completed_at: result.tutor_force_completed_at,
        status: result.final_status,
        final_score: Math.round(Number(result.final_score ?? 0) * 100) / 100,
        max_score: maxScore,
      },
      advance: {
        advanced_to_task_id: result.advanced_to_task_id,
        thread_completed: result.thread_completed,
      },
    });
  }

  // ─── Non-force-complete path: single UPDATE (override change OR reopen) ───
  // Plain override / reset / reopen — операция простая, atomicity multi-row не
  // требуется, RPC overkill. Keep direct UPDATE.
  const updatePayload: Record<string, unknown> = overrideValue === null
    ? {
        tutor_score_override: null,
        tutor_score_override_comment: null,
        tutor_score_override_at: null,
        tutor_score_override_by: null,
      }
    : {
        tutor_score_override: overrideValue,
        tutor_score_override_comment: commentValue,
        tutor_score_override_at: new Date().toISOString(),
        tutor_score_override_by: tutorUserId,
      };

  // Reopen path layered on top of override change: set status='active' + clear marker.
  if (forceComplete === "active") {
    updatePayload.status = "active";
    updatePayload.tutor_force_completed_at = null;
    updatePayload.tutor_force_completed_by = null;
    updatePayload.updated_at = new Date().toISOString();
  }

  const { data: updated, error: updErr } = await db
    .from("homework_tutor_task_states")
    .update(updatePayload)
    .eq("id", existing.id)
    .select("id, ai_score, tutor_score_override, tutor_score_override_comment, tutor_score_override_at, earned_score, status, hint_count, attempts, thread_id, task_id, tutor_force_completed_at")
    .maybeSingle();
  if (updErr || !updated) {
    console.error("homework_api_request_error", { route: "PATCH score-override", error: updErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to update task state");
  }

  // Analytics telemetry (2026-06-30): tutor correction of the AI grade.
  // override_delta = override − ai_score is the core false-accept/false-reject
  // signal for the AI-quality project. Best-effort, never blocks the response.
  await recordHwCheckEvent(db, {
    event_type: "tutor_correction",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    student_id: studentId,
    task_id: taskId,
    task_state_id: existing.id as string,
    max_score: maxScore,
    correction_kind: forceComplete === "active" ? "reopen" : (overrideValue === null ? "reset" : "override"),
    tutor_score_override: overrideValue,
    ai_score_at_correction: existing.ai_score == null ? null : Number(existing.ai_score),
    override_delta: (overrideValue != null && existing.ai_score != null)
      ? overrideValue - Number(existing.ai_score)
      : null,
  });

  let finalStatus = updated.status as string;
  let finalForceCompletedAt: string | null = (updated as Record<string, unknown>).tutor_force_completed_at as string | null;

  if (forceComplete === "active") {
    // Если thread.status='completed' и мы reopen'аем задачу — вернуть thread в 'active'.
    // Best-effort: error не блокирует response (thread cursor consistency наименее критичен в
    // reopen path — student fallback chain корректно возвращает на active task).
    await db
      .from("homework_tutor_threads")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", thread.id)
      .eq("status", "completed");
    finalStatus = "active";
    finalForceCompletedAt = null;

    console.log("homework_api_request_success", {
      route: "PATCH score-override + reopen",
      tutor_id: tutorUserId,
      assignment_id: assignmentId,
      student_id: studentId,
      task_id: taskId,
      action: "reopen",
    });
  } else {
    console.log("homework_api_request_success", {
      route: "PATCH /assignments/:id/students/:sid/tasks/:tid/score-override",
      tutor_id: tutorUserId,
      assignment_id: assignmentId,
      student_id: studentId,
      task_id: taskId,
      is_reset: overrideValue === null,
    });
  }

  // P2 fix (code review 2026-05-16): compute final_score с final status.
  const finalScore = computeFinalScore(
    { ...updated, status: finalStatus } as TaskStateScoreFields,
    maxScore,
  );

  return jsonOk(cors, {
    ok: true,
    task_state: {
      id: updated.id,
      thread_id: updated.thread_id,
      task_id: updated.task_id,
      ai_score: updated.ai_score,
      tutor_score_override: updated.tutor_score_override,
      tutor_score_override_comment: updated.tutor_score_override_comment,
      tutor_score_override_at: updated.tutor_score_override_at,
      tutor_force_completed_at: finalForceCompletedAt,
      status: finalStatus,
      final_score: Math.round(finalScore * 100) / 100,
      max_score: maxScore,
    },
    advance: null,
  });
}

// ─── Endpoint: POST /assignments/:id/students/:sid/force-complete-all-tasks ──
// ─────────────────────────────────────────────────────────────────────────────
//
// Bulk tutor force-complete (2026-05-16, lexical-brewing-gadget). Закрывает все
// active task_states ученика одним RPC вызовом (atomicity + reconcile thread
// cursor). RPC `hw_tutor_force_complete_all_tasks` (миграция `20260516120200`).
//
// Replaces multi-query flow (mass UPDATE → thread UPDATE → INSERT system msg)
// — был не атомичен, partial-failure оставлял thread cursor stale.
async function handleBulkForceCompleteStudentTasks(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId) || !isUUID(studentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid id format");
  }

  const { data, error } = await db.rpc("hw_tutor_force_complete_all_tasks", {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_tutor_id: tutorUserId,
  });
  if (error) {
    console.error("homework_api_request_error", {
      route: "POST /force-complete-all-tasks (RPC)",
      error: error.message,
    });
    // RPC RAISE EXCEPTION для ASSIGNMENT_NOT_OWNED / THREAD_NOT_FOUND. Маппим
    // в человекочитаемый response. Production deploys RPC до этого commit'а —
    // 404 path остаётся через generic 500 fallback.
    const msg = error.message ?? "Failed to mark tasks completed";
    if (msg.includes("ASSIGNMENT_NOT_OWNED")) {
      return jsonError(cors, 403, "FORBIDDEN", "Assignment not owned by tutor");
    }
    if (msg.includes("THREAD_NOT_FOUND")) {
      return jsonError(cors, 404, "THREAD_NOT_FOUND", "Guided thread not found");
    }
    return jsonError(cors, 500, "DB_ERROR", msg);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const closedCount = Number(result.closed_count ?? 0);

  console.warn(JSON.stringify({
    event: "homework_bulk_force_completed",
    assignmentId,
    studentId,
    closedCount,
  }));

  return jsonOk(cors, {
    closed_count: closedCount,
    advanced_to_task_id: result.advanced_to_task_id ?? null,
  });
}

// ─── Endpoint: GET /templates ────────────────────────────────────────────────

async function handleListTemplates(
  db: SupabaseClient,
  tutorUserId: string,
  searchParams: URLSearchParams,
  cors: Record<string, string>,
): Promise<Response> {
  const subject = searchParams.get("subject");
  if (subject && !(VALID_SUBJECTS_UPDATE as readonly string[]).includes(subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_UPDATE.join(", ")}`);
  }
  // unified-task-model (2026-07-05): scope=mine (default, legacy-совместимо) |
  // shared (Банк ДЗ — шаблоны, опубликованные модераторами).
  const scope = searchParams.get("scope") === "shared" ? "shared" : "mine";

  let query = db
    .from("homework_tutor_templates")
    .select(
      "id, title, subject, topic, tags, created_at, tasks_json, visibility, usage_count, published_at, tasks_migrated_at",
    )
    .order("created_at", { ascending: false });
  if (scope === "shared") {
    query = query.eq("visibility", "shared");
  } else {
    query = query.eq("tutor_id", tutorUserId);
  }

  if (subject) {
    query = query.eq("subject", subject);
  }

  const { data, error } = await query;
  if (error) {
    console.error("homework_api_request_error", { route: "GET /templates", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить шаблоны");
  }

  // task_count: ссылочные шаблоны (migrated) — SQL-агрегатом (ревью-фикс P1
  // 2026-07-06: выборка всех junction-строк была O(шаблоны×задачи) и тихо
  // резалась PostgREST-капом 1000 → неверный счётчик); legacy — по tasks_json
  // (skew-совместимость: старый фронт видит те же цифры).
  const rows = data ?? [];
  const migratedIds = rows
    .filter((t) => t.tasks_migrated_at != null)
    .map((t) => t.id as string);
  const refCountByTemplate = new Map<string, number>();
  if (migratedIds.length > 0) {
    const { data: countRows, error: refErr } = await db.rpc("hw_template_task_counts", {
      p_template_ids: migratedIds,
    });
    if (refErr) {
      console.warn("homework_api_template_ref_count_failed", { error: refErr.message });
    }
    for (const r of (countRows ?? []) as Array<{ template_id: string; task_count: number }>) {
      refCountByTemplate.set(r.template_id, Number(r.task_count) || 0);
    }
  }

  const result = rows.map((t) => ({
    id: t.id,
    title: t.title,
    subject: t.subject,
    topic: t.topic,
    tags: t.tags,
    created_at: t.created_at,
    task_count: t.tasks_migrated_at != null
      ? (refCountByTemplate.get(t.id as string) ?? 0)
      : (Array.isArray(t.tasks_json) ? t.tasks_json.length : 0),
    // Банк ДЗ (additive — старый фронт игнорирует):
    visibility: t.visibility ?? "private",
    usage_count: typeof t.usage_count === "number" ? t.usage_count : 0,
    published_at: t.published_at ?? null,
  }));

  return jsonOk(cors, result);
}

// ─── Endpoint: POST /templates ───────────────────────────────────────────────

async function handleCreateTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required");
  }
  if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS_CREATE as readonly string[]).includes(b.subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_CREATE.join(", ")}`);
  }

  // unified-task-model (2026-07-05): новый клиент шлёт task_refs (ссылки на
  // kb_tasks) — шаблон создаётся ссылочным. Legacy tasks_json (старый клиент)
  // принимается как раньше (материализуется потом hw_materialize_legacy_templates).
  const hasTaskRefs = Array.isArray(b.task_refs) && (b.task_refs as unknown[]).length > 0;
  if (hasTaskRefs) {
    const refsIn = b.task_refs as Array<Record<string, unknown>>;
    for (const r of refsIn) {
      if (!r || typeof r !== "object" || !isUUID(r.kb_task_id)) {
        return jsonError(cors, 400, "VALIDATION", "task_refs must be [{kb_task_id: uuid, sort_order?: number}]");
      }
    }
    const kbIds = Array.from(new Set(refsIn.map((r) => r.kb_task_id as string)));
    const { data: kbRows, error: kbErr } = await db
      .from("kb_tasks")
      .select("id, owner_id, moderation_status")
      .in("id", kbIds);
    if (kbErr) {
      console.error("homework_api_request_error", { route: "POST /templates", error: kbErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось проверить задачи шаблона — обновите страницу и попробуйте снова");
    }
    const readable = new Set(
      (kbRows ?? [])
        .filter((k) =>
          k.owner_id === tutorUserId || (k.owner_id === null && k.moderation_status === "active")
        )
        .map((k) => k.id as string),
    );
    const missing = kbIds.filter((id) => !readable.has(id));
    if (missing.length > 0) {
      return jsonError(
        cors,
        400,
        "INVALID_TASK_REFS",
        "Некоторые задачи недоступны в Базе — обновите страницу и попробуйте снова",
      );
    }

    const isLangTpl = LANGUAGE_SUBJECTS_REQUIRING_CEFR.has(b.subject as string);
    const { data: created, error: createErr } = await db
      .from("homework_tutor_templates")
      .insert({
        tutor_id: tutorUserId,
        title: (b.title as string).trim(),
        subject: b.subject,
        topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
        tags: Array.isArray(b.tags) ? b.tags.filter((t) => isString(t)) : [],
        tasks_json: [],
        tasks_migrated_at: new Date().toISOString(),
        exam_type: (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string) ? b.exam_type : "ege",
        disable_ai_bootstrap: b.disable_ai_bootstrap === true,
        feedback_language: isLangTpl ? (normalizeFeedbackLanguage(b.feedback_language) ?? "auto") : null,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      console.error("homework_api_request_error", { route: "POST /templates", error: createErr?.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить шаблон");
    }
    // Дедуп повторных kb_task_id (UNIQUE в junction) с сохранением порядка.
    const seenIds = new Set<string>();
    const junctionRows = refsIn
      .filter((r) => {
        const id = r.kb_task_id as string;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      })
      .map((r, i) => ({
        template_id: created.id,
        kb_task_id: r.kb_task_id as string,
        sort_order: typeof r.sort_order === "number" ? r.sort_order : i,
      }));
    const { error: junctionErr } = await db.from("homework_template_tasks").insert(junctionRows);
    if (junctionErr) {
      console.error("homework_api_request_error", { route: "POST /templates", error: junctionErr.message });
      await db.from("homework_tutor_templates").delete().eq("id", created.id);
      return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить задачи шаблона");
    }
    return jsonOk(cors, { template_id: created.id }, 201);
  }

  if (!Array.isArray(b.tasks_json)) {
    return jsonError(cors, 400, "VALIDATION", "tasks_json must be an array");
  }

  // Field-parity fix (2026-06-03): per-task check_format / task_kind / cefr_level
  // ride through tasks_json (HomeworkTemplateTask). feedback_language —
  // только для языковых предметов.
  const isLanguageTemplate = LANGUAGE_SUBJECTS_REQUIRING_CEFR.has(b.subject as string);
  // Review P1-3: этот endpoint — основной путь чекбокса «Сохранить как шаблон»
  // (client-side createTutorHomeworkTemplate). Нормализуем AI-поля server-side
  // (defense-in-depth, паритет с handleCreateAssignment): валидный check_format,
  // task_kind через resolveWriteTaskKind (сохраняет 'speaking'), cefr только для
  // языковых. Spread сохраняет все остальные поля задачи (verbatim).
  const normalizedTasksJson = (b.tasks_json as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const t = raw as Record<string, unknown>;
    const checkFormat = (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string)
      ? (t.check_format as string)
      : "short_answer";
    return {
      ...t,
      check_format: checkFormat,
      task_kind: resolveWriteTaskKind(t.task_kind, checkFormat),
      cefr_level: isLanguageTemplate ? normalizeCefrLevel(t.cefr_level) : null,
      // Criteria-grading feature (2026-06): структурные критерии round-trip через шаблон.
      grading_criteria_json: normalizeGradingCriteria(t.grading_criteria_json),
    };
  });
  const { data, error } = await db
    .from("homework_tutor_templates")
    .insert({
      tutor_id: tutorUserId,
      title: (b.title as string).trim(),
      subject: b.subject,
      topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
      tags: Array.isArray(b.tags) ? b.tags.filter((t) => isString(t)) : [],
      tasks_json: normalizedTasksJson,
      exam_type: (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string) ? b.exam_type : "ege",
      disable_ai_bootstrap: b.disable_ai_bootstrap === true,
      feedback_language: isLanguageTemplate ? (normalizeFeedbackLanguage(b.feedback_language) ?? "auto") : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("homework_api_request_error", { route: "POST /templates", error: error?.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить шаблон");
  }

  return jsonOk(cors, { template_id: data.id }, 201);
}

// ─── Endpoint: GET /templates/:id ────────────────────────────────────────────

async function handleGetTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  templateId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(templateId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid template ID format");
  }

  const { data, error } = await db
    .from("homework_tutor_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();

  if (error || !data) {
    return jsonError(cors, 404, "NOT_FOUND", "Template not found");
  }
  // unified-task-model: shared-шаблоны (Банк ДЗ) читаемы любым тутором.
  if (data.tutor_id !== tutorUserId && data.visibility !== "shared") {
    return jsonError(cors, 403, "FORBIDDEN", "Template does not belong to you");
  }

  // Legacy-шаблон (не мигрирован) → как раньше, сырой tasks_json.
  if (data.tasks_migrated_at == null) {
    return jsonOk(cors, data);
  }

  // Ссылочный шаблон → dual-shape (deploy-skew): task_refs (новый клиент) +
  // СИНТЕЗИРОВАННЫЙ tasks_json из живых kb-задач (старый клиент читает его же
  // через resolveTemplateLoad без правок). Недоступная задача → unavailable,
  // НЕ 500 (rule 45-паттерн graceful hydration).
  const { data: refs, error: refsErr } = await db
    .from("homework_template_tasks")
    .select("kb_task_id, sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true });
  if (refsErr) {
    console.error("homework_api_request_error", { route: "GET /templates/:id", error: refsErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить задачи шаблона");
  }
  const kbIds = (refs ?? []).map((r) => r.kb_task_id as string);
  const kbById = new Map<string, KbTaskLike>();
  if (kbIds.length > 0) {
    const { data: kbRows, error: kbRowsErr } = await db
      .from("kb_tasks")
      .select(KB_TASK_SNAPSHOT_SELECT)
      .in("id", kbIds);
    if (kbRowsErr) {
      console.error("homework_api_request_error", { route: "GET /templates/:id", error: kbRowsErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить задачи шаблона");
    }
    for (const row of (kbRows ?? []) as unknown as KbTaskLike[]) {
      kbById.set(row.id, row);
    }
  }

  // Читаемость задачи ВЫЗЫВАЮЩИМ: своя ИЛИ активная каталожная. Чужая личная
  // (не должно быть у shared по инварианту publish) / скрытая → unavailable.
  const taskRefs = (refs ?? []).map((r) => {
    const kb = kbById.get(r.kb_task_id as string);
    const readable = kb != null &&
      (kb.owner_id === tutorUserId || (kb.owner_id === null && kb.moderation_status === "active"));
    return {
      kb_task_id: r.kb_task_id,
      sort_order: r.sort_order,
      unavailable: !readable,
      task: readable && kb ? kb : null,
    };
  });
  const synthesizedTasksJson = taskRefs
    .filter((r) => r.task != null)
    .map((r) => kbTaskToTemplateTaskJson(r.task as KbTaskLike));

  return jsonOk(cors, {
    ...data,
    tasks_json: synthesizedTasksJson,
    task_refs: taskRefs,
  });
}

// ─── Endpoint: DELETE /templates/:id ─────────────────────────────────────────

async function handleDeleteTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  templateId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(templateId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid template ID format");
  }

  const { data: existing } = await db
    .from("homework_tutor_templates")
    .select("tutor_id")
    .eq("id", templateId)
    .maybeSingle();

  if (!existing) {
    return jsonError(cors, 404, "NOT_FOUND", "Template not found");
  }
  if (existing.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Template does not belong to you");
  }

  const { error } = await db
    .from("homework_tutor_templates")
    .delete()
    .eq("id", templateId);

  if (error) {
    console.error("homework_api_request_error", { route: "DELETE /templates/:id", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete template");
  }

  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: POST /templates/:id/fork ──────────────────────────────────────
//
// unified-task-model (2026-07-05): «Создать свою копию» — форк шаблона Банка
// (или своего). Копирует строку шаблона + ССЫЛКИ на ТЕ ЖЕ задачи (задачи НЕ
// копируются — решение из скриншотов советчика: иначе общий банк становится
// неуправляемым). Форк всегда private; правка каталожной задачи внутри форка →
// copy-on-write через push-to-kb.
async function handleForkTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  templateId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(templateId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid template ID format");
  }

  const { data: tpl, error: tplErr } = await db
    .from("homework_tutor_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (tplErr || !tpl) {
    return jsonError(cors, 404, "NOT_FOUND", "Шаблон не найден");
  }
  if (tpl.tutor_id !== tutorUserId && tpl.visibility !== "shared") {
    return jsonError(cors, 403, "FORBIDDEN", "Шаблон недоступен");
  }

  const { data: created, error: createErr } = await db
    .from("homework_tutor_templates")
    .insert({
      tutor_id: tutorUserId,
      title: tpl.title,
      subject: tpl.subject,
      topic: tpl.topic ?? null,
      tags: Array.isArray(tpl.tags) ? tpl.tags : [],
      // Legacy-шаблон → копия tasks_json (материализуется потом); ссылочный →
      // пустой json + копия junction ниже.
      tasks_json: tpl.tasks_migrated_at != null ? [] : (tpl.tasks_json ?? []),
      tasks_migrated_at: tpl.tasks_migrated_at != null ? new Date().toISOString() : null,
      exam_type: tpl.exam_type ?? null,
      feedback_language: tpl.feedback_language ?? null,
      disable_ai_bootstrap: tpl.disable_ai_bootstrap === true,
      forked_from_template_id: tpl.id,
    })
    .select("id")
    .single();
  if (createErr || !created) {
    console.error("homework_api_request_error", { route: "POST /templates/:id/fork", error: createErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать копию шаблона");
  }

  if (tpl.tasks_migrated_at != null) {
    const { data: refs, error: refsErr } = await db
      .from("homework_template_tasks")
      .select("kb_task_id, sort_order")
      .eq("template_id", templateId)
      .order("sort_order", { ascending: true });
    if (refsErr) {
      console.error("homework_api_request_error", { route: "POST /templates/:id/fork", error: refsErr.message });
      await db.from("homework_tutor_templates").delete().eq("id", created.id);
      return jsonError(cors, 500, "DB_ERROR", "Не удалось скопировать задачи шаблона");
    }
    if ((refs ?? []).length > 0) {
      const { error: junctionErr } = await db.from("homework_template_tasks").insert(
        (refs ?? []).map((r) => ({
          template_id: created.id,
          kb_task_id: r.kb_task_id,
          sort_order: r.sort_order,
        })),
      );
      if (junctionErr) {
        console.error("homework_api_request_error", { route: "POST /templates/:id/fork", error: junctionErr.message });
        await db.from("homework_tutor_templates").delete().eq("id", created.id);
        return jsonError(cors, 500, "DB_ERROR", "Не удалось скопировать задачи шаблона");
      }
    }
  }

  return jsonOk(cors, { template_id: created.id }, 201);
}

// ─── Endpoint: POST /assignments/:id/save-as-template ────────────────────────
//
// homework-reuse-v1 TASK-6 (AC-14, AC-15).
//
// Создаёт template snapshot из существующего ДЗ пост-фактум (Recognition over
// Recall, принцип 3 doc 16). Отличается от `POST /templates`:
//   - не требует передачи `tasks_json` от клиента — читает задачи с ownership
//     check через `assignment_id` → `homework_tutor_tasks`;
//   - принимает toggle'ы `include_rubric` / `include_ai_settings` для
//     гранулярного контроля над тем, что попадает в snapshot.
//
// `include_materials` на уровне schema пока noop (шаблоны не хранят materials,
// они живут в `homework_tutor_materials` отдельно per assignment). Флаг
// принимается для forward-compat API контракта + checkbox disabled в UI.
//
// Существующий checkbox «Сохранить как шаблон» в `HWActionBar` при создании
// ДЗ остаётся независимым путём (AC-16) — эти два пути не конфликтуют, так
// как создают разные строки с разным `created_at`.
async function handleCreateTemplateFromAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr as Record<string, unknown>;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required (non-empty string)");
  }
  if (b.tags !== undefined && !Array.isArray(b.tags)) {
    return jsonError(cors, 400, "VALIDATION", "tags must be an array of strings");
  }
  if (!isBoolean(b.include_rubric)) {
    return jsonError(cors, 400, "VALIDATION", "include_rubric must be a boolean");
  }
  if (!isBoolean(b.include_materials)) {
    return jsonError(cors, 400, "VALIDATION", "include_materials must be a boolean");
  }
  if (!isBoolean(b.include_ai_settings)) {
    return jsonError(cors, 400, "VALIDATION", "include_ai_settings must be a boolean");
  }

  // Phase 9 (2026-05-25) — pre-validate assignment.subject против VALID_SUBJECTS_CREATE,
  // чтобы не получить generic 500 DB_ERROR при CHECK constraint violation.
  // Миграция 20260525120000 расширила homework_tutor_templates_subject_check до 19
  // canonical + legacy subjects (mirror homework_tutor_assignments_subject_check),
  // но guard здесь работает как defense-in-depth: если в будущем CHECK constraint
  // снова разойдётся, репетитор увидит понятную ошибку вместо generic toast.
  const assignmentSubject = isString(assignment.subject)
    ? (assignment.subject as string).trim()
    : "";
  if (!assignmentSubject || !(VALID_SUBJECTS_CREATE as readonly string[]).includes(assignmentSubject)) {
    console.warn("homework_api_save_template_invalid_subject", {
      assignment_id: assignmentId,
      subject: assignmentSubject || null,
    });
    return jsonError(
      cors,
      400,
      "INVALID_SUBJECT",
      `Предмет «${assignmentSubject || "не указан"}» не поддерживается для шаблонов. Свяжитесь с поддержкой.`,
    );
  }

  // Read all tasks for this assignment. Ownership уже проверен выше.
  // Field-parity fix (2026-06-03): + task_kind, cefr_level (раньше не читались →
  // reuse откатывал task_kind в numeric и терял уровень языковой задачи).
  const { data: taskRows, error: tasksErr } = await db
    .from("homework_tutor_tasks")
    .select(
      "id, order_num, task_text, task_image_url, correct_answer, max_score, " +
        "rubric_text, rubric_image_urls, solution_text, solution_image_urls, " +
        "check_format, task_kind, kim_number, cefr_level, grading_criteria_json, " +
        "source_kb_task_id",
    )
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (tasksErr) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/save-as-template",
      error: tasksErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks");
  }

  const includeRubric = b.include_rubric === true;
  const includeAiSettings = b.include_ai_settings === true;
  // CEFR — только для языковых предметов (на физике/математике поля нет, Q2).
  const isLanguageTemplate = LANGUAGE_SUBJECTS_REQUIRING_CEFR.has(assignmentSubject);

  // Build tasks_json[]. Additive per-task `source_kb_task_id` (AC-15) — provenance
  // для будущего Sprint 2+ sync-feature. Backward compatible внутри JSONB.
  const tasksJson = ((taskRows ?? []) as unknown as Array<{
    task_text: string | null;
    task_image_url: string | null;
    correct_answer: string | null;
    max_score: number | null;
    solution_text: string | null;
    solution_image_urls: string | null;
    rubric_text: string | null;
    rubric_image_urls: string | null;
    check_format: string | null;
    task_kind: string | null;
    cefr_level: string | null;
    kim_number: number | null;
    grading_criteria_json: unknown;
  }>).map((t) => {
    const base: Record<string, unknown> = {
      task_text: t.task_text ?? "",
      task_image_url: t.task_image_url ?? null,
      correct_answer: t.correct_answer ?? null,
      max_score: typeof t.max_score === "number" ? t.max_score : 1,
      solution_text: t.solution_text ?? null,
      solution_image_urls: t.solution_image_urls ?? null,
      // include_rubric=false → rubric поля зануляются в snapshot
      rubric_text: includeRubric ? (t.rubric_text ?? null) : null,
      rubric_image_urls: includeRubric ? (t.rubric_image_urls ?? null) : null,
    };
    // include_ai_settings=false → опускаем check_format / task_kind / cefr_level,
    // чтобы при использовании шаблона применился runtime default. Field-parity
    // fix (2026-06-03): раньше check_format сохранялся, а task_kind/cefr — нет.
    if (includeAiSettings) {
      if (isNonEmptyString(t.check_format)) base.check_format = t.check_format;
      if (isNonEmptyString(t.task_kind)) base.task_kind = t.task_kind;
      // cefr_level — только для языковых задач.
      if (isLanguageTemplate && isNonEmptyString(t.cefr_level)) base.cefr_level = t.cefr_level;
      // Phase 2 (2026-06-21): № КИМ → grading по ФИПИ при reuse шаблона.
      if (typeof t.kim_number === "number") base.kim_number = t.kim_number;
      // Criteria-grading feature (2026-06): структурные критерии — часть AI-настроек.
      const gc = normalizeGradingCriteria(t.grading_criteria_json);
      if (gc) base.grading_criteria_json = gc;
    }
    return base;
  });

  // Sanitize tags — whitelist only string values, trim, drop empties, dedupe.
  const tagsRaw = Array.isArray(b.tags) ? b.tags : [];
  const tagSet = new Set<string>();
  for (const t of tagsRaw) {
    if (!isString(t)) continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    tagSet.add(trimmed);
  }
  const tags = Array.from(tagSet);

  const { data: inserted, error: insertErr } = await db
    .from("homework_tutor_templates")
    .insert({
      tutor_id: tutorUserId,
      title: (b.title as string).trim(),
      subject: assignment.subject as string,
      topic: isNonEmptyString(assignment.topic) ? (assignment.topic as string).trim() : null,
      tags,
      tasks_json: tasksJson,
      // Assignment-level settings parity (field-parity fix 2026-06-03). Gated by
      // include_ai_settings (тот же toggle, что check_format) — feedback_language
      // только для языковых.
      exam_type: includeAiSettings
        ? ((VALID_EXAM_TYPES as readonly string[]).includes(assignment.exam_type as string) ? assignment.exam_type : "ege")
        : null,
      disable_ai_bootstrap: includeAiSettings ? assignment.disable_ai_bootstrap === true : false,
      feedback_language: includeAiSettings && isLanguageTemplate
        ? (normalizeFeedbackLanguage(assignment.feedback_language) ?? "auto")
        : null,
    })
    .select("id, title, subject, topic, tags, tasks_json, created_at, exam_type, feedback_language, disable_ai_bootstrap")
    .single();

  if (insertErr || !inserted) {
    // Phase 9 (2026-05-25): catch Postgres CHECK constraint violation explicitly
    // (code 23514). Defensive — pre-validate выше уже отбивает invalid subjects,
    // но если миграция CHECK constraint снова разойдётся с VALID_SUBJECTS_CREATE,
    // surface specific reason вместо generic «Не удалось сохранить шаблон».
    const pgCode =
      typeof (insertErr as { code?: unknown } | null)?.code === "string"
        ? ((insertErr as { code: string }).code)
        : null;
    if (pgCode === "23514") {
      console.warn("homework_api_save_template_check_violation", {
        assignment_id: assignmentId,
        subject: assignmentSubject,
        error: insertErr?.message,
      });
      return jsonError(
        cors,
        409,
        "CHECK_VIOLATION",
        "Не удалось сохранить шаблон: данные не прошли валидацию схемы БД. Свяжитесь с поддержкой.",
      );
    }
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/save-as-template",
      error: insertErr?.message,
      pg_code: pgCode,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить шаблон. Попробуйте ещё раз.");
  }

  // NOTE: include_materials — no schema support yet. Templates don't own
  // materials (they live in `homework_tutor_materials` per-assignment).
  // Flag accepted for API forward-compat and UI honesty (disabled switch with
  // tooltip) per spec §Phase 3 TASK-6 «Что делаем».
  if (b.include_materials === true) {
    console.info("homework_api_template_materials_noop", {
      assignment_id: assignmentId,
      template_id: inserted.id,
    });
  }

  // unified-task-model (2026-07-05): пробуем сделать шаблон ССЫЛОЧНЫМ —
  // провенанс из source_kb_task_id, недостающие задачи авто-зеркалятся в Базу
  // («Из ДЗ»). Успех для ВСЕХ задач → junction + tasks_migrated_at (GET будет
  // синтезировать tasks_json из живых ссылок; сохранённый snapshot = audit).
  // Любой сбой → legacy-снапшот, как раньше (degrade, не блок).
  try {
    const assignmentExamType = (VALID_EXAM_TYPES as readonly string[]).includes(assignment.exam_type as string)
      ? (assignment.exam_type as string)
      : "ege";
    let mirrorFolder: string | null = null;
    const refIds: string[] = [];
    let allResolved = true;
    for (const t of (taskRows ?? []) as Array<Record<string, unknown>>) {
      let kbId = await resolveProvidedKbTaskId(db, tutorUserId, t.source_kb_task_id);
      if (!kbId) {
        if (!mirrorFolder) {
          mirrorFolder = await resolveOrCreateRootKbFolder(db, tutorUserId, KB_MIRROR_FOLDER_NAME);
        }
        kbId = mirrorFolder
          ? await mirrorNewTaskToKb(db, tutorUserId, t, {
            folderId: mirrorFolder,
            exam: typeof t.kim_number === "number" ? assignmentExamType : null,
          })
          : null;
      }
      if (!kbId) {
        allResolved = false;
        break;
      }
      refIds.push(kbId);
    }
    if (allResolved && refIds.length > 0) {
      const seenRefIds = new Set<string>();
      const junctionRows = refIds
        .filter((id) => {
          if (seenRefIds.has(id)) return false;
          seenRefIds.add(id);
          return true;
        })
        .map((id, i) => ({ template_id: inserted.id, kb_task_id: id, sort_order: i }));
      const { error: junctionErr } = await db.from("homework_template_tasks").insert(junctionRows);
      if (!junctionErr) {
        await db
          .from("homework_tutor_templates")
          .update({ tasks_migrated_at: new Date().toISOString() })
          .eq("id", inserted.id);
      } else {
        console.warn("homework_api_save_template_refs_failed", {
          template_id: inserted.id,
          error: junctionErr.message,
        });
      }
    } else if (!allResolved) {
      console.warn("homework_api_save_template_refs_degraded", {
        template_id: inserted.id,
        reason: "not_all_tasks_resolved_to_kb",
      });
    }
  } catch (refErr) {
    console.warn("homework_api_save_template_refs_failed", {
      template_id: inserted.id,
      error: refErr instanceof Error ? refErr.message : String(refErr),
    });
  }

  return jsonOk(cors, inserted, 201);
}

// ─── Endpoint: PATCH /templates/:id ──────────────────────────────────────────
//
// homework-reuse-v1 TASK-6 (AC-17).
//
// Обновляет ТОЛЬКО метаданные шаблона — `title`, `tags`, `topic`. Жёсткий
// whitelist: попытка передать `tasks_json` / `subject` / `tasks` / любое
// другое поле → 400. Если бы silent-ignore — клиент мог случайно отправить
// stale `tasks_json` из кеша и затереть валидные задачи шаблона.
//
// Редактирование задач шаблона вынесено в Sprint 2+ (требует отдельного
// dialog с task picker и более аккуратного provenance тракинга).
const UPDATE_TEMPLATE_ALLOWED_KEYS = new Set(["title", "tags", "topic", "task_refs"]);

async function handleUpdateTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  templateId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(templateId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid template ID format");
  }

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  // Whitelist-check. Любое "лишнее" поле отклоняем жёстко — mismatch интерфейса
  // означает, что клиент устарел (или злонамерен).
  for (const key of Object.keys(b)) {
    if (!UPDATE_TEMPLATE_ALLOWED_KEYS.has(key)) {
      return jsonError(
        cors,
        400,
        "VALIDATION",
        "Можно изменить только название, теги, тему и список задач шаблона",
      );
    }
  }

  // Ownership check → 404/403 differentiated (не leak'аем существование чужих).
  const { data: existing, error: existingErr } = await db
    .from("homework_tutor_templates")
    .select("id, tutor_id")
    .eq("id", templateId)
    .maybeSingle();

  if (existingErr) {
    console.error("homework_api_request_error", {
      route: "PATCH /templates/:id",
      error: existingErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить шаблон");
  }
  if (!existing) {
    return jsonError(cors, 404, "NOT_FOUND", "Template not found");
  }
  if (existing.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Template does not belong to you");
  }

  const patch: Record<string, unknown> = {};

  if ("title" in b) {
    if (!isNonEmptyString(b.title)) {
      return jsonError(cors, 400, "VALIDATION", "title must be a non-empty string");
    }
    patch.title = (b.title as string).trim();
  }
  if ("tags" in b) {
    if (!Array.isArray(b.tags)) {
      return jsonError(cors, 400, "VALIDATION", "tags must be an array of strings");
    }
    const tagSet = new Set<string>();
    for (const t of b.tags) {
      if (!isString(t)) continue;
      const trimmed = t.trim();
      if (!trimmed) continue;
      tagSet.add(trimmed);
    }
    patch.tags = Array.from(tagSet);
  }
  if ("topic" in b) {
    if (b.topic === null) {
      patch.topic = null;
    } else if (isString(b.topic)) {
      const trimmed = (b.topic as string).trim();
      patch.topic = trimmed.length > 0 ? trimmed : null;
    } else {
      return jsonError(cors, 400, "VALIDATION", "topic must be a string or null");
    }
  }

  // unified-task-model (2026-07-05): full-replace ссылок шаблона (own only).
  if ("task_refs" in b) {
    if (!Array.isArray(b.task_refs) || (b.task_refs as unknown[]).length === 0) {
      return jsonError(cors, 400, "VALIDATION", "task_refs must be a non-empty array");
    }
    const refsIn = b.task_refs as Array<Record<string, unknown>>;
    for (const r of refsIn) {
      if (!r || typeof r !== "object" || !isUUID(r.kb_task_id)) {
        return jsonError(cors, 400, "VALIDATION", "task_refs must be [{kb_task_id: uuid, sort_order?: number}]");
      }
    }
    const kbIds = Array.from(new Set(refsIn.map((r) => r.kb_task_id as string)));
    const { data: kbRows, error: kbErr } = await db
      .from("kb_tasks")
      .select("id, owner_id, moderation_status")
      .in("id", kbIds);
    if (kbErr) {
      console.error("homework_api_request_error", { route: "PATCH /templates/:id", error: kbErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось проверить задачи шаблона — обновите страницу и попробуйте снова");
    }
    const readable = new Set(
      (kbRows ?? [])
        .filter((k) =>
          k.owner_id === tutorUserId || (k.owner_id === null && k.moderation_status === "active")
        )
        .map((k) => k.id as string),
    );
    if (kbIds.some((id) => !readable.has(id))) {
      return jsonError(
        cors,
        400,
        "INVALID_TASK_REFS",
        "Некоторые задачи недоступны в Базе — обновите страницу и попробуйте снова",
      );
    }
    // Ревью-фикс P1 (2026-07-06): UPSERT-then-delete-stale вместо
    // delete-then-insert — сбой между шагами оставляет шаблон НАДМНОЖЕСТВОМ
    // (валиден, ретрай идемпотентен), а не пустым.
    const seenIds = new Set<string>();
    const junctionRows = refsIn
      .filter((r) => {
        const id = r.kb_task_id as string;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      })
      .map((r, i) => ({
        template_id: templateId,
        kb_task_id: r.kb_task_id as string,
        sort_order: typeof r.sort_order === "number" ? r.sort_order : i,
      }));
    const { error: upsertErr } = await db
      .from("homework_template_tasks")
      .upsert(junctionRows, { onConflict: "template_id,kb_task_id" });
    if (upsertErr) {
      console.error("homework_api_request_error", { route: "PATCH /templates/:id", error: upsertErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось обновить задачи шаблона");
    }
    const keepIds = junctionRows.map((r) => r.kb_task_id);
    const { error: staleErr } = await db
      .from("homework_template_tasks")
      .delete()
      .eq("template_id", templateId)
      .not("kb_task_id", "in", `(${keepIds.join(",")})`);
    if (staleErr) {
      console.error("homework_api_request_error", { route: "PATCH /templates/:id", error: staleErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось обновить задачи шаблона");
    }
    patch.tasks_migrated_at = new Date().toISOString();
    patch.updated_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Nothing to update");
  }

  const { data: updated, error: updateErr } = await db
    .from("homework_tutor_templates")
    .update(patch)
    .eq("id", templateId)
    .eq("tutor_id", tutorUserId)
    .select("id, title, subject, topic, tags, tasks_json, created_at")
    .single();

  if (updateErr || !updated) {
    console.error("homework_api_request_error", {
      route: "PATCH /templates/:id",
      error: updateErr?.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to update template");
  }

  return jsonOk(cors, updated);
}

// ─── Endpoint: POST /assignments/:id/save-tasks-to-kb (homework-reuse-v1 TASK-5) ──
//
// Bulk-saves tasks из ДЗ в «Мою базу» репетитора (kb_tasks, owner_id=me).
// Reuse KB fingerprint dedup: if a task with the same fingerprint already
// exists in the tutor's base, мы возвращаем её как `already_in_base` вместо
// создания дубликата. Fingerprint закрывает все три провенанса ровно (KB→my,
// KB→catalog, ручной ввод) — не надо спец-кейсить `homework_kb_tasks` join.
//
// Field-parity fix (2026-06-03, Q1): rubric_text / rubric_image_urls ТЕПЕРЬ
// копируются в «Мою базу» (owner_id=me) — критерии нужны при переиспользовании
// (запрос Эмилии). Это НЕ отменяет anti-leak: moderation-триггеры публикации в
// Каталог (kb_publish_task / kb_resync_task) копируют явный список колонок без
// rubric_*, поэтому в общий Каталог (owner_id IS NULL) рубрика не попадает.
// check_format / cefr_level обратно в Базу НЕ дописываем (Q3, отложено).
//
// Spec: docs/delivery/features/homework-reuse-v1/spec.md AC-10..AC-13.

const MAX_SAVE_TO_KB_NEW_FOLDER_NAME_LEN = 120;
const MAX_SAVE_TO_KB_TASKS_PER_CALL = 50;

async function handleSaveTasksToKB(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  // Ownership check на ДЗ — без этого tutor-leak (сохранение чужих задач через URL).
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.task_ids) || b.task_ids.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "task_ids must be a non-empty array");
  }
  if (b.task_ids.length > MAX_SAVE_TO_KB_TASKS_PER_CALL) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `task_ids length must be ≤ ${MAX_SAVE_TO_KB_TASKS_PER_CALL}`,
    );
  }
  for (const tid of b.task_ids as unknown[]) {
    if (!isUUID(tid)) {
      return jsonError(cors, 400, "VALIDATION", "task_ids must contain valid UUIDs");
    }
  }
  const taskIds = Array.from(new Set(b.task_ids as string[]));

  const folderIdIn = b.folder_id;
  const newFolderNameIn = b.new_folder_name;
  const hasFolderId = isNonEmptyString(folderIdIn);
  const hasNewFolderName = isNonEmptyString(newFolderNameIn);

  if (!hasFolderId && !hasNewFolderName) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      "Either folder_id or new_folder_name is required",
    );
  }
  if (hasFolderId && !isUUID(folderIdIn)) {
    return jsonError(cors, 400, "VALIDATION", "folder_id must be a UUID");
  }
  if (
    hasNewFolderName &&
    (newFolderNameIn as string).trim().length > MAX_SAVE_TO_KB_NEW_FOLDER_NAME_LEN
  ) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `new_folder_name must be ≤ ${MAX_SAVE_TO_KB_NEW_FOLDER_NAME_LEN} chars`,
    );
  }

  // Step 1: resolve destination folder — validate existing или create new.
  let folderId: string;
  let folderName: string;
  let createdFolder: { id: string; name: string } | null = null;

  if (hasNewFolderName) {
    const nameTrimmed = (newFolderNameIn as string).trim();
    if (!nameTrimmed) {
      return jsonError(cors, 400, "VALIDATION", "new_folder_name must not be empty");
    }
    // Dedup by (owner_id, parent_id=NULL, name) — чтобы клик по «Создать новую
    // папку» дважды подряд не плодил «Физика» близнецов.
    const { data: existingFolders, error: existingErr } = await db
      .from("kb_folders")
      .select("id, name")
      .eq("owner_id", tutorUserId)
      .is("parent_id", null)
      .ilike("name", nameTrimmed);
    if (existingErr) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/save-tasks-to-kb",
        error: existingErr.message,
      });
      return jsonError(cors, 500, "DB_ERROR", "Failed to check existing folder");
    }
    const existing = (existingFolders ?? []).find(
      (f) =>
        typeof f.name === "string" &&
        f.name.trim().toLowerCase() === nameTrimmed.toLowerCase(),
    );
    if (existing) {
      folderId = existing.id as string;
      folderName = existing.name as string;
    } else {
      const { data: inserted, error: folderErr } = await db
        .from("kb_folders")
        .insert({
          owner_id: tutorUserId,
          parent_id: null,
          name: nameTrimmed,
        })
        .select("id, name")
        .single();
      if (folderErr || !inserted) {
        console.error("homework_api_request_error", {
          route: "POST /assignments/:id/save-tasks-to-kb",
          error: folderErr?.message,
        });
        return jsonError(cors, 500, "DB_ERROR", "Failed to create folder");
      }
      folderId = inserted.id as string;
      folderName = inserted.name as string;
      createdFolder = { id: folderId, name: folderName };
    }
  } else {
    // Validate ownership of provided folder_id (service_role обходит RLS).
    const { data: folderRow, error: folderErr } = await db
      .from("kb_folders")
      .select("id, name, owner_id")
      .eq("id", folderIdIn as string)
      .maybeSingle();
    if (folderErr || !folderRow) {
      return jsonError(cors, 404, "NOT_FOUND", "Folder not found");
    }
    if (folderRow.owner_id !== tutorUserId) {
      return jsonError(cors, 403, "FORBIDDEN", "Folder does not belong to you");
    }
    folderId = folderRow.id as string;
    folderName = folderRow.name as string;
  }

  // Step 2: fetch requested tasks, enforcing assignment ownership (already
  // verified выше, но explicit filter по assignment_id — защита от race,
  // если ДЗ удаляется одновременно с save).
  const { data: tasks, error: tasksErr } = await db
    .from("homework_tutor_tasks")
    .select(
      "id, order_num, task_text, task_image_url, correct_answer, solution_text, solution_image_urls, rubric_text, rubric_image_urls, " +
        // unified-task-model (2026-07-05): грейдинг-мета теперь едет в Базу
        // (закрывает потерю check_format/КИМ/критериев на save-back — Q3 снят).
        "max_score, check_format, task_kind, cefr_level, kim_number, grading_criteria_json",
    )
    .eq("assignment_id", assignmentId)
    .in("id", taskIds);
  if (tasksErr) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/save-tasks-to-kb",
      error: tasksErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks");
  }
  const tasksById = new Map<string, Record<string, unknown>>();
  for (const t of tasks ?? []) {
    tasksById.set(t.id as string, t as Record<string, unknown>);
  }

  // Step 3: для каждой задачи либо найти существующую через fingerprint,
  // либо заинсертить новую в выбранную папку. Fingerprint через rpc, чтобы
  // не переизобретать md5 (Deno WebCrypto его не отдаёт), и чтобы формула
  // оставалась идентичной moderation V2.
  const saved: Array<{
    task_id: string;
    kb_task_id: string;
    already_in_base: boolean;
    folder_id: string;
    folder_name: string;
  }> = [];
  const skipped: string[] = [];

  for (const taskId of taskIds) {
    const task = tasksById.get(taskId);
    if (!task) {
      skipped.push(taskId);
      continue;
    }

    // unified-task-model: текст коалесцируется как в конвертере (kb_snapshot),
    // чтобы fingerprint и записанная строка были консистентны.
    const taskText = isNonEmptyString(task.task_text) ? (task.task_text as string) : "[Задача на фото]";
    const correctAnswer = isString(task.correct_answer)
      ? (task.correct_answer as string)
      : "";
    const taskImageUrl = isString(task.task_image_url)
      ? (task.task_image_url as string)
      : "";
    const solutionText = isString(task.solution_text)
      ? (task.solution_text as string)
      : null;
    const solutionImageUrls = isString(task.solution_image_urls)
      ? (task.solution_image_urls as string)
      : null;
    // Field-parity fix (2026-06-03): рубрика теперь едет в «Мою базу» (Q1).
    const rubricText = isString(task.rubric_text) ? (task.rubric_text as string) : null;
    const rubricImageUrls = isString(task.rubric_image_urls)
      ? (task.rubric_image_urls as string)
      : null;

    const { data: fpData, error: fpErr } = await db.rpc("kb_normalize_fingerprint", {
      p_text: taskText,
      p_answer: correctAnswer,
      p_attachment_url: taskImageUrl,
    });
    if (fpErr || typeof fpData !== "string") {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/save-tasks-to-kb",
        error: fpErr?.message ?? "fingerprint_rpc_returned_non_string",
        task_id: taskId,
      });
      skipped.push(taskId);
      continue;
    }
    const fingerprint = fpData as string;

    const { data: existing, error: existingErr } = await db
      .from("kb_tasks")
      .select("id, folder_id, rubric_text, rubric_image_urls")
      .eq("owner_id", tutorUserId)
      .eq("fingerprint", fingerprint)
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/save-tasks-to-kb",
        error: existingErr.message,
        task_id: taskId,
      });
      skipped.push(taskId);
      continue;
    }
    if (existing) {
      // Resolve folder label, если существующая задача лежит в другой папке.
      // Если у неё folder_id IS NULL (orphaned, редкий случай) — показываем
      // выбранную папку назначения как fallback для UI.
      let existingFolderId = (existing.folder_id as string | null) ?? folderId;
      let existingFolderName = folderName;
      if (existing.folder_id && existing.folder_id !== folderId) {
        const { data: existingFolder } = await db
          .from("kb_folders")
          .select("id, name")
          .eq("id", existing.folder_id as string)
          .maybeSingle();
        if (existingFolder) {
          existingFolderId = existingFolder.id as string;
          existingFolderName = existingFolder.name as string;
        }
      }
      // Field-parity fix (2026-06-03, review P1-1): fingerprint считается по
      // text+answer+attachment (без рубрики), поэтому save-back той же задачи с
      // вновь добавленной рубрикой попадал в already_in_base и рубрику терял.
      // Fill-blank (НЕ перезатираем уже введённую тутором): дописываем rubric_*
      // на существующей записи только если там пусто, а во входящей — есть.
      const rubricPatch: Record<string, string> = {};
      if (!isNonEmptyString(existing.rubric_text) && isNonEmptyString(rubricText)) {
        rubricPatch.rubric_text = rubricText as string;
      }
      if (!isNonEmptyString(existing.rubric_image_urls) && isNonEmptyString(rubricImageUrls)) {
        rubricPatch.rubric_image_urls = rubricImageUrls as string;
      }
      if (Object.keys(rubricPatch).length > 0) {
        const { error: rubricUpdErr } = await db
          .from("kb_tasks")
          .update(rubricPatch)
          .eq("id", existing.id as string)
          .eq("owner_id", tutorUserId);
        if (rubricUpdErr) {
          console.warn("homework_api_save_kb_rubric_fill_failed", {
            route: "POST /assignments/:id/save-tasks-to-kb",
            error: rubricUpdErr.message,
            task_id: taskId,
          });
        }
      }
      // unified-task-model: retro-link провенанса — legacy-задача обретает
      // источник в Базе, «Обновить в Базе» начинает работать.
      await db
        .from("homework_tutor_tasks")
        .update({ source_kb_task_id: existing.id as string, source_kb_synced_at: new Date().toISOString() })
        .eq("id", taskId);
      saved.push({
        task_id: taskId,
        kb_task_id: existing.id as string,
        already_in_base: true,
        folder_id: existingFolderId,
        folder_name: existingFolderName,
      });
      continue;
    }

    // Копируем task_text, task_image_url, correct_answer, solution_text,
    // solution_image_urls + rubric_text/rubric_image_urls. `fingerprint`
    // сохраняем явно — чтобы при повторном save того же содержимого из другого
    // ДЗ уйти в already_in_base (вне зависимости от жизненного цикла ДЗ).
    //
    // Field-parity fix (2026-06-03, Q1): рубрика теперь сохраняется в «Мою базу»
    // (owner_id=me). Это НЕ утечка в общий Каталог — moderation-триггеры
    // (kb_publish_task / kb_resync_task) копируют явный список колонок без
    // rubric_*, поэтому каталожная копия (owner_id IS NULL) рубрику не несёт.
    // check_format / cefr_level в Базу обратно НЕ дописываем (Q3, отложено).
    // unified-task-model (2026-07-05): грейдинг-мета (check_format / task_kind /
    // cefr / № КИМ / критерии / балл→primary_score) теперь едет в Базу — Q3 снят.
    const kbRow = homeworkTaskFieldsToKbRow(task as Record<string, unknown>, {
      ownerId: tutorUserId,
      folderId,
      fingerprint,
    });
    const { data: inserted, error: insertErr } = await db
      .from("kb_tasks")
      .insert(kbRow)
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/save-tasks-to-kb",
        error: insertErr?.message,
        task_id: taskId,
      });
      skipped.push(taskId);
      continue;
    }

    // Retro-link провенанса (mirror already_in_base ветки).
    await db
      .from("homework_tutor_tasks")
      .update({ source_kb_task_id: inserted.id as string, source_kb_synced_at: new Date().toISOString() })
      .eq("id", taskId);

    saved.push({
      task_id: taskId,
      kb_task_id: inserted.id as string,
      already_in_base: false,
      folder_id: folderId,
      folder_name: folderName,
    });
  }

  // task_ids, которых нет в загруженных tasks (чужое ДЗ / удалённая задача),
  // тоже попадают в skipped — нижняя граница на случай пропуска выше.
  for (const taskId of taskIds) {
    if (!tasksById.has(taskId) && !skipped.includes(taskId)) {
      skipped.push(taskId);
    }
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments/:id/save-tasks-to-kb",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    saved_count: saved.length,
    skipped_count: skipped.length,
    already_in_base_count: saved.filter((s) => s.already_in_base).length,
  });
  return jsonOk(cors, {
    saved,
    skipped,
    created_folder: createdFolder,
  });
}

// ─── Endpoint: POST /assignments/:id/tasks/:taskId/push-to-kb ────────────────
//
// unified-task-model (2026-07-05): «Обновить в Базе» — diverged-снимок ДЗ
// пушится обратно в задачу-источник Базы (решение владельца №1: правки в
// конструкторе локальны, push — явное действие).
//   - Источник СВОЙ → UPDATE контента + всей AI-настройки + новый fingerprint
//     (resync-триггер сам синхронит каталожную копию опубликованного источника;
//     fingerprint-коллизия → 409 KB_DUPLICATE_BLOCKED).
//   - Источник КАТАЛОЖНЫЙ → copy-on-write: форк в личную Базу («Из ДЗ»,
//     fingerprint-дедуп) + relink провенанса. Ответ { forked: true }.
// Каскад-классификация (exam/difficulty/topic_id/subtopic_id/source_label) —
// presence-семантика (ревью-фикс P1 2026-07-06): конструктор F2 её редактирует,
// клиент шлёт ТОЛЬКО непустые значения (edit-prefill Базу не грузит — слепой
// null затёр бы тему источника); отсутствие ключа = «не трогай». Строка
// homework_tutor_tasks этих колонок не имеет → в merged `task` они появляются
// только из draft-body, что и даёт `key in t` в homeworkTaskFieldsToKbUpdate.
const PUSH_TO_KB_DRAFT_FIELDS = [
  "task_text", "task_image_url", "correct_answer", "max_score",
  "rubric_text", "rubric_image_urls", "solution_text", "solution_image_urls",
  "check_format", "task_kind", "cefr_level", "kim_number", "grading_criteria_json",
  "exam", "difficulty", "topic_id", "subtopic_id", "source_label",
] as const;

async function handleTaskPushToKb(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  taskId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Некорректный идентификатор задачи");
  }

  const { data: taskRow, error: taskErr } = await db
    .from("homework_tutor_tasks")
    .select(
      "id, task_text, task_image_url, correct_answer, max_score, rubric_text, rubric_image_urls, " +
        "solution_text, solution_image_urls, check_format, task_kind, cefr_level, kim_number, " +
        "grading_criteria_json, source_kb_task_id",
    )
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (taskErr || !taskRow) {
    return jsonError(cors, 404, "NOT_FOUND", "Задача не найдена");
  }

  // Опциональный body = ДРАФТ-поля из конструктора (пуш до сохранения ДЗ —
  // естественный флоу «поправил задачу → Обновить в Базе»). Whitelist-merge
  // поверх сохранённой строки; провенанс/ownership — всегда по строке.
  const task: Record<string, unknown> = { ...taskRow };
  if (body && typeof body === "object") {
    const draft = body as Record<string, unknown>;
    for (const key of PUSH_TO_KB_DRAFT_FIELDS) {
      if (key in draft) task[key] = draft[key];
    }
  }
  if (!isUUID(task.source_kb_task_id)) {
    return jsonError(
      cors,
      409,
      "NO_KB_SOURCE",
      "У задачи нет источника в Базе — используйте «Сохранить в мою базу»",
    );
  }

  const { data: kb, error: kbErr } = await db
    .from("kb_tasks")
    .select("id, owner_id, moderation_status")
    .eq("id", task.source_kb_task_id as string)
    .maybeSingle();
  if (kbErr || !kb) {
    return jsonError(cors, 409, "KB_SOURCE_MISSING", "Задача-источник удалена из Базы");
  }

  const taskText = isNonEmptyString(task.task_text) ? (task.task_text as string).trim() : "[Задача на фото]";
  const answer = isNonEmptyString(task.correct_answer) ? (task.correct_answer as string).trim() : "";
  const attachment = isNonEmptyString(task.task_image_url) ? (task.task_image_url as string).trim() : "";
  const fingerprint = await computeKbFingerprint(db, taskText, answer, attachment);
  if (!fingerprint) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось вычислить отпечаток задачи");
  }

  const syncedAt = new Date().toISOString();

  if (kb.owner_id === tutorUserId) {
    // Свой источник → прямой UPDATE (fingerprint пересчитан; resync-триггер
    // опубликованного источника может кинуть fingerprint collision).
    const { error: updErr } = await db
      .from("kb_tasks")
      .update(homeworkTaskFieldsToKbUpdate(task as Record<string, unknown>, fingerprint))
      .eq("id", kb.id as string)
      .eq("owner_id", tutorUserId);
    if (updErr) {
      const msg = updErr.message ?? "";
      if (/fingerprint|collision|duplicate/i.test(msg)) {
        return jsonError(
          cors,
          409,
          "KB_DUPLICATE_BLOCKED",
          "В Базе уже есть другая задача с таким же условием и ответом — обновление заблокировано",
        );
      }
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/tasks/:taskId/push-to-kb",
        error: msg,
      });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось обновить задачу в Базе");
    }
    await db
      .from("homework_tutor_tasks")
      .update({ source_kb_synced_at: syncedAt })
      .eq("id", taskId);
    return jsonOk(cors, { kb_task_id: kb.id, forked: false });
  }

  if (kb.owner_id === null) {
    // Каталожный источник → copy-on-write форк в личную Базу.
    const { data: existing } = await db
      .from("kb_tasks")
      .select("id")
      .eq("owner_id", tutorUserId)
      .eq("fingerprint", fingerprint)
      .limit(1)
      .maybeSingle();
    let personalId: string | null = existing ? (existing.id as string) : null;
    if (!personalId) {
      const folderId = await resolveOrCreateRootKbFolder(db, tutorUserId, KB_MIRROR_FOLDER_NAME);
      if (!folderId) {
        return jsonError(cors, 500, "DB_ERROR", "Не удалось создать папку в Базе");
      }
      // Каскад-классификация из draft-body (если прислана) едет и в форк —
      // строка homework_tutor_tasks её не несёт, поэтому берём из merged task.
      const row = homeworkTaskFieldsToKbRow(task as Record<string, unknown>, {
        ownerId: tutorUserId,
        folderId,
        fingerprint,
        exam: typeof task.exam === "string" ? task.exam : null,
        difficulty: typeof task.difficulty === "number" ? task.difficulty : null,
        topicId: typeof task.topic_id === "string" && task.topic_id ? task.topic_id : null,
        subtopicId: typeof task.subtopic_id === "string" && task.subtopic_id ? task.subtopic_id : null,
        sourceLabel: typeof task.source_label === "string" ? task.source_label : null,
      });
      const { data: inserted, error: insErr } = await db
        .from("kb_tasks")
        .insert(row)
        .select("id")
        .single();
      if (insErr || !inserted) {
        console.error("homework_api_request_error", {
          route: "POST /assignments/:id/tasks/:taskId/push-to-kb",
          error: insErr?.message,
        });
        return jsonError(cors, 500, "DB_ERROR", "Не удалось создать копию задачи в Базе");
      }
      personalId = inserted.id as string;
    }
    await db
      .from("homework_tutor_tasks")
      .update({ source_kb_task_id: personalId, source_kb_synced_at: syncedAt })
      .eq("id", taskId);
    return jsonOk(cors, { kb_task_id: personalId, forked: true });
  }

  // Чужая личная задача (не должно случаться — defensive).
  return jsonError(cors, 403, "FORBIDDEN", "Задача-источник принадлежит другому репетитору");
}

// ─── Homework share links (homework-reuse-v1 TASK-7) ─────────────────────────
//
// Tutor управляет публичными read-only ссылками /p/:slug на своё ДЗ.
// Публичное чтение — через отдельный edge function `public-homework-share`
// (TASK-4) под service_role. Эти три handler'а — tutor-only.

const SHARE_LINK_SLUG_RE = /^[a-z0-9]{8}$/i;
const SHARE_LINK_SLUG_MAX_RETRIES = 3;
const SHARE_LINK_EXPIRY_MAX_DAYS = 365;

function generateShareLinkSlug(): string {
  // base36-ish 8 chars via hex slice of UUID: low-effort but >2.8T namespace.
  // RFC 4122 UUIDs are strong-enough random — no need for extra entropy.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
}

function getShareLinkAppBaseUrl(): string {
  return (
    Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
    "https://sokratai.ru"
  );
}

async function handleCreateShareLink(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isBoolean(b.show_answers)) {
    return jsonError(cors, 400, "VALIDATION", "show_answers must be a boolean");
  }
  if (!isBoolean(b.show_solutions)) {
    return jsonError(cors, 400, "VALIDATION", "show_solutions must be a boolean");
  }

  let expiresAtIso: string | null = null;
  if (b.expires_in_days !== undefined && b.expires_in_days !== null) {
    if (!isPositiveInt(b.expires_in_days) || b.expires_in_days > SHARE_LINK_EXPIRY_MAX_DAYS) {
      return jsonError(
        cors,
        400,
        "VALIDATION",
        `expires_in_days must be a positive integer ≤ ${SHARE_LINK_EXPIRY_MAX_DAYS}`,
      );
    }
    const expiresAt = new Date(Date.now() + (b.expires_in_days as number) * 24 * 60 * 60 * 1000);
    expiresAtIso = expiresAt.toISOString();
  }

  // Slug collision retry — UNIQUE constraint violation → retry ≤3 раз.
  for (let attempt = 0; attempt < SHARE_LINK_SLUG_MAX_RETRIES; attempt++) {
    const slug = generateShareLinkSlug();
    const { data, error } = await db
      .from("homework_share_links")
      .insert({
        slug,
        assignment_id: assignmentId,
        show_answers: b.show_answers,
        show_solutions: b.show_solutions,
        expires_at: expiresAtIso,
        created_by: tutorUserId,
      })
      .select("slug, show_answers, show_solutions, expires_at, created_at")
      .single();

    if (!error && data) {
      const url = `${getShareLinkAppBaseUrl()}/p/${data.slug}`;
      return jsonOk(
        cors,
        {
          slug: data.slug,
          url,
          show_answers: data.show_answers,
          show_solutions: data.show_solutions,
          expires_at: data.expires_at,
          created_at: data.created_at,
        },
        201,
      );
    }

    const message = (error?.message ?? "").toLowerCase();
    const isUniqueViolation =
      message.includes("duplicate key") ||
      message.includes("unique constraint") ||
      (error as unknown as { code?: string })?.code === "23505";

    if (!isUniqueViolation) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/share-links",
        error: error?.message,
      });
      return jsonError(cors, 500, "DB_ERROR", "Failed to create share link");
    }
    // else — loop another slug
  }

  console.error("homework_api_request_error", {
    route: "POST /assignments/:id/share-links",
    error: "slug_collision_exhausted",
  });
  return jsonError(cors, 500, "DB_ERROR", "Failed to generate unique share link");
}

async function handleListShareLinks(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data, error } = await db
    .from("homework_share_links")
    .select("slug, show_answers, show_solutions, expires_at, created_at")
    .eq("assignment_id", assignmentId)
    .eq("created_by", tutorUserId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("homework_api_request_error", {
      route: "GET /assignments/:id/share-links",
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to list share links");
  }

  const base = getShareLinkAppBaseUrl();
  const items = (data ?? []).map((row) => ({
    slug: row.slug,
    url: `${base}/p/${row.slug}`,
    show_answers: row.show_answers,
    show_solutions: row.show_solutions,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }));

  return jsonOk(cors, { items });
}

async function handleDeleteShareLink(
  db: SupabaseClient,
  tutorUserId: string,
  slug: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!SHARE_LINK_SLUG_RE.test(slug)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid slug format");
  }

  // Ownership-check via created_by in the DELETE filter — bypasses any row the
  // tutor doesn't own. `.select()` after delete returns the removed rows so we
  // can disambiguate "not found" from "not yours" → both map to 404 (don't
  // leak existence of other tutors' slugs).
  const { data, error } = await db
    .from("homework_share_links")
    .delete()
    .eq("slug", slug.toLowerCase())
    .eq("created_by", tutorUserId)
    .select("slug");

  if (error) {
    console.error("homework_api_request_error", {
      route: "DELETE /share-links/:slug",
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete share link");
  }

  if (!data || data.length === 0) {
    return jsonError(cors, 404, "NOT_FOUND", "Share link not found");
  }

  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: DELETE /assignments/:id ─────────────────────────────────────

async function handleDeleteAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: taskRows, error: taskRowsError } = await db
    .from("homework_tutor_tasks")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (taskRowsError) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: taskRowsError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }
  const taskIds = (taskRows ?? []).map((row) => row.id);

  const { data: studentAssignmentRows, error: studentAssignmentRowsError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (studentAssignmentRowsError) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: studentAssignmentRowsError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }
  const studentAssignmentIds = (studentAssignmentRows ?? []).map((row) => row.id);

  let threadIds: string[] = [];
  let threadAttachmentValues: unknown[] = [];
  if (studentAssignmentIds.length > 0) {
    const { data: threadRows, error: threadRowsError } = await db
      .from("homework_tutor_threads")
      .select("id")
      .in("student_assignment_id", studentAssignmentIds);

    if (threadRowsError) {
      console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: threadRowsError.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
    }

    threadIds = (threadRows ?? []).map((row) => row.id);
  }

  if (threadIds.length > 0) {
    const { data: threadMessages, error: threadMessagesError } = await db
      .from("homework_tutor_thread_messages")
      .select("image_url")
      .in("thread_id", threadIds)
      .not("image_url", "is", null);
    if (threadMessagesError) {
      console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: threadMessagesError.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
    }
    threadAttachmentValues = (threadMessages ?? []).map((row) => row.image_url);
  }

  const deleteByAssignment = async (table: string) => {
    const { error } = await db.from(table).delete().eq("assignment_id", assignmentId);
    if (error) throw error;
  };

  try {
    await cleanupThreadAttachmentRefs(db, threadAttachmentValues);

    if (threadIds.length > 0) {
      const { error: deleteThreadMessagesError } = await db
        .from("homework_tutor_thread_messages")
        .delete()
        .in("thread_id", threadIds);
      if (deleteThreadMessagesError) throw deleteThreadMessagesError;

      const { error: deleteTaskStatesByThreadError } = await db
        .from("homework_tutor_task_states")
        .delete()
        .in("thread_id", threadIds);
      if (deleteTaskStatesByThreadError) throw deleteTaskStatesByThreadError;
    }

    if (taskIds.length > 0) {
      const { error: deleteTaskStatesByTaskError } = await db
        .from("homework_tutor_task_states")
        .delete()
        .in("task_id", taskIds);
      if (deleteTaskStatesByTaskError) throw deleteTaskStatesByTaskError;
    }

    if (threadIds.length > 0) {
      const { error: deleteThreadsError } = await db
        .from("homework_tutor_threads")
        .delete()
        .in("id", threadIds);
      if (deleteThreadsError) throw deleteThreadsError;
    }

    await deleteByAssignment("homework_tutor_student_assignments");
    await deleteByAssignment("homework_tutor_materials");
    await deleteByAssignment("homework_tutor_reminder_log");
    await deleteByAssignment("homework_tutor_tasks");

    const { error } = await db
      .from("homework_tutor_assignments")
      .delete()
      .eq("id", assignmentId);

    if (error) {
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }


  console.log("homework_api_request_success", {
    route: "DELETE /assignments/:id",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });
  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: POST /assignments/:id/materials ───────────────────────────────

async function handleAddMaterial(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const validTypes = ["pdf", "image", "link"] as const;
  if (!isNonEmptyString(b.type) || !validTypes.includes(b.type as typeof validTypes[number])) {
    return jsonError(cors, 400, "VALIDATION", "type must be one of: pdf, image, link");
  }
  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required");
  }

  const materialType = b.type as string;
  if (materialType === "link" && !isNonEmptyString(b.url)) {
    return jsonError(cors, 400, "VALIDATION", "url is required for link type");
  }
  if ((materialType === "pdf" || materialType === "image") && !isNonEmptyString(b.storage_ref)) {
    return jsonError(cors, 400, "VALIDATION", "storage_ref is required for pdf/image type");
  }

  const { data, error } = await db
    .from("homework_tutor_materials")
    .insert({
      assignment_id: assignmentId,
      type: materialType,
      title: (b.title as string).trim(),
      storage_ref: isNonEmptyString(b.storage_ref) ? (b.storage_ref as string).trim() : null,
      url: isNonEmptyString(b.url) ? (b.url as string).trim() : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("homework_api_request_error", { route: "POST /assignments/:id/materials", error: error?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to add material");
  }

  return jsonOk(cors, { material_id: data.id }, 201);
}

// ─── Endpoint: DELETE /assignments/:id/materials/:mid ────────────────────────

async function handleDeleteMaterial(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  materialId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!isUUID(materialId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid material ID format");
  }

  const { data: existing } = await db
    .from("homework_tutor_materials")
    .select("id")
    .eq("id", materialId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!existing) {
    return jsonError(cors, 404, "NOT_FOUND", "Material not found");
  }

  const { error } = await db
    .from("homework_tutor_materials")
    .delete()
    .eq("id", materialId);

  if (error) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id/materials/:mid", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete material");
  }

  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: GET /assignments/:id/materials/:mid/signed-url ────────────────

async function handleMaterialSignedUrl(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  materialId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!isUUID(materialId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid material ID format");
  }

  const { data: material } = await db
    .from("homework_tutor_materials")
    .select("id, type, storage_ref, url")
    .eq("id", materialId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!material) {
    return jsonError(cors, 404, "NOT_FOUND", "Material not found");
  }

  if (material.type === "link") {
    return jsonOk(cors, { url: material.url });
  }

  if (!material.storage_ref) {
    return jsonError(cors, 400, "NO_STORAGE_REF", "Material has no storage reference");
  }

  // Parse storage://bucket/objectPath
  const storageRef = material.storage_ref as string;
  let bucket: string;
  let objectPath: string;

  if (storageRef.startsWith("storage://")) {
    const rest = storageRef.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      return jsonError(cors, 500, "INVALID_STORAGE_REF", "Cannot parse storage reference");
    }
    bucket = rest.slice(0, slashIdx);
    objectPath = rest.slice(slashIdx + 1);
  } else {
    bucket = "homework-materials";
    objectPath = storageRef;
  }

  const { data: signedData, error: signedErr } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, 3600);

  if (signedErr || !signedData?.signedUrl) {
    console.error("homework_api_request_error", { route: "GET /materials/signed-url", error: signedErr?.message });
    return jsonError(cors, 500, "STORAGE_ERROR", "Failed to generate signed URL");
  }

  return jsonOk(cors, { url: rewriteToProxy(signedData.signedUrl) });
}

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket: string,
): { bucket: string; objectPath: string } | null {
  if (!isNonEmptyString(value)) return null;
  const trimmed = value.trim();

  if (trimmed.startsWith("storage://")) {
    const rest = trimmed.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx <= 0 || slashIdx === rest.length - 1) {
      return null;
    }
    const objectPath = rest.slice(slashIdx + 1).replace(/^\/+/, "");
    if (!objectPath || hasUnsafeObjectPath(objectPath)) {
      return null;
    }
    return {
      bucket: rest.slice(0, slashIdx),
      objectPath,
    };
  }

  if (hasUnsafeObjectPath(trimmed)) {
    return null;
  }

  return {
    bucket: defaultBucket,
    objectPath: trimmed.replace(/^\/+/, ""),
  };
}

function isValidStudentThreadAttachmentRef(
  storageRef: string,
  userId: string,
  assignmentId: string,
  allowedExtensions: Set<string> = THREAD_ATTACHMENT_EXTENSIONS,
): boolean {
  if (!storageRef.trim().startsWith("storage://")) {
    return false;
  }

  const parsed = parseStorageRef(storageRef, "homework-submissions");
  if (!parsed?.bucket || !parsed.objectPath) {
    return false;
  }

  if (!THREAD_ATTACHMENT_BUCKETS.has(parsed.bucket)) {
    return false;
  }

  if (hasUnsafeObjectPath(parsed.objectPath)) {
    return false;
  }

  const extension = getThreadAttachmentExtension(storageRef);
  if (!allowedExtensions.has(extension)) {
    return false;
  }

  return parsed.objectPath.startsWith(`${userId}/${assignmentId}/threads/`);
}

function extractStudentThreadAttachmentRefs(
  body: Record<string, unknown>,
  userId: string,
  assignmentId: string,
  cors: Record<string, string>,
  allowedExtensions: Set<string> = THREAD_ATTACHMENT_EXTENSIONS,
): string[] | Response {
  let refs: string[] = [];

  if (Array.isArray(body.image_urls) && body.image_urls.length > 0) {
    if (!body.image_urls.every((item) => typeof item === "string")) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "image_urls must be an array of strings");
    }
    refs = normalizeThreadAttachmentRefs(body.image_urls as string[]);
  } else {
    refs = parseStoredThreadAttachmentRefs(body.image_url);
  }

  if (refs.length > MAX_THREAD_ATTACHMENTS) {
    return jsonError(
      cors,
      400,
      "TOO_MANY_ATTACHMENTS",
      `Maximum ${MAX_THREAD_ATTACHMENTS} attachments are allowed`,
    );
  }

  for (const ref of refs) {
    if (!isValidStudentThreadAttachmentRef(ref, userId, assignmentId, allowedExtensions)) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "Invalid attachment reference");
    }
  }

  return refs;
}

async function createSignedStorageUrl(
  db: SupabaseClient,
  storageRef: string | null | undefined,
  defaultBucket: string,
): Promise<string | null> {
  const parsed = parseStorageRef(storageRef, defaultBucket);
  if (!parsed?.bucket || !parsed.objectPath) {
    return null;
  }

  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 3600);

  if (error || !data?.signedUrl) {
    console.error("homework_api_signed_url_failed", {
      bucket: parsed.bucket,
      objectPath: parsed.objectPath,
      error: error?.message,
    });
    return null;
  }

  return rewriteToProxy(data.signedUrl);
}

async function getReadableAssignmentOrThrow(
  db: SupabaseClient,
  assignmentId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<{ id: string; tutor_id: string } | Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID format");
  }

  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("id, tutor_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  if (assignment.tutor_id === userId) {
    return assignment;
  }

  const { data: studentAssignment } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();

  if (!studentAssignment) {
    return jsonError(cors, 403, "FORBIDDEN", "Not authorized to access this assignment");
  }

  return assignment;
}

async function createSignedStorageUrls(
  db: SupabaseClient,
  refs: string[],
  defaultBucket: string,
): Promise<string[]> {
  const signedUrls = await Promise.all(
    refs.map((ref) => createSignedStorageUrl(db, ref, defaultBucket)),
  );
  return signedUrls.filter((value): value is string => Boolean(value));
}

interface GuidedTaskIdentityRow {
  id: string;
  order_num: number;
  max_score?: number | null;
}

function resolveTaskReference(
  tasks: GuidedTaskIdentityRow[],
  options: {
    taskId?: string | null;
    taskOrder?: number | null;
    fallbackTaskId?: string | null;
    fallbackTaskOrder?: number | null;
  },
): GuidedTaskIdentityRow | null {
  const orderedCandidates = [
    options.taskId && isUUID(options.taskId) ? tasks.find((task) => task.id === options.taskId) ?? null : null,
    typeof options.taskOrder === "number" ? tasks.find((task) => task.order_num === options.taskOrder) ?? null : null,
    options.fallbackTaskId && isUUID(options.fallbackTaskId)
      ? tasks.find((task) => task.id === options.fallbackTaskId) ?? null
      : null,
    typeof options.fallbackTaskOrder === "number"
      ? tasks.find((task) => task.order_num === options.fallbackTaskOrder) ?? null
      : null,
  ];

  return orderedCandidates.find((task): task is GuidedTaskIdentityRow => Boolean(task)) ?? null;
}

async function syncThreadCursorOrdersForAssignment(
  db: SupabaseClient,
  assignmentId: string,
): Promise<void> {
  const { data: studentAssignments, error: saErr } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (saErr || !studentAssignments || studentAssignments.length === 0) return;

  const studentAssignmentIds = studentAssignments.map((row) => row.id as string);
  const { data: threads, error: threadErr } = await db
    .from("homework_tutor_threads")
    .select("id, current_task_id, current_task_order")
    .in("student_assignment_id", studentAssignmentIds)
    .not("current_task_id", "is", null);
  if (threadErr || !threads || threads.length === 0) return;

  const { data: tasks, error: taskErr } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", assignmentId);
  if (taskErr || !tasks) return;

  const orderByTaskId = new Map(tasks.map((task) => [task.id as string, task.order_num as number]));
  for (const thread of threads) {
    const taskId = thread.current_task_id as string | null;
    if (!taskId) continue;
    const nextOrder = orderByTaskId.get(taskId);
    if (typeof nextOrder !== "number" || nextOrder === thread.current_task_order) continue;

    await db
      .from("homework_tutor_threads")
      .update({
        current_task_order: nextOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", thread.id);
  }
}

async function loadLatestStudentImageUrlsForTask(
  db: SupabaseClient,
  threadId: string,
  taskOrder: number,
  taskId: string,
  userId: string,
  assignmentId: string,
): Promise<string[]> {
  const { data: latestMsg, error } = await db
    .from("homework_tutor_thread_messages")
    .select("image_url")
    .eq("thread_id", threadId)
    .eq("role", "user")
    .eq("task_id", taskId)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("homework_api_latest_student_image_failed", {
      threadId,
      taskOrder,
      error: error.message,
    });
    return [];
  }

  const imageRefs = parseStoredThreadAttachmentRefs(latestMsg?.image_url)
    .filter(isImageThreadAttachmentRef)
    .filter((ref) => isValidStudentThreadAttachmentRef(ref, userId, assignmentId));

  if (imageRefs.length === 0) return [];

  const signedUrls = await Promise.all(imageRefs.map(async (imageRef) => {
    if (imageRef.startsWith("http://")) {
      console.warn("homework_api_latest_student_image_rejected", {
        reason: "non_https_url",
        threadId,
        taskOrder,
      });
      return null;
    }
    if (imageRef.startsWith("https://")) {
      // Accept both direct supabase.co AND api.sokratai.ru proxy hosts.
      // After Phase B migration frontend stores proxy URLs in DB.
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const isAllowedSignedUrl =
        (supabaseUrl && imageRef.startsWith(`${supabaseUrl}/storage/v1/object/sign/`)) ||
        imageRef.startsWith(`${SUPABASE_PROXY_URL}/storage/v1/object/sign/`);
      if (isAllowedSignedUrl) {
        return imageRef;
      }
      console.warn("homework_api_latest_student_image_rejected", {
        reason: "external_https_url",
        threadId,
        taskOrder,
      });
      return null;
    }

    return await createSignedStorageUrl(db, imageRef, "homework-submissions");
  }));

  return signedUrls.filter((value): value is string => Boolean(value));
}

// ─── Helper: resolve task image URL to an AI-compatible data URL ─────────────

/** Convert ArrayBuffer to base64 string in chunks to avoid stack overflow on large images. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB chunks
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Max image size (5 MB raw ≈ 6.7 MB base64) to stay within gateway body limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Converts a task_image_url (storage:// or plain storage path)
 * into a base64 data URL that the Lovable AI Gateway can use directly.
 *
 * The Lovable gateway (proxying Gemini) does NOT fetch external HTTP URLs —
 * images must be inlined as `data:image/...;base64,...`.
 *
 * SECURITY: External HTTP(S) URLs are rejected to prevent SSRF.
 * task_image_url must always be a storage:// ref or plain storage path.
 *
 * Returns null if the image ref is empty, external, or download fails.
 */
async function resolveTaskImageUrlForAI(
  db: SupabaseClient,
  imageRef: string | null | undefined,
): Promise<string | null> {
  if (!imageRef) return null;

  // SECURITY: reject external URLs to prevent SSRF — task images must live in storage
  if (imageRef.startsWith("http://") || imageRef.startsWith("https://")) {
    console.error("resolveTaskImageUrlForAI: external URLs not allowed (SSRF prevention)", {
      imageRef: imageRef.slice(0, 120),
    });
    return null;
  }

  // Parse storage://bucket/objectPath or plain path
  let bucket: string;
  let objectPath: string;

  if (imageRef.startsWith("storage://")) {
    const rest = imageRef.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      console.error("resolveTaskImageUrlForAI: cannot parse storage ref", { imageRef });
      return null;
    }
    bucket = rest.slice(0, slashIdx);
    objectPath = rest.slice(slashIdx + 1);
  } else {
    bucket = "homework-task-images";
    objectPath = imageRef;
  }

  // Download directly from Supabase storage (service_role client — no signed URL needed)
  const { data: blob, error: dlErr } = await db.storage
    .from(bucket)
    .download(objectPath);

  if (dlErr || !blob) {
    console.error("resolveTaskImageUrlForAI: failed to download", {
      bucket,
      objectPath,
      error: dlErr?.message,
    });
    return null;
  }

  const buf = await blob.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    console.error("resolveTaskImageUrlForAI: image too large", {
      bucket,
      objectPath,
      bytes: buf.byteLength,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return null;
  }

  const mime = blob.type || "image/jpeg";

  // Skip SVG: Lovable AI Gateway / Gemini multimodal does not support image/svg+xml
  // and rejects it with HTTP 400 "Unsupported MIME type". Fall back to text-only AI
  // (deterministic short-answer match still works via correct_answer).
  const lowerPath = objectPath.toLowerCase();
  let isSvg = mime === "image/svg+xml" || lowerPath.endsWith(".svg");
  if (!isSvg && buf.byteLength >= 5) {
    const head = new TextDecoder("utf-8", { fatal: false })
      .decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 256)))
      .trimStart()
      .toLowerCase();
    if (head.startsWith("<?xml") || head.startsWith("<svg")) {
      isSvg = true;
    }
  }
  if (isSvg) {
    console.warn("homework_api_inline_image_skipped", {
      reason: "unsupported_svg",
      bucket,
      objectPath,
      mime,
      bytes: buf.byteLength,
    });
    return null;
  }

  console.info("homework_api_inline_image_resolved", {
    bucket,
    objectPath,
    mime,
    bytes: buf.byteLength,
  });
  return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
}

async function resolveTaskImageUrlsForAI(
  db: SupabaseClient,
  imageRefsValue: string | null | undefined,
): Promise<string[]> {
  const imageRefs = parseAttachmentUrls(imageRefsValue);
  if (imageRefs.length === 0) return [];

  const resolvedUrls = await Promise.all(
    imageRefs.map((imageRef) => resolveTaskImageUrlForAI(db, imageRef)),
  );

  return resolvedUrls.filter((value): value is string => Boolean(value));
}

type TutorThreadProfile = {
  display_name: string;
  avatar_url: string | null;
  gender: "male" | "female" | null;
};

async function resolveTutorProfileForAssignment(
  db: SupabaseClient,
  assignmentId: string,
): Promise<TutorThreadProfile | null> {
  try {
    const { data: assignment } = await db
      .from("homework_tutor_assignments")
      .select("tutor_id")
      .eq("id", assignmentId)
      .maybeSingle();
    const tutorUserId = typeof assignment?.tutor_id === "string"
      ? assignment.tutor_id
      : null;
    if (!tutorUserId) return null;

    const { data: tutor } = await db
      .from("tutors")
      .select("name, avatar_url, gender")
      .eq("user_id", tutorUserId)
      .maybeSingle();

    const tutorName = typeof tutor?.name === "string" ? tutor.name.trim() : "";
    const avatarUrl = typeof tutor?.avatar_url === "string" && tutor.avatar_url.trim()
      ? tutor.avatar_url.trim()
      : null;
    const gender = tutor?.gender === "male" || tutor?.gender === "female"
      ? tutor.gender
      : null;

    if (tutorName) {
      return {
        display_name: tutorName,
        avatar_url: avatarUrl,
        gender,
      };
    }

    const { data: profile } = await db
      .from("profiles")
      .select("username")
      .eq("id", tutorUserId)
      .maybeSingle();
    const username = typeof profile?.username === "string" ? profile.username.trim() : "";
    if (!username) return null;

    return {
      display_name: username,
      avatar_url: avatarUrl,
      gender,
    };
  } catch (err) {
    console.warn("resolve_tutor_profile_failed", {
      assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Resolve a tutor-curated display name for the student behind a given
 * `homework_tutor_student_assignments.id`. Used to inject the student's
 * name into AI prompts so the model uses the correct Russian gender form.
 *
 * Resolution order:
 *   1. tutor_students.display_name (tutor-owned override for the student)
 *   2. profiles.username (the login-visible display name)
 *   3. null — when only an auto-generated placeholder like
 *      "telegram_776836955" or "user_123" is available (AI should fall
 *      back to gender-neutral forms instead of addressing the student by
 *      a machine-generated id).
 *
 * All queries use the `SupabaseClient` passed in (service_role inside the
 * edge function), so RLS is bypassed for the lookup.
 */
async function resolveStudentDisplayName(
  db: SupabaseClient,
  studentAssignmentId: string,
): Promise<string | null> {
  const identity = await resolveStudentIdentity(db, studentAssignmentId);
  return identity.name;
}

/**
 * Phase 8 (2026-05-20) — extended resolver, returns BOTH name AND gender.
 * Gender используется в `buildStudentNameGuidance` для **explicit** conjugation
 * («ты подставил» vs «ты подставила») вместо AI guess by name (которое
 * fails для иностранных имён / latin spelling / gender-neutral имён).
 *
 * Priority chain (mirror display_name):
 *   1. tutor_students.gender (tutor-curated, primary)
 *   2. profiles.gender (student selected at signup, fallback)
 *   3. null (AI uses neutral forms or guesses)
 *
 * Name + gender resolved параллельно — оба поля tutor-curated, fetch'ятся
 * через серию point-lookups (Postgres не транзакционно, но consistency не
 * критична для prompt-build path).
 *
 * Per-stage error logging (Phase 8.1 polish): каждая DB query логирует свой
 * error отдельно, чтобы DB/schema проблемы не выглядели как «unset identity».
 */
type StudentGender = "male" | "female" | null;

/**
 * subject-personalization Ф5 (2026-07-23): резолвер дополнительно собирает
 * педагогический контекст (класс/тип/цель из profiles — та же строка, что и
 * fallback-имя, лишних запросов нет). Контекст идёт ТОЛЬКО в AI-промпты
 * (тон объяснений, НЕ оценка — _shared/learning-context.ts); в client-ответы
 * identity-полей НЕ добавлять (анти-leak: существующие вызыватели читают
 * только name/gender).
 */
async function resolveStudentIdentity(
  db: SupabaseClient,
  studentAssignmentId: string,
): Promise<{
  name: string | null;
  gender: StudentGender;
  learningContext: LearningContext | null;
}> {
  try {
    const { data: sa, error: saErr } = await db
      .from("homework_tutor_student_assignments")
      .select("student_id, assignment_id")
      .eq("id", studentAssignmentId)
      .maybeSingle();
    if (saErr) {
      console.warn("resolve_student_identity_sa_lookup_failed", {
        studentAssignmentId,
        error: saErr.message,
      });
    }
    const studentId = sa?.student_id as string | undefined;
    const assignmentId = sa?.assignment_id as string | undefined;
    if (!studentId || !assignmentId) {
      return { name: null, gender: null, learningContext: null };
    }

    const { data: assn, error: assnErr } = await db
      .from("homework_tutor_assignments")
      .select("tutor_id")
      .eq("id", assignmentId)
      .maybeSingle();
    if (assnErr) {
      console.warn("resolve_student_identity_assignment_lookup_failed", {
        studentAssignmentId,
        assignmentId,
        error: assnErr.message,
      });
    }
    const tutorId = assn?.tutor_id as string | undefined;

    // Priority chain для name + gender:
    //   1. tutor_students.display_name + gender (tutor-curated, primary)
    //   2. profiles.full_name / profiles.gender (signup data, secondary)
    //   3. profiles.username для name (filtered)
    //   4. null fallback (caller handles)

    let resolvedName: string | null = null;
    let curatedGender: StudentGender = null;

    if (tutorId) {
      // КРИТИЧНО (AGENTS.md FK tutor_id + .claude/rules/40-homework-system.md Phase 8): homework_tutor_assignments.tutor_id хранит
      // `auth.users.id`, но `tutor_students.tutor_id` ссылается на `public.tutors.id`
      // (PK). Без явной конвертации lookup ВСЕГДА возвращает null → tutor-curated
      // display_name/gender игнорируются (наблюдаемый regression 2026-05-26).
      const { data: tutorRow, error: tutorRowErr } = await db
        .from("tutors")
        .select("id")
        .eq("user_id", tutorId)
        .maybeSingle();
      if (tutorRowErr) {
        console.warn("resolve_student_identity_tutor_pk_lookup_failed", {
          studentAssignmentId,
          tutorAuthUserId: tutorId,
          error: tutorRowErr.message,
        });
      }
      const tutorPkId = tutorRow?.id as string | undefined;
      if (tutorPkId) {
        const { data: ts, error: tsErr } = await db
          .from("tutor_students")
          .select("display_name, gender")
          .eq("tutor_id", tutorPkId)
          .eq("student_id", studentId)
          .maybeSingle();
        if (tsErr) {
          console.warn("resolve_student_identity_tutor_students_lookup_failed", {
            studentAssignmentId,
            tutorPkId,
            error: tsErr.message,
          });
        }
        const curated = typeof ts?.display_name === "string" ? ts.display_name.trim() : "";
        if (curated) resolvedName = curated;
        const tg = typeof ts?.gender === "string" ? ts.gender : null;
        if (tg === "male" || tg === "female") curatedGender = tg;
      }
    }

    // Always read profiles for fallback name + fallback gender + pedagogy
    // context (Ф5: grade/learner_type/learning_goal — тон, не оценка).
    const { data: prof, error: profErr } = await db
      .from("profiles")
      .select("full_name, username, gender, grade, learner_type, learning_goal")
      .eq("id", studentId)
      .maybeSingle();
    if (profErr) {
      console.warn("resolve_student_identity_profiles_lookup_failed", {
        studentAssignmentId,
        studentId,
        error: profErr.message,
      });
    }

    if (!resolvedName) {
      const fullName = typeof prof?.full_name === "string" ? prof.full_name.trim() : "";
      if (fullName) {
        resolvedName = fullName;
      } else {
        const username = typeof prof?.username === "string" ? prof.username.trim() : "";
        if (username && !/^(telegram_|user_)\d+$/i.test(username)) {
          resolvedName = username;
        }
      }
    }

    // Fallback gender: profiles.gender (only if tutor_students.gender отсутствует).
    let resolvedGender: StudentGender = curatedGender;
    if (!resolvedGender && typeof prof?.gender === "string") {
      const pg = prof.gender;
      if (pg === "male" || pg === "female") resolvedGender = pg;
    }

    return {
      name: resolvedName,
      gender: resolvedGender,
      learningContext: prof ? buildLearningContext(prof) : null,
    };
  } catch (err) {
    // Non-fatal: AI should still work without name/gender.
    console.warn("resolve_student_identity_failed", {
      studentAssignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { name: null, gender: null, learningContext: null };
  }
}

async function ensureTaskOcrText(
  _db: SupabaseClient,
  task: { id: string; task_image_url: string | null; ocr_text?: string | null },
  _subject: string | null | undefined,
): Promise<string | null> {
  if (typeof task.ocr_text === "string" && task.ocr_text.trim() && task.ocr_text !== "[неразборчиво]") {
    return task.ocr_text.trim();
  }

  // OCR recognition path was removed with the classic-mode vision_checker.
  // Guided check/hint will fall back to the task image without OCR text.
  return null;
}

// ─── Endpoint: GET /assignments/:id/tasks/:taskId/image-url ──────────────────

async function handleTaskImageSignedUrl(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  const assignmentOrErr = await getReadableAssignmentOrThrow(db, assignmentId, userId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  // Get task image URL
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, task_image_url")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!task) {
    return jsonError(cors, 404, "NOT_FOUND", "Task not found");
  }

  if (!task.task_image_url) {
    return jsonError(cors, 400, "NO_IMAGE", "Task has no image");
  }

  const imageRef = task.task_image_url as string;

  // External URL — return as-is
  if (imageRef.startsWith("http://") || imageRef.startsWith("https://")) {
    return jsonOk(cors, { url: imageRef });
  }

  // Parse storage://bucket/objectPath
  let bucket: string;
  let objectPath: string;

  if (imageRef.startsWith("storage://")) {
    const rest = imageRef.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      return jsonError(cors, 500, "INVALID_STORAGE_REF", "Cannot parse storage reference");
    }
    bucket = rest.slice(0, slashIdx);
    objectPath = rest.slice(slashIdx + 1);
  } else {
    bucket = "homework-task-images";
    objectPath = imageRef;
  }

  const { data: signedData, error: signedErr } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, 3600);

  if (signedErr || !signedData?.signedUrl) {
    console.error("homework_api_request_error", { route: "GET /tasks/image-url", error: signedErr?.message });
    return jsonError(cors, 500, "STORAGE_ERROR", "Failed to generate signed URL");
  }

  return jsonOk(cors, { url: rewriteToProxy(signedData.signedUrl) });
}

async function handleTaskImagesSignedUrls(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  const assignmentOrErr = await getReadableAssignmentOrThrow(db, assignmentId, userId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, task_image_url")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!task) {
    return jsonError(cors, 404, "NOT_FOUND", "Task not found");
  }

  const refs = parseAttachmentUrls(task.task_image_url);
  if (refs.length === 0) {
    console.log("homework_api_request_success", {
      route: "GET /assignments/:id/tasks/:taskId/images",
      user_id: userId,
      assignment_id: assignmentId,
      task_id: taskId,
      signed_url_count: 0,
    });
    return jsonOk(cors, { signed_urls: [] });
  }

  const signedUrls = await createSignedStorageUrls(db, refs, "homework-task-images");

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/tasks/:taskId/images",
    user_id: userId,
    assignment_id: assignmentId,
    task_id: taskId,
    signed_url_count: signedUrls.length,
  });
  return jsonOk(cors, { signed_urls: signedUrls });
}

async function handleRubricImagesSignedUrls(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, rubric_image_urls")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!task) {
    return jsonError(cors, 404, "NOT_FOUND", "Task not found");
  }

  const refs = parseAttachmentUrls(task.rubric_image_urls);
  if (refs.length === 0) {
    console.log("homework_api_request_success", {
      route: "GET /assignments/:id/tasks/:taskId/rubric-images",
      tutor_id: tutorUserId,
      assignment_id: assignmentId,
      task_id: taskId,
      signed_url_count: 0,
    });
    return jsonOk(cors, { signed_urls: [] });
  }

  const signedUrls = await createSignedStorageUrls(db, refs, "homework-task-images");

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/tasks/:taskId/rubric-images",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    task_id: taskId,
    signed_url_count: signedUrls.length,
  });
  return jsonOk(cors, { signed_urls: signedUrls });
}

// ─── Formula round endpoints (student) ──────────────────────────────────────

interface FormulaRoundRecord {
  id: string;
  assignment_id: string;
  section: string;
  formula_count: number;
  questions_per_round: number;
  lives: number;
  created_at: string;
}

async function verifyFormulaRoundOwnership(
  db: SupabaseClient,
  roundId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<FormulaRoundRecord | Response> {
  if (!isUUID(roundId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid formula round ID format");
  }

  const { data: round, error: roundError } = await db
    .from("formula_rounds")
    .select("id, assignment_id, section, formula_count, questions_per_round, lives, created_at")
    .eq("id", roundId)
    .maybeSingle();

  if (roundError) {
    console.error("homework_api_request_error", {
      route: "formula-rounds:verify",
      round_id: roundId,
      error: roundError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load formula round");
  }

  if (!round) {
    return jsonError(cors, 404, "NOT_FOUND", "Formula round not found");
  }

  const { data: studentAssignment, error: assignmentError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", round.assignment_id)
    .eq("student_id", userId)
    .maybeSingle();

  if (assignmentError) {
    console.error("homework_api_request_error", {
      route: "formula-rounds:verify",
      round_id: roundId,
      error: assignmentError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify formula round access");
  }

  if (!studentAssignment) {
    return jsonError(cors, 403, "FORBIDDEN", "Not authorized to access this formula round");
  }

  return round as FormulaRoundRecord;
}

async function handleGetFormulaRound(
  db: SupabaseClient,
  userId: string,
  roundId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const round = await verifyFormulaRoundOwnership(db, roundId, userId, cors);
  if (round instanceof Response) return round;

  return jsonOk(cors, round);
}

async function handleListFormulaRoundResults(
  db: SupabaseClient,
  userId: string,
  roundId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const round = await verifyFormulaRoundOwnership(db, roundId, userId, cors);
  if (round instanceof Response) return round;

  const { data: results, error } = await db
    .from("formula_round_results")
    .select("id, round_id, student_id, score, total, lives_remaining, completed, duration_seconds, answers, weak_formulas, created_at")
    .eq("round_id", round.id)
    .eq("student_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("homework_api_request_error", {
      route: "GET /formula-rounds/:roundId/results",
      round_id: roundId,
      user_id: userId,
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load formula round results");
  }

  return jsonOk(cors, results ?? []);
}

async function handleCreateFormulaRoundResult(
  db: SupabaseClient,
  userId: string,
  roundId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const round = await verifyFormulaRoundOwnership(db, roundId, userId, cors);
  if (round instanceof Response) return round;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;
  const score = payload.score;
  const total = payload.total;
  const livesRemaining = payload.livesRemaining ?? payload.lives_remaining;
  const completed = payload.completed;
  const durationSeconds = payload.durationSeconds ?? payload.duration_seconds;
  const answers = payload.answers;
  const weakFormulas = payload.weakFormulas ?? payload.weak_formulas ?? [];

  if (!isNonNegativeInt(score)) {
    return jsonError(cors, 400, "VALIDATION", "score must be a non-negative integer");
  }
  if (!isPositiveInt(total)) {
    return jsonError(cors, 400, "VALIDATION", "total must be a positive integer");
  }
  if (!isNonNegativeInt(livesRemaining)) {
    return jsonError(cors, 400, "VALIDATION", "livesRemaining must be a non-negative integer");
  }
  if (!isBoolean(completed)) {
    return jsonError(cors, 400, "VALIDATION", "completed must be a boolean");
  }
  if (durationSeconds !== undefined && durationSeconds !== null && !isNonNegativeInt(durationSeconds)) {
    return jsonError(cors, 400, "VALIDATION", "durationSeconds must be a non-negative integer or null");
  }
  if (!Array.isArray(answers)) {
    return jsonError(cors, 400, "VALIDATION", "answers must be an array");
  }
  if (!Array.isArray(weakFormulas)) {
    return jsonError(cors, 400, "VALIDATION", "weakFormulas must be an array");
  }
  if (score > total) {
    return jsonError(cors, 400, "VALIDATION", "score cannot exceed total");
  }
  if (livesRemaining > round.lives) {
    return jsonError(cors, 400, "VALIDATION", "livesRemaining cannot exceed round lives");
  }

  const { data: savedResult, error } = await db
    .from("formula_round_results")
    .insert({
      round_id: round.id,
      student_id: userId,
      score,
      total,
      lives_remaining: livesRemaining,
      completed,
      duration_seconds: durationSeconds ?? null,
      answers,
      weak_formulas: weakFormulas,
    })
    .select("id, created_at")
    .single();

  if (error || !savedResult) {
    console.error("homework_api_request_error", {
      route: "POST /formula-rounds/:roundId/results",
      round_id: roundId,
      user_id: userId,
      error: error?.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save formula round result");
  }

  console.log("homework_api_request_success", {
    route: "POST /formula-rounds/:roundId/results",
    round_id: roundId,
    user_id: userId,
    result_id: savedResult.id,
  });

  return jsonOk(cors, savedResult, 201);
}

// ─── Endpoint: GET /threads/:id (student) ────────────────────────────────────

async function handleGetThread(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(threadId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid thread ID");
  }

  const { data: thread, error } = await db
    .from("homework_tutor_threads")
    .select(THREAD_SELECT)
    .eq("id", threadId)
    .order("created_at", { referencedTable: "homework_tutor_thread_messages", ascending: true })
    .single();

  if (error || !thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  // Verify ownership: student must own this thread
  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id, assignment_id")
    .eq("id", thread.student_assignment_id)
    .single();

  if (!sa || sa.student_id !== userId) {
    return jsonError(cors, 403, "FORBIDDEN", "Not your thread");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score, check_format")
    .eq("assignment_id", sa.assignment_id)
    .order("order_num", { ascending: true });

  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks for thread");
  }

  const tutorProfile = await resolveTutorProfileForAssignment(db, sa.assignment_id);

  // Filter out hidden tutor notes (service-role bypasses RLS)
  return jsonOk(cors, {
    ...stripStudentSensitiveTaskStateFields(
      stripHiddenMessages(thread as Record<string, unknown>),
    ),
    tasks: tasks ?? [],
    tutor_profile: tutorProfile,
  });
}

// ─── Endpoint: GET /assignments/:id/thread (student) ────────────────────────
//
// Resolves student's guided thread by assignment_id (with lazy provisioning
// if the thread doesn't exist yet) and returns it with tutor_profile attached
// (via fetchStudentThread). This is the canonical way for the student client
// to load a thread — direct PostgREST SELECT cannot compute tutor_profile.
// Routed before /assignments/:id/student in the dispatcher so the more-specific
// path matches first.
async function handleGetStudentThreadByAssignment(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid assignment ID");
  }

  // Ownership check + resolve SA id for thread lookup.
  const { data: sa, error: saError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();
  if (saError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify student assignment");
  }
  if (!sa) {
    // Don't 200-with-null — that would mask "not assigned to you" as
    // "no thread yet". 404 is honest.
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  // Find thread by student_assignment_id.
  const { data: existingThread, error: threadError } = await db
    .from("homework_tutor_threads")
    .select("id")
    .eq("student_assignment_id", sa.id)
    .maybeSingle();
  if (threadError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load thread");
  }

  let threadId: string | null = typeof existingThread?.id === "string" ? existingThread.id : null;
  // Lazy provision (matches handleCheckAnswer / handleRequestHint behavior).
  if (!threadId) {
    const provisioned = await provisionGuidedThread(db, assignmentId, sa.id);
    threadId = typeof provisioned?.id === "string" ? provisioned.id : null;
  }
  if (!threadId) {
    // Genuine 200-null: assignment exists, student is owner, but no tasks
    // yet so provisioning skipped. Client treats null as "no thread, no
    // messages to render" same as before the refactor.
    return jsonOk(cors, null);
  }

  const studentThread = await fetchStudentThread(db, threadId);
  return jsonOk(cors, studentThread);
}

// ─── Endpoint: GET /assignments/:id/student (student) ────────────────────────

async function handleGetStudentAssignment(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid assignment ID");
  }

  const { data: assigned, error: assignedError } = await db
    .from("homework_tutor_student_assignments")
    // Phase 12: общий комментарий к ДЗ — student-visible. _by не селектим (audit-only).
    .select("assignment_id, tutor_overall_comment, tutor_overall_comment_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();

  if (assignedError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify student assignment");
  }
  if (!assigned) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  const { data: assignment, error: assignmentError } = await db
    .from("homework_tutor_assignments")
    .select("id, title, subject, topic, description, deadline, status, disable_ai_bootstrap, exam_type, created_at")
    .eq("id", assignmentId)
    .single();

  if (assignmentError || !assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    // task_kind added 2026-05-28 for parity with the (now-removed) direct
    // PostgREST select in studentHomeworkApi::getStudentAssignment, which
    // routes through this endpoint. Anti-leak: solution_*/rubric_* excluded.
    .select("id, assignment_id, order_num, task_text, task_image_url, max_score, check_format, task_kind")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks");
  }

  const { data: materials, error: materialsError } = await db
    .from("homework_tutor_materials")
    .select("id, assignment_id, type, title, storage_ref, url, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });

  if (materialsError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load materials");
  }

  return jsonOk(cors, {
    ...assignment,
    updated_at: assignment.created_at,
    // Phase 12: общий комментарий репетитора к ДЗ (per-student wrap-up).
    tutor_overall_comment: (assigned.tutor_overall_comment as string | null) ?? null,
    tutor_overall_comment_at: (assigned.tutor_overall_comment_at as string | null) ?? null,
    tasks: tasks ?? [],
    materials: materials ?? [],
  });
}

// ─── Endpoint: GET /assignments/:id/identity (student) ──────────────────────
//
// Lightweight resolver для legacy frontend path (studentHomeworkApi::getStudentAssignment).
// Возвращает имя + пол ученика для AI промпта (canonical chain: tutor_students →
// profiles → null). Service-role обходит RLS на tutor_students, фронт получает
// результат без direct PostgREST query (которая всё равно ломалась из-за
// `tutor_students.tutor_id` FK mismatch + RLS).
//
// См. .claude/rules/40-homework-system.md Phase 8 + AGENTS.md FK tutor_id (cross-table tutor_id invariant).
async function handleGetStudentIdentity(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid assignment ID");
  }

  // Verify enrollment first — иначе можно резолвить identity любого ассигнмента.
  const { data: sa, error: saErr } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();

  if (saErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify student assignment");
  }
  if (!sa) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  const identity = await resolveStudentIdentity(db, sa.id as string);
  return jsonOk(cors, {
    name: identity.name,
    gender: identity.gender,
  });
}

// ─── Endpoint: GET /student/problem/:hwId/:taskId (student) ─────────────────
//
// Single-task surface for the Phase 1 student-side homework problem screen
// (`/student/homework/:hwId/problem/:taskId`). Returns the task in question
// + its surrounding context (assignment meta, sibling task count, current
// thread + tutor identity, computed score + hint count, student display name)
// in a single round-trip, so the new mobile screen does not need to chain
// `/assignments/:id/student` + `/assignments/:id/thread` + per-task lookups.
//
// Anti-leak invariants (mirror rule 40-homework-system.md "Эталонное решение
// для AI и anti-leak" + CLAUDE.md rule 9):
//   - SELECT on `homework_tutor_assignments` whitelists meta only — no
//     `notes_for_student` / `tutor_id` / `disable_ai_bootstrap` leak.
//   - SELECT on `homework_tutor_tasks` excludes `solution_text`,
//     `solution_image_urls`, `rubric_text`, `rubric_image_urls`. These remain
//     tutor-only artifacts.
//   - Thread is fetched via `fetchStudentThread`, which already strips
//     `ai_score_comment` from each task_state and filters out hidden tutor
//     notes (visible_to_student=false). `tutor_profile` attached server-side
//     to keep guided-chat identity consistent across student surfaces.
//   - Ownership: 404 (not 403) when the student is not assigned, matching
//     `handleGetStudentAssignment`. Hides existence of someone else's ДЗ.
//
// Storage refs returned as-is (`storage://...`); the client resolves signed
// URLs through the existing tutor + student image endpoints. No `rewriteToProxy`
// touch here — Patch B+2 dual-host validator kicks in only when validating
// already-resolved URLs in AI paths.
async function handleGetStudentProblem(
  db: SupabaseClient,
  userId: string,
  hwId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  // 1. Validate UUIDs (cheap; before any DB hit).
  if (!isUUID(hwId) || !isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid hwId or taskId");
  }

  // 2. Ownership check — assigned-student gate.
  //    404 (not 403) keeps existence private; same pattern as
  //    handleGetStudentAssignment.
  const { data: sa, error: saError } = await db
    .from("homework_tutor_student_assignments")
    // Phase 12: tutor_overall_comment(+_at) — student-visible by design (общий
    // комментарий репетитора к ДЗ). Anti-leak: tutor_overall_comment_by НЕ селектим.
    .select("id, tutor_overall_comment, tutor_overall_comment_at")
    .eq("assignment_id", hwId)
    .eq("student_id", userId)
    .maybeSingle();
  if (saError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify student assignment");
  }
  if (!sa) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }
  const studentAssignmentId = sa.id as string;

  // 3. Assignment meta (whitelist — no leak fields).
  const { data: assignment, error: assignmentError } = await db
    .from("homework_tutor_assignments")
    .select("id, title, subject, deadline, status")
    .eq("id", hwId)
    .single();
  if (assignmentError || !assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  // 4. Tasks (column whitelist — student-safe fields only).
  //    Sorting by order_num so task_total ordering matches the step indicator.
  const { data: tasksRaw, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score, check_format, task_kind")
    .eq("assignment_id", hwId)
    .order("order_num", { ascending: true });
  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks");
  }
  const tasks = tasksRaw ?? [];

  // 5. Target task lookup. 404 distinct from assignment-NOT_FOUND so the
  //    client can surface "task moved/deleted" vs "you don't have access".
  const targetTask = tasks.find((t) => typeof t?.id === "string" && t.id === taskId);
  if (!targetTask) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Task not found in assignment");
  }

  // 6. Resolve thread id with lazy provisioning.
  //    Mirrors handleGetStudentThreadByAssignment: a freshly-assigned student
  //    may not have a thread row yet on first open of the new screen. We
  //    refuse to error in that case — provisionGuidedThread is idempotent.
  const { data: existingThread, error: threadLookupError } = await db
    .from("homework_tutor_threads")
    .select("id")
    .eq("student_assignment_id", studentAssignmentId)
    .maybeSingle();
  if (threadLookupError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load thread");
  }
  let threadId: string | null = typeof existingThread?.id === "string"
    ? existingThread.id
    : null;
  if (!threadId) {
    const provisioned = await provisionGuidedThread(db, hwId, studentAssignmentId);
    threadId = typeof provisioned?.id === "string" ? provisioned.id : null;
  }

  // 6b. Record the genuine "student opened this task's statement" signal for
  //     the /tutor/home «Последние действия учеников» feed. The real "opened"
  //     event — opening a task is otherwise pure frontend navigation with no
  //     DB trace — letting the tutor tell "opened but did not solve" from
  //     "never opened". Idempotent: the IS NULL guard means only the FIRST
  //     open writes; every later refetch is a 0-row no-op.
  //
  //     We AWAIT it (it adds one guarded UPDATE, negligible and a no-op after
  //     first open). Not floated: an un-awaited promise can be killed once the
  //     edge isolate returns the response. Not EdgeRuntime.waitUntil: that's
  //     not used anywhere in this codebase, and the latency saved here doesn't
  //     justify a new runtime dependency. Errors are non-fatal — a missed feed
  //     signal must never block the problem-screen load.
  if (threadId) {
    const { data: openedRows, error: openedErr } = await db
      .from("homework_tutor_task_states")
      .update({ student_opened_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("task_id", taskId)
      .is("student_opened_at", null)
      .select("task_id");
    if (openedErr) {
      console.error("student_problem_mark_opened_error", { error: openedErr.message });
    } else if (openedRows && openedRows.length > 0) {
      // Первое открытие этой задачи → события воронки (онбординг v2 T9).
      let tId: string | null = null;
      let tStudentId: string | null = null;
      try {
        const { data: aRow } = await db
          .from("homework_tutor_assignments")
          .select("tutor_id")
          .eq("id", hwId)
          .maybeSingle();
        tId = (aRow?.tutor_id as string | null) ?? null;
        const { data: tsRow } = await db
          .from("tutor_students")
          .select("id")
          .eq("student_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        tStudentId = (tsRow?.id as string | null) ?? null;
      } catch {
        // best-effort
      }
      await logAnalyticsEventOnce(
        db,
        {
          event_name: "student_first_homework_opened",
          actor_user_id: userId,
          student_id: userId,
          tutor_id: tId,
          tutor_student_id: tStudentId,
          assignment_id: hwId,
        },
        { student_id: userId },
      );
      // cross-side «ага» — ученик получил и открыл ДЗ репетитора (раз на ДЗ).
      await logAnalyticsEventOnce(
        db,
        {
          event_name: "student_received_and_opened",
          actor_user_id: userId,
          student_id: userId,
          tutor_id: tId,
          tutor_student_id: tStudentId,
          assignment_id: hwId,
        },
        { student_id: userId, assignment_id: hwId },
      );
    }
  }

  // 7. Hydrate thread for the student.
  //    fetchStudentThread = fetchFullThread + stripHiddenMessages
  //                       + stripStudentSensitiveTaskStateFields
  //                       + tutor_profile (resolveTutorProfileForAssignment).
  //    Single canonical path — do not duplicate the strip logic here.
  const thread = threadId ? await fetchStudentThread(db, threadId) : null;

  // 8. task_score + hints_used for the target task only.
  //    Walks the already-fetched task_states from `thread` instead of a
  //    second SELECT — keeps hot-path round-trip count low.
  let taskScore = 0;
  let hintsUsed = 0;
  if (thread) {
    const taskStates = Array.isArray(thread.homework_tutor_task_states)
      ? (thread.homework_tutor_task_states as Record<string, unknown>[])
      : [];
    const targetState = taskStates.find(
      (ts) => typeof ts?.task_id === "string" && ts.task_id === taskId,
    );
    if (targetState) {
      taskScore = computeFinalScore(
        targetState as unknown as TaskStateScoreFields,
        Number(targetTask.max_score) || 0,
      );
      const hc = targetState.hint_count;
      hintsUsed = typeof hc === "number" ? hc : 0;
    }
  }

  // 9. Student identity (name + gender) — same canonical chain as the AI
  //    prompt path. Phase 8 (2026-05-20): also returns gender для AI
  //    grammar conjugation (tutor_students.gender → profiles.gender → null).
  const studentIdentity = await resolveStudentIdentity(db, studentAssignmentId);

  return jsonOk(cors, {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      deadline: assignment.deadline,
      status: assignment.status,
      // Phase 12: общий комментарий репетитора к ДЗ (per-student wrap-up).
      tutor_overall_comment: (sa.tutor_overall_comment as string | null) ?? null,
      tutor_overall_comment_at: (sa.tutor_overall_comment_at as string | null) ?? null,
    },
    task: {
      id: targetTask.id,
      order_num: targetTask.order_num,
      task_text: targetTask.task_text,
      task_image_url: targetTask.task_image_url,
      max_score: targetTask.max_score,
      check_format: targetTask.check_format,
      task_kind: targetTask.task_kind,
    },
    task_total: tasks.length,
    task_score: taskScore,
    thread,
    student: {
      id: userId,
      display_name: studentIdentity.name,
      gender: studentIdentity.gender,
    },
    hints_used: hintsUsed,
  });
}

// ─── Endpoint: POST /threads/:id/messages (student) ─────────────────────────

async function verifyThreadOwnership(
  db: SupabaseClient,
  threadId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<{
  thread: Record<string, unknown>;
  studentAssignment: { id: string; assignment_id: string; student_id: string };
} | Response> {
  if (!isUUID(threadId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid thread ID");
  }

  const { data: thread, error } = await db
    .from("homework_tutor_threads")
    .select("id, status, current_task_order, student_assignment_id")
    .eq("id", threadId)
    .single();

  if (error || !thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id")
    .eq("id", thread.student_assignment_id)
    .single();

  if (!sa || sa.student_id !== userId) {
    return jsonError(cors, 403, "FORBIDDEN", "Not your thread");
  }

  return {
    thread: thread as Record<string, unknown>,
    studentAssignment: sa as { id: string; assignment_id: string; student_id: string },
  };
}

async function handleTranscribeThreadVoice(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;

  const { thread } = ownershipResult;
  if (thread.status !== "active") {
    return jsonError(cors, 409, "THREAD_NOT_ACTIVE", "Thread is not active");
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError(cors, 400, "INVALID_BODY", "Expected multipart audio upload");
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return jsonError(cors, 400, "VALIDATION", "Audio file is required");
  }

  if (file.size === 0) {
    return jsonError(cors, 400, "VALIDATION", "Voice message is empty");
  }

  if (file.size > MAX_VOICE_BYTES) {
    return jsonError(cors, 413, "VOICE_TOO_LARGE", "Голосовое сообщение слишком большое");
  }

  const mimeType = file.type || "application/octet-stream";
  if (!isAcceptedVoiceMimeType(mimeType)) {
    return jsonError(cors, 400, "VOICE_UNSUPPORTED_FORMAT", "Неподдерживаемый формат голосового сообщения");
  }

  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!groqApiKey) {
    console.error("GROQ_API_KEY is not configured for homework voice transcription");
    return jsonError(cors, 503, "VOICE_UNAVAILABLE", "Расшифровка голосовых временно недоступна");
  }

  const outboundForm = new FormData();
  const uploadedName = file instanceof File ? file.name : undefined;
  outboundForm.append("file", file, getVoiceFilename(mimeType, uploadedName));
  outboundForm.append("model", VOICE_TRANSCRIPTION_MODEL);
  outboundForm.append("language", "ru");

  console.log("homework_voice_transcription_request", {
    threadId,
    userId,
    mimeType,
    size: file.size,
  });

  const transcriptionRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: outboundForm,
  });

  if (!transcriptionRes.ok) {
    const errText = await transcriptionRes.text().catch(() => "unknown");
    console.error("homework_voice_transcription_failed", {
      threadId,
      userId,
      status: transcriptionRes.status,
      body: errText,
    });
    return jsonError(cors, 502, "VOICE_TRANSCRIPTION_FAILED", "Не удалось расшифровать голосовое сообщение");
  }

  const transcriptionData = await transcriptionRes.json();
  const text = typeof transcriptionData?.text === "string"
    ? transcriptionData.text.trim()
    : "";

  if (!text) {
    return jsonError(cors, 422, "VOICE_EMPTY_TRANSCRIPT", "Не удалось распознать речь");
  }

  return jsonOk(cors, { text });
}

async function handlePostThreadMessage(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.content)) {
    return jsonError(cors, 400, "VALIDATION", "content is required (non-empty string)");
  }
  const role = b.role === "assistant" ? "assistant" : "user";
  const attachmentRefs = role === "user"
    ? extractStudentThreadAttachmentRefs(b, userId, studentAssignment.assignment_id, cors)
    : [];
  if (attachmentRefs instanceof Response) return attachmentRefs;
  const serializedAttachments = serializeThreadAttachmentRefs(attachmentRefs);
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;
  const messageKindRaw = isString(b.message_kind) ? (b.message_kind as string).trim() : "";
  const validMessageKinds = new Set(["answer", "hint_request", "question", "ai_reply", "system"]);
  const messageKind = validMessageKinds.has(messageKindRaw)
    ? messageKindRaw
    : (role === "assistant" ? "ai_reply" : "answer");

  const { data: assignmentTasks, error: assignmentTasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", studentAssignment.assignment_id)
    .order("order_num", { ascending: true });
  if (assignmentTasksError || !assignmentTasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve task reference");
  }

  const resolvedTask = resolveTaskReference(
    assignmentTasks as GuidedTaskIdentityRow[],
    {
      taskId: requestedTaskId,
      taskOrder: requestedTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!resolvedTask) {
    return jsonError(cors, 400, "VALIDATION", "Invalid task reference");
  }
  const taskOrder = resolvedTask.order_num;
  const taskId = resolvedTask.id;

  // Integrity check: assistant messages can only follow a user message
  // Exception: bootstrap intro messages (message_kind='system') can be first in thread
  if (role === "assistant" && messageKind !== "system") {
    const { data: lastMsg } = await db
      .from("homework_tutor_thread_messages")
      .select("role")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastMsg || lastMsg.role !== "user") {
      return jsonError(cors, 400, "INVALID_ORDER", "Assistant message must follow a user message");
    }
  }

  // Insert message (message_kind is optional for backward compatibility)
  const payloadWithKind = {
    thread_id: threadId,
    role,
    content: b.content,
    image_url: serializedAttachments,
    task_id: taskId,
    task_order: taskOrder,
    message_kind: messageKind,
  };
  const payloadLegacy = {
    thread_id: threadId,
    role,
    content: b.content,
    image_url: serializedAttachments,
    task_id: taskId,
    task_order: taskOrder,
  };

  let savedMsg: Record<string, unknown> | null = null;
  let insertErr: { message?: string } | null = null;

  const withKindResult = await db
    .from("homework_tutor_thread_messages")
    .insert(payloadWithKind)
    .select("id, role, content, image_url, task_id, task_order, created_at")
    .single();

  if (withKindResult.error && isMissingColumnError(withKindResult.error.message, "message_kind")) {
    const legacyResult = await db
      .from("homework_tutor_thread_messages")
      .insert(payloadLegacy)
      .select("id, role, content, image_url, task_id, task_order, created_at")
      .single();
    savedMsg = legacyResult.data as Record<string, unknown> | null;
    insertErr = legacyResult.error;
  } else {
    savedMsg = withKindResult.data as Record<string, unknown> | null;
    insertErr = withKindResult.error;
  }

  if (insertErr || !savedMsg) {
    console.error("homework_api_thread_message_insert_failed", { error: insertErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save message");
  }

  // Codex review fix #1 (preview-QA #10, 2026-05-11): discussion
  // messages должны быть scoring-neutral. Раньше ВСЕ user messages
  // инкрементили attempts → discussion chat в mobile UI силенциально
  // снижал available_score через ON_TRACK degradation в
  // runStudentAnswerGrading. Теперь attempts инкрементятся ТОЛЬКО для
  // legacy answer-input path (`message_kind='answer'`); chat path
  // (`'question'`, `'hint_request'`, etc.) — scoring-neutral.
  // SubmitSheet submissions используют отдельный API (handleStudentSubmission
  // → runStudentAnswerGrading) и не идут через эту функцию.
  // last_student_message_at обновляем ВСЕГДА для tutor «recent dialogs»
  // surface (не зависит от scoring).
  const SCORING_MESSAGE_KINDS = new Set(["answer"]);
  const isScoringAttempt =
    role === "user" &&
    typeof messageKind === "string" &&
    SCORING_MESSAGE_KINDS.has(messageKind);

  if (isScoringAttempt) {
    const { data: activeState } = await db
      .from("homework_tutor_task_states")
      .select("id, attempts")
      .eq("thread_id", threadId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (activeState) {
      await db
        .from("homework_tutor_task_states")
        .update({
          attempts: (activeState.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeState.id);
    }
  }

  if (role === "user") {
    await db
      .from("homework_tutor_threads")
      .update({
        last_student_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId);
  }

  return jsonOk(cors, {
    ...savedMsg,
    message_kind: messageKind,
  }, 201);
}

// ─── Endpoint: POST /threads/:id/advance (student) ──────────────────────────

async function handleAdvanceTask(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  // Clamp score to 0-100 if provided
  const rawScore = typeof b.score === "number" ? b.score : null;
  const score = rawScore !== null ? Math.max(0, Math.min(100, rawScore)) : null;

  // Guard: require at least 1 AI reply for the current task before allowing advance.
  // Use task_id (immutable) instead of task_order (positional, can change on reorder).
  const currentTaskId = typeof thread.current_task_id === "string" ? thread.current_task_id : null;
  const guardQuery = db
    .from("homework_tutor_thread_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("role", "assistant");

  const { count: assistantMsgCount } = currentTaskId
    ? await guardQuery.eq("task_id", currentTaskId)
    : await guardQuery.eq("task_order", thread.current_task_order as number);

  if (!assistantMsgCount || assistantMsgCount < 1) {
    return jsonError(cors, 400, "NO_INTERACTION", "Complete at least one exchange with the AI before advancing");
  }

  // Load advance context using shared helper
  const ctx = await loadAdvanceContext(db, threadId, thread);
  if (!ctx) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task to advance from");
  }

  // Perform advance using shared helper
  await performTaskAdvance(
    db, threadId, ctx.currentState, ctx.stateByOrder, ctx.sortedOrders, ctx.currentOrder, score,
  );

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  return jsonOk(cors, updatedThread ?? { id: threadId });
}

// ─── Helper: fetch full thread with nested data ─────────────────────────────

const THREAD_SELECT = `
  id, status, current_task_order, current_task_id, created_at, updated_at,
  student_assignment_id, last_student_message_at, last_tutor_message_at,
  homework_tutor_thread_messages(id, role, content, image_url, task_id, task_order, message_kind, submission_payload, created_at, author_user_id, visible_to_student),
  homework_tutor_task_states(id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count, ai_score, ai_score_comment, tutor_score_override, tutor_score_override_comment, tutor_score_override_at, tutor_force_completed_at, tutor_force_completed_by, tutor_reviewed_at, tutor_reviewed_by, ai_criteria_json, ai_nodes_json)
`;

/**
 * Strip hidden tutor notes from thread data before returning to student.
 * Service-role key bypasses RLS, so we must filter server-side.
 */
function stripHiddenMessages(thread: Record<string, unknown>): Record<string, unknown> {
  const messages = thread.homework_tutor_thread_messages;
  if (!Array.isArray(messages)) return thread;
  return {
    ...thread,
    homework_tutor_thread_messages: messages.filter(
      (m: Record<string, unknown>) => m.visible_to_student !== false,
    ),
  };
}

/**
 * Remove tutor-facing draft commentary from student responses.
 */
function stripStudentSensitiveTaskStateFields(
  thread: Record<string, unknown>,
): Record<string, unknown> {
  const taskStates = thread.homework_tutor_task_states;
  if (!Array.isArray(taskStates)) return thread;
  return {
    ...thread,
    homework_tutor_task_states: taskStates.map((taskState) => {
      if (!taskState || typeof taskState !== "object") return taskState;
      // tutor_force_completed_at / tutor_reviewed_at — оставляем (ученик видит бейдж).
      // tutor_force_completed_by / tutor_reviewed_by — strip (UUID туторa, audit-only).
      const {
        ai_score_comment: _aiScoreComment,
        tutor_force_completed_by: _forceCompletedBy,
        tutor_reviewed_by: _reviewedBy,
        ...safeTaskState
      } = taskState as Record<string, unknown>;
      return safeTaskState;
    }),
  };
}

async function fetchFullThread(
  db: SupabaseClient,
  threadId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("homework_tutor_threads")
    .select(THREAD_SELECT)
    .eq("id", threadId)
    .order("created_at", { referencedTable: "homework_tutor_thread_messages", ascending: true })
    .single();
  return data as Record<string, unknown> | null;
}

/**
 * Fetch thread for student: filters out hidden tutor notes AND attaches
 * `tutor_profile` (display_name + avatar_url + gender) so guided-chat
 * messages can render the tutor's identity without an extra round-trip
 * from the client.
 *
 * Cost: 2 additional point-lookups (sa by PK + tutors by user_id, both
 * < 5 ms) per fetch. Acceptable because guided-chat is interaction-paced,
 * not hot-throughput.
 *
 * Why here (vs. per-handler): keeps every consumer
 * (handleGetThread / handleCheckAnswer / handleRequestHint / handleAdvanceTask)
 * in sync. Adding an attach helper at the handler level invited regressions
 * — see ChatGPT-5.5 review BLOCKER 1, where check/hint responses lacked
 * tutor_profile and the client lost identity after every answer.
 */
async function fetchStudentThread(
  db: SupabaseClient,
  threadId: string,
): Promise<Record<string, unknown> | null> {
  const thread = await fetchFullThread(db, threadId);
  if (!thread) return null;
  const stripped = stripStudentSensitiveTaskStateFields(stripHiddenMessages(thread));

  const studentAssignmentId = typeof stripped.student_assignment_id === "string"
    ? stripped.student_assignment_id
    : null;
  let tutorProfile: TutorThreadProfile | null = null;
  if (studentAssignmentId) {
    const { data: sa } = await db
      .from("homework_tutor_student_assignments")
      .select("assignment_id")
      .eq("id", studentAssignmentId)
      .maybeSingle();
    const assignmentId = typeof sa?.assignment_id === "string" ? sa.assignment_id : null;
    if (assignmentId) {
      tutorProfile = await resolveTutorProfileForAssignment(db, assignmentId);
    }
  }

  return { ...stripped, tutor_profile: tutorProfile };
}

// ─── Helper: lazy thread provisioning for guided_chat ───────────────────────

/**
 * Create a guided_chat thread + task_states for a student assignment.
 * Used both at assign-time (eager) and on first GET (lazy fallback).
 * Returns the fully-loaded thread (with nested messages/task_states) or null on failure.
 */
async function provisionGuidedThread(
  db: SupabaseClient,
  assignmentId: string,
  studentAssignmentId: string,
): Promise<Record<string, unknown> | null> {
  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, max_score")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (!tasks || tasks.length === 0) {
    console.warn("provisionGuidedThread: no tasks found", { assignmentId, studentAssignmentId });
    return null;
  }

  const { data: thread, error: threadErr } = await db
    .from("homework_tutor_threads")
    .upsert(
      {
        student_assignment_id: studentAssignmentId,
        status: "active",
        current_task_order: 1,
        current_task_id: tasks[0]?.id ?? null,
      },
      { onConflict: "student_assignment_id", ignoreDuplicates: true },
    )
    .select("id")
    .single();

  if (threadErr || !thread) {
    console.warn("provisionGuidedThread: thread upsert failed", {
      assignmentId,
      studentAssignmentId,
      error: threadErr?.message,
    });
    return null;
  }

  const taskStateRows = tasks.map((task: { id: string; max_score?: number }) => ({
    thread_id: thread.id,
    task_id: task.id,
    status: "active",
    attempts: 0,
    available_score: task.max_score ?? 1,
  }));

  const { error: stateErr } = await db
    .from("homework_tutor_task_states")
    .upsert(taskStateRows, { onConflict: "thread_id,task_id", ignoreDuplicates: true });

  if (stateErr) {
    console.warn("provisionGuidedThread: task_states upsert failed", {
      assignmentId,
      threadId: thread.id,
      error: stateErr.message,
    });
  }

  // Return the full thread with nested relations
  return await fetchFullThread(db, thread.id);
}

// ─── Helper: shared advance logic (used by /advance and /check) ─────────────

interface AdvanceResult {
  nextOrder: number | null;
  nextTaskId: string | null;
  threadCompleted: boolean;
}

async function performTaskAdvance(
  db: SupabaseClient,
  threadId: string,
  currentState: Record<string, unknown>,
  stateByOrder: Map<number, Record<string, unknown>>,
  sortedOrders: number[],
  currentOrder: number,
  score: number | null,
): Promise<AdvanceResult> {
  // Mark current task as completed
  const bestScore = score !== null
    ? (currentState.best_score !== null ? Math.max(currentState.best_score as number, score) : score)
    : (currentState.best_score as number | null);

  await db
    .from("homework_tutor_task_states")
    .update({
      status: "completed",
      best_score: bestScore,
      updated_at: new Date().toISOString(),
    })
    .eq("id", currentState.id);

  // Find the first remaining active task in order. `stateByOrder` is a snapshot
  // from before the DB update above, so we must explicitly exclude the task we
  // just completed.
  const remainingActiveOrders = sortedOrders.filter(
    (order) => order !== currentOrder && stateByOrder.get(order)?.status === "active",
  );
  const nextOrder = remainingActiveOrders.length > 0 ? remainingActiveOrders[0] : null;
  const nextState = nextOrder !== null ? stateByOrder.get(nextOrder) : null;
  const nextTaskId = typeof nextState?.task_id === "string" ? nextState.task_id as string : null;

  if (nextOrder !== null) {
    // Update thread current_task_order
    await db
      .from("homework_tutor_threads")
      .update({
        current_task_id: nextTaskId,
        current_task_order: nextOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId);

    // Insert system message about task transition
    await db
      .from("homework_tutor_thread_messages")
      .insert({
        thread_id: threadId,
        role: "system",
        content: `Задача ${currentOrder} выполнена! Переходим к задаче ${nextOrder}.`,
        task_id: nextTaskId,
        task_order: nextOrder,
        message_kind: "system",
      });

    return { nextOrder, nextTaskId, threadCompleted: false };
  } else {
    // All tasks completed
    await db
      .from("homework_tutor_threads")
      .update({
        current_task_id: null,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId);

    await db
      .from("homework_tutor_thread_messages")
      .insert({
        thread_id: threadId,
        role: "system",
        content: "Все задачи выполнены! 🎉",
        task_id: typeof currentState.task_id === "string" ? currentState.task_id as string : null,
        task_order: currentOrder,
        message_kind: "system",
      });

    return { nextOrder: null, nextTaskId: null, threadCompleted: true };
  }
}

// ─── Helper: load advance context (shared between /advance and /check) ──────

async function loadAdvanceContext(
  db: SupabaseClient,
  threadId: string,
  thread: Record<string, unknown>,
  overrideTaskOrder?: number,
  overrideTaskId?: string,
): Promise<{
  allStates: Record<string, unknown>[];
  stateByOrder: Map<number, Record<string, unknown>>;
  sortedOrders: number[];
  currentState: Record<string, unknown>;
  currentOrder: number;
  sa: Record<string, unknown>;
  tasks: Array<{ id: string; order_num: number; max_score?: number }>;
} | null> {
  const { data: allStates, error: statesErr } = await db
    .from("homework_tutor_task_states")
    .select("id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count")
    .eq("thread_id", threadId);

  if (statesErr || !allStates || allStates.length === 0) return null;

  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("id", thread.student_assignment_id)
    .single();
  if (!sa) return null;

  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, max_score")
    .eq("assignment_id", sa.assignment_id)
    .order("order_num", { ascending: true });
  if (!tasks || tasks.length === 0) return null;

  const taskOrderMap = new Map(tasks.map((t: { id: string; order_num: number }) => [t.id, t.order_num]));
  const stateByOrder = new Map(
    allStates.map((s: Record<string, unknown>) => [taskOrderMap.get(s.task_id as string) ?? 0, s]),
  );

  const currentTask = resolveTaskReference(
    tasks as GuidedTaskIdentityRow[],
    {
      taskId: overrideTaskId,
      taskOrder: overrideTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!currentTask) return null;

  const currentOrder = currentTask.order_num;
  const currentState = allStates.find((state) => state.task_id === currentTask.id);
  if (!currentState || currentState.status !== "active") return null;

  const sortedOrders = tasks
    .map((t: { order_num: number }) => t.order_num)
    .sort((a: number, b: number) => a - b);

  return { allStates, stateByOrder, sortedOrders, currentState, currentOrder, sa, tasks };
}

// ─── Endpoint: POST /threads/:id/check (student — Phase 3) ─────────────────

// ─── Helper: shared AI grading + state-machine update ──────────────────────
//
// Extracted from handleCheckAnswer so handleStudentSubmission (Phase 1
// student-side problem screen) can reuse the same grading logic without
// duplicating ~150 lines of verdict branching. Caller is responsible for:
//   1. Ownership / advance-context / task / assignment / recentMessages loads
//   2. Inserting the user's message (kind="answer" for chat,
//      kind="submission" for the new submit-sheet)
//   3. Updating thread.last_student_message_at + thread.updated_at
//   4. Final fetchStudentThread + user-message merge for the response
//
// This helper does:
//   A. Resolve task images / ocr / latest student image / student name (parallel)
//   B. evaluateStudentAnswer + confidence guard + effective ai_score derivation
//   C. Insert AI feedback message (caller-controlled message_kind:
//      "ai_reply" for chat answer, "check_result" for explicit submission)
//   D. Branch on verdict → update task_state → optionally performTaskAdvance
//   E. Build and return CheckAnswerResponse-shaped responseData
//
// Does NOT touch the user message row, thread timestamps, or the final
// thread refetch — those vary per caller and stay in the caller.
/**
 * Append-only AI-check telemetry (analytics layer, 2026-06-30).
 *
 * Records the per-check "verdict layer" (verdict / confidence / error_type /
 * failure_reason) that is NOT persisted on `homework_tutor_task_states`, plus
 * tutor corrections (override / reopen / force_complete) — for the
 * "Качество AI-проверки ДЗ" analytics project. Writes to
 * `public.hw_ai_check_events` (migration 20260630120000), service-role only.
 *
 * Invariants:
 *  - Best-effort + non-throwing: a telemetry failure MUST NEVER break grading.
 *  - PII-free: never store feedback text / comments — only categorical outcome,
 *    scores, flags and ids (ids anonymized at export time, not here).
 */
async function recordHwCheckEvent(
  db: SupabaseClient,
  event: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await db.from("hw_ai_check_events").insert(event);
    if (error) {
      console.warn(JSON.stringify({ event: "hw_ai_check_event_insert_failed", reason: error.message }));
    }
  } catch (e) {
    console.warn(JSON.stringify({
      event: "hw_ai_check_event_insert_threw",
      reason: e instanceof Error ? e.message : "unknown",
    }));
  }
}

async function runStudentAnswerGrading(args: {
  db: SupabaseClient;
  threadId: string;
  userId: string;
  studentAssignment: { id: string; assignment_id: string; student_id: string };
  ctx: NonNullable<Awaited<ReturnType<typeof loadAdvanceContext>>>;
  task: {
    id: string;
    order_num: number;
    task_text: string | null;
    task_image_url: string | null;
    ocr_text: string | null;
    correct_answer: string | null;
    rubric_text: string | null;
    rubric_image_urls: string | null;
    solution_text: string | null;
    solution_image_urls: string | null;
    max_score: number | null;
    check_format: string | null;
    /** Phase 2 (2026-05-15): for subject-rubric resolver per-KIM methodology. */
    kim_number?: number | null;
    /** Phase 2 (2026-05-15): for subject-rubric resolver task_kind context. */
    task_kind?: string | null;
    /** CEFR-level fix (2026-05-29): explicit tutor level → forces language rubric level. */
    cefr_level?: string | null;
    /** Criteria-grading feature (2026-06): tutor structured criteria (any subject). */
    grading_criteria_json?: unknown;
    /** Phase 3/A: AI-эталон решения (tutor-only) + статус генерации. Реф для физ-Часть-2 узел-грейдинга. */
    ai_reference_solution?: string | null;
    ai_reference_status?: string | null;
  };
  assignment: {
    subject: string | null;
    /** Phase 2 (2026-05-15): ЕГЭ/ОГЭ flag for subject-rubric resolver. */
    exam_type?: string | null;
    /** Phase 11 (2026-05-31): assignment-level AI feedback language. */
    feedback_language?: string | null;
  };
  studentAnswer: string;
  recentMessages: Array<{
    role?: string | null;
    content?: string | null;
    visible_to_student?: boolean | null;
    message_kind?: string | null;
  }>;
  feedbackKind: "ai_reply" | "check_result";
}): Promise<Record<string, unknown>> {
  const {
    db,
    threadId,
    userId,
    studentAssignment,
    ctx,
    task,
    assignment,
    studentAnswer,
    recentMessages,
    feedbackKind,
  } = args;
  // Шаг-1 инструментирование (2026-07-12): сквозная латентность грейдинга
  // (резолв фото + OCR + вызов модели + вердикт) → hw_ai_check_events.latency_ms.
  // Best-effort телеметрия ниже; на грейдинг/баллы не влияет.
  const gradingStartedAt = Date.now();
  const { currentState, currentOrder, stateByOrder, sortedOrders, tasks } = ctx;

  // Initialize available_score if null (backward compat for old threads)
  const currentAvailableScore: number =
    currentState.available_score != null
      ? Number(currentState.available_score)
      : (task.max_score ?? 1);

  // Resolve task/rubric images into AI-compatible data URLs, latest student
  // image into signed URLs, and tutor-curated student identity (name + gender).
  // Phase 8 (2026-05-20): resolveStudentIdentity вместо resolveStudentDisplayName —
  // дополнительно тащит gender для explicit conjugation в AI prompt.
  const [taskImageUrls, rubricImageUrls, solutionImageUrls, taskOcrText, studentImageUrls, studentIdentity] = await Promise.all([
    resolveTaskImageUrlsForAI(db, task.task_image_url),
    resolveTaskImageUrlsForAI(db, task.rubric_image_urls),
    resolveTaskImageUrlsForAI(db, task.solution_image_urls),
    ensureTaskOcrText(db, task, assignment.subject ?? "math"),
    loadLatestStudentImageUrlsForTask(
      db,
      threadId,
      currentOrder,
      currentState.task_id as string,
      userId,
      studentAssignment.assignment_id,
    ),
    resolveStudentIdentity(db, studentAssignment.id),
  ]);
  const studentName = studentIdentity.name;
  const studentGender = studentIdentity.gender;

  // Phase 3/B lazy backstop: физ-Часть-2 (№21-26 развёрнутая) БЕЗ эталона (status
  // ещё null — никогда не генерился) → фоновая генерация для СЛЕДУЮЩИХ учеников
  // (покрывает HWDrawer path B, где eager не фаерится). Текущий грейдинг идёт без
  // эталона (узлы судятся по собственному решению AI). Non-blocking.
  // Только null (review fix P1): 'failed' НЕ ретраим здесь (иначе спам на каждой
  // сдаче) — failed переретраит eager-путь при следующей правке ДЗ (генератор
  // клеймит null/failed → pending).
  if (
    assignment.subject === "physics" &&
    (task.task_kind === "extended" || task.task_kind === "proof") &&
    typeof task.kim_number === "number" && task.kim_number >= 21 && task.kim_number <= 26 &&
    task.ai_reference_status == null &&
    !(typeof task.solution_text === "string" && task.solution_text.trim().length > 0)
  ) {
    enqueueReferenceGeneration(studentAssignment.assignment_id);
  }

  // Call AI evaluation
  const totalTasks = tasks.length;
  const result = await evaluateStudentAnswer({
    studentAnswer,
    taskText: task.task_text ?? "",
    taskImageUrls,
    studentImageUrls,
    taskOcrText,
    taskId: task.id ?? null,
    assignmentId: studentAssignment.assignment_id ?? null,
    correctAnswer: task.correct_answer,
    rubricText: task.rubric_text,
    rubricImageUrls,
    solutionText: task.solution_text,
    solutionImageUrls,
    aiReferenceSolution: typeof task.ai_reference_solution === "string" ? task.ai_reference_solution : null,
    subject: assignment.subject ?? "math",
    // Phase 2 (2026-05-15) subject-rubric resolver inputs.
    examType: (assignment.exam_type === "oge" || assignment.exam_type === "ege")
      ? assignment.exam_type
      : null,
    kimNumber: typeof task.kim_number === "number" ? task.kim_number : null,
    taskKind: (task.task_kind === "numeric" || task.task_kind === "extended" || task.task_kind === "proof" || task.task_kind === "speaking")
      ? task.task_kind
      : null,
    // CEFR-level fix (2026-05-29): explicit tutor level forces the language rubric
    // level (A1/A2/B1/B2/C1) — иначе детект из task_text + дефолт B1 (баг Эмилии).
    cefrLevel: (task.cefr_level === "A1" || task.cefr_level === "A2" || task.cefr_level === "B1" || task.cefr_level === "B2" || task.cefr_level === "C1")
      ? task.cefr_level
      : null,
    // Phase 11 (2026-05-31): assignment-level feedback language → response_language_instruction.
    feedbackLanguage: normalizeFeedbackLanguage(assignment.feedback_language) ?? "auto",
    // Criteria-grading feature (2026-06): tutor structured criteria drive the
    // per-criterion breakdown for ANY subject (overrides built-in presets).
    gradingCriteria: normalizeGradingCriteria(task.grading_criteria_json),
    conversationHistory: (recentMessages ?? []).map((m) => ({
      role: typeof m.role === "string" ? m.role : "",
      content: typeof m.content === "string" ? m.content : "",
      visible_to_student: typeof m.visible_to_student === "boolean" ? m.visible_to_student : undefined,
      message_kind: typeof m.message_kind === "string" ? m.message_kind : null,
    })),
    wrongAnswerCount: (currentState.wrong_answer_count as number) ?? 0,
    hintCount: (currentState.hint_count as number) ?? 0,
    availableScore: currentAvailableScore,
    maxScore: task.max_score ?? 1,
    checkFormat: (task.check_format === "short_answer" || task.check_format === "detailed_solution")
      ? task.check_format
      : undefined,
    studentName,
    studentGender,
    // Ф5 (2026-07-23): педагогический контекст — ТОЛЬКО тон объяснений,
    // вставляется билдером выше grading-секции (evaluation/pedagogy split).
    learningContext: studentIdentity.learningContext,
    // ai-usage-logging (2026-07-06): source='homework_check'. Fire-and-forget.
    logDb: db,
    logUserId: userId,
  });

  // Safety guard: without correct_answer, only trust high-confidence CORRECT.
  // Исключение (review fix P0, 2026-06-30): физ-flowchart балл ДЕТЕРМИНИРОВАН
  // (walkPhysicsFlowchart), НЕ понижаем его по confidence узлов — иначе walker-балл
  // 3/3 при low-confidence + пустом correct_answer перетирался бы в 2.5.
  let effectiveVerdict = result.verdict;
  if (
    effectiveVerdict === "CORRECT" &&
    !task.correct_answer?.trim() &&
    result.confidence < 0.7 &&
    !result.deterministic_score
  ) {
    console.log("guided_check_downgrade_low_confidence", {
      taskId: task.id,
      confidence: result.confidence,
    });
    effectiveVerdict = "ON_TRACK";
  }

  const maxScore = task.max_score ?? 1;
  const isDetailedSolution = task.check_format === "detailed_solution";
  const effectiveAiScore = effectiveVerdict === result.verdict
    ? result.ai_score
    : effectiveVerdict === "ON_TRACK"
      ? (isDetailedSolution
        ? Math.min(result.ai_score ?? 0, Math.max(0, maxScore - 0.5))
        : 0)
      : result.ai_score;
  const effectiveAiScoreComment =
    isDetailedSolution && effectiveAiScore != null && effectiveAiScore < maxScore
      ? result.ai_score_comment ??
        "Решение пока не дотягивает до полного зачёта по критериям, поэтому балл не максимальный."
      : null;

  // Voice-Speaking MVP TASK-3 (2026-05-27): persist per-criterion breakdown
  // for language subjects (DELF / ЕГЭ EN / ОГЭ). NULL for non-language /
  // numeric / IELTS tasks (resolver returns no template). Stored as JSONB
  // array — visible to student post-submit (feedback layer).
  //
  // Review fix 2026-05-27 (P1 #3): `evaluateStudentAnswer` normalized the
  // breakdown to `result.ai_score`, but the low-confidence CORRECT→ON_TRACK
  // downgrade above may reduce the persisted score to `effectiveAiScore`.
  // Re-normalize so Σ criteria stays consistent with what we store/show.
  // No-op when `effectiveAiScore === result.ai_score`.
  const rawCriteriaBreakdown =
    Array.isArray(result.criteria_breakdown) && result.criteria_breakdown.length > 0
      ? result.criteria_breakdown
      : null;
  const criteriaBreakdown =
    rawCriteriaBreakdown && effectiveAiScore !== result.ai_score
      ? renormalizeCriteriaToScore(rawCriteriaBreakdown, effectiveAiScore, maxScore)
      : rawCriteriaBreakdown;

  // Phase C (strict-criteria-grading, 2026-07-04): physics Часть 2 flowchart
  // trace → `ai_nodes_json` (student-visible). Distinct from criteria (decision
  // path, not sum-table). No renormalization: physics sets `deterministic_score`
  // so the confidence-downgrade above never fires → effectiveAiScore ===
  // result.ai_score, and the walker score/max stay authoritative. NULL for
  // languages / numeric / other (they use criteria_breakdown or neither).
  const nodesJson =
    result.flowchart_trace && Array.isArray(result.flowchart_trace.steps) &&
      result.flowchart_trace.steps.length > 0
      ? result.flowchart_trace
      : null;

  // Save AI feedback message (caller-controlled kind: ai_reply for chat,
  // check_result for explicit submission so the submission flow gets a
  // semantically distinct verdict bubble).
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: result.feedback,
    task_id: currentState.task_id as string,
    task_order: currentOrder,
    message_kind: feedbackKind,
  });

  let responseData: Record<string, unknown>;
  const nextAttemptCount = ((currentState.attempts as number) ?? 0) + 1;

  if (effectiveVerdict === "CORRECT") {
    // Set earned_score, mark completed, advance.
    // Criteria-grading feature (2026-06): when a per-criterion breakdown is
    // present, cap earned_score by the (possibly cascade-reduced) ai_score so the
    // recorded grade matches the per-criterion table the student sees. Without
    // this, a CORRECT verdict with К1=0 (cascade zeroes К2,К3 → ai_score 14/22)
    // would still award full 22/22 — contradicting the visible criteria table.
    // Penalty model preserved: hint/wrong degradation can still lower it further.
    const earnedScore = criteriaBreakdown && effectiveAiScore != null
      ? Math.min(currentAvailableScore, effectiveAiScore)
      : currentAvailableScore;

    await db.from("homework_tutor_task_states").update({
      attempts: nextAttemptCount,
      status: "completed",
      earned_score: earnedScore,
      available_score: currentAvailableScore,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      ai_criteria_json: criteriaBreakdown,
      ai_nodes_json: nodesJson,
      best_score: Math.max((currentState.best_score as number) ?? 0, Math.round(earnedScore)),
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    const advanceResult = await performTaskAdvance(
      db, threadId, currentState, stateByOrder, sortedOrders, currentOrder, Math.round(earnedScore),
    );

    responseData = {
      verdict: "CORRECT",
      feedback: result.feedback,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      criteria_breakdown: criteriaBreakdown,
      flowchart_trace: nodesJson,
      earned_score: earnedScore,
      available_score: currentAvailableScore,
      max_score: maxScore,
      wrong_answer_count: (currentState.wrong_answer_count as number) ?? 0,
      hint_count: (currentState.hint_count as number) ?? 0,
      task_completed: true,
      next_task_order: advanceResult.nextOrder,
      next_task_id: advanceResult.nextTaskId,
      thread_completed: advanceResult.threadCompleted,
      total_tasks: totalTasks,
    };
  } else if (effectiveVerdict === "CHECK_FAILED") {
    await db.from("homework_tutor_task_states").update({
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "CHECK_FAILED",
      feedback: result.feedback,
      ai_score: null,
      ai_score_comment: null,
      earned_score: null,
      available_score: currentAvailableScore,
      max_score: maxScore,
      wrong_answer_count: (currentState.wrong_answer_count as number) ?? 0,
      hint_count: (currentState.hint_count as number) ?? 0,
      task_completed: false,
      next_task_order: null,
      next_task_id: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  } else if (effectiveVerdict === "ON_TRACK") {
    // Correct step but NOT the final answer — keep task open
    // First 2 ON_TRACKs are free; from 3rd onward, count as hint (degrades score)
    const currentAttempts = nextAttemptCount;
    const wrongCount = (currentState.wrong_answer_count as number) ?? 0;
    const prevOnTrackCount = currentAttempts - wrongCount - 1; // past ON_TRACK-like attempts
    let newHintCount = (currentState.hint_count as number) ?? 0;
    let onTrackAvailableScore = currentAvailableScore;

    if (prevOnTrackCount >= 2) {
      // 3rd+ ON_TRACK: count as hint, degrade score
      newHintCount += 1;
      onTrackAvailableScore = computeAvailableScore(
        task.max_score ?? 1, wrongCount, newHintCount,
      );
    }

    await db.from("homework_tutor_task_states").update({
      attempts: nextAttemptCount,
      hint_count: newHintCount,
      available_score: onTrackAvailableScore,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      ai_criteria_json: criteriaBreakdown,
      ai_nodes_json: nodesJson,
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "ON_TRACK",
      feedback: result.feedback,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      criteria_breakdown: criteriaBreakdown,
      flowchart_trace: nodesJson,
      earned_score: null,
      available_score: onTrackAvailableScore,
      max_score: maxScore,
      wrong_answer_count: wrongCount,
      hint_count: newHintCount,
      task_completed: false,
      next_task_order: null,
      next_task_id: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  } else {
    // Increment wrong_answer_count, degrade score
    const newWrongCount = ((currentState.wrong_answer_count as number) ?? 0) + 1;
    const newHintCount = (currentState.hint_count as number) ?? 0;
    const newAvailableScore = computeAvailableScore(
      task.max_score ?? 1, newWrongCount, newHintCount,
    );

    await db.from("homework_tutor_task_states").update({
      attempts: nextAttemptCount,
      wrong_answer_count: newWrongCount,
      available_score: newAvailableScore,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      ai_criteria_json: criteriaBreakdown,
      ai_nodes_json: nodesJson,
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "INCORRECT",
      feedback: result.feedback,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      criteria_breakdown: criteriaBreakdown,
      flowchart_trace: nodesJson,
      earned_score: null,
      available_score: newAvailableScore,
      max_score: maxScore,
      wrong_answer_count: newWrongCount,
      hint_count: newHintCount,
      task_completed: false,
      next_task_order: null,
      next_task_id: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  }

  // Analytics telemetry (2026-06-30): persist the per-check verdict layer
  // (verdict/confidence/error_type/failure_reason) that is NOT stored on
  // task_states — needed for the AI-quality analytics project. Best-effort:
  // never blocks grading, PII-free (no feedback text).
  await recordHwCheckEvent(db, {
    event_type: "check_completed",
    student_id: studentAssignment.student_id,
    assignment_id: studentAssignment.assignment_id,
    task_id: task.id,
    task_state_id: currentState.id as string,
    subject: assignment.subject ?? null,
    check_format: task.check_format ?? null,
    task_kind: task.task_kind ?? null,
    kim_number: typeof task.kim_number === "number" ? task.kim_number : null,
    max_score: task.max_score ?? null,
    verdict: effectiveVerdict,
    confidence: typeof result.confidence === "number" ? result.confidence : null,
    error_type: typeof (result as Record<string, unknown>).error_type === "string"
      ? (result as Record<string, unknown>).error_type
      : null,
    failure_reason: typeof (result as Record<string, unknown>).failure_reason === "string"
      ? (result as Record<string, unknown>).failure_reason
      : null,
    ai_score: typeof effectiveAiScore === "number" ? effectiveAiScore : null,
    latency_ms: Date.now() - gradingStartedAt,
    image_missing: (result as Record<string, unknown>).failure_reason === "task_image_missing",
    meta: {
      feedback_kind: feedbackKind,
      raw_verdict: result.verdict !== effectiveVerdict ? result.verdict : undefined,
    },
  });

  return responseData;
}

async function handleCheckAnswer(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  // AI-quota gate. Free-students with a paying tutor get 50/day (vs 10) in homework context.
  // Mirrors chat/index.ts — single source of truth is checkAiQuota / get_subscription_status RPC.
  const quotaResult = await checkAiQuota(userId, db, {
    incrementUsage: true,
    context: "homework",
  });
  if (!quotaResult.allowed) {
    console.warn(JSON.stringify({
      event: "homework_ai_quota_reached",
      handler: "handleCheckAnswer",
      userId,
      limit: quotaResult.limit,
      messagesUsed: quotaResult.messagesUsed,
      tutorCanUpgrade: quotaResult.tutorCanUpgrade,
    }));
    return buildLimitReachedResponse(quotaResult, cors);
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const answer = typeof b.answer === "string" ? b.answer.trim() : "";
  if (!answer) {
    return jsonError(cors, 400, "VALIDATION", "answer is required");
  }
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;
  const attachmentRefs = extractStudentThreadAttachmentRefs(b, userId, studentAssignment.assignment_id, cors);
  if (attachmentRefs instanceof Response) return attachmentRefs;
  const serializedAttachments = serializeThreadAttachmentRefs(attachmentRefs);

  // Load advance context
  const ctx = await loadAdvanceContext(db, threadId, thread, requestedTaskOrder, requestedTaskId);
  if (!ctx) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task to check");
  }

  const { currentState, currentOrder, stateByOrder, sortedOrders, tasks } = ctx;

  // Load the full task (with correct_answer, rubric, reference solution)
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, ocr_text, correct_answer, rubric_text, rubric_image_urls, solution_text, solution_image_urls, max_score, check_format, task_kind, kim_number, cefr_level, grading_criteria_json, ai_reference_solution, ai_reference_status")
    .eq("id", currentState.task_id)
    .single();

  if (!task) {
    return jsonError(cors, 500, "DB_ERROR", "Task not found");
  }

  // Load assignment for subject + exam_type (subject-rubric Phase 2 — 2026-05-15)
  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("subject, exam_type, feedback_language")
    .eq("id", ctx.sa.assignment_id)
    .single();

  if (!assignment) {
    return jsonError(cors, 500, "DB_ERROR", "Assignment not found");
  }

  // Load conversation history (last 15 messages for current task)
  const { data: recentMessages } = await db
    .from("homework_tutor_thread_messages")
    .select("role, content, visible_to_student, message_kind")
    .eq("thread_id", threadId)
    .eq("task_id", currentState.task_id as string)
    .order("created_at", { ascending: true })
    .limit(15);

  // Initialize available_score if null (backward compat for old threads)
  const currentAvailableScore: number =
    currentState.available_score != null
      ? Number(currentState.available_score)
      : (task.max_score ?? 1);

  // Save user answer message (with optional student image attachment)
  const { data: savedUserAnswerMessage, error: saveUserAnswerError } = await db
    .from("homework_tutor_thread_messages")
    .insert({
      thread_id: threadId,
      role: "user",
      content: answer,
      task_id: currentState.task_id as string,
      task_order: currentOrder,
      message_kind: "answer",
      ...(serializedAttachments && { image_url: serializedAttachments }),
    })
    .select("id, role, content, image_url, task_id, task_order, message_kind, created_at, author_user_id, visible_to_student")
    .single();

  if (saveUserAnswerError || !savedUserAnswerMessage) {
    console.error("homework_api_check_answer_insert_failed", {
      threadId,
      currentOrder,
      error: saveUserAnswerError?.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save answer message");
  }

  // Update last_student_message_at AND thread.updated_at. Consistent with
  // handleTutorPostMessage — keeps thread.updated_at an honest "last thread
  // activity" timestamp for downstream consumers (e.g. /recent-dialogs).
  await db.from("homework_tutor_threads")
    .update({
      last_student_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  // Run AI grading + state-machine update via the shared helper.
  // The chat path uses message_kind="ai_reply" for the feedback bubble; the
  // student-side submit-sheet path (handleStudentSubmission) passes
  // "check_result" instead.
  const responseData = await runStudentAnswerGrading({
    db,
    threadId,
    userId,
    studentAssignment,
    ctx,
    task,
    assignment,
    studentAnswer: answer,
    recentMessages: (recentMessages ?? []) as Array<{
      role?: string | null;
      content?: string | null;
      visible_to_student?: boolean | null;
      message_kind?: string | null;
    }>,
    feedbackKind: "ai_reply",
  });

  // Воронка (v2.1 W4): первая сдача ученика на numeric-inline answer-пути.
  // logAnalyticsEventOnce со scope student_id дедупит с handleStudentSubmission
  // (SubmitSheet). Раньше numeric-путь НЕ считался → активация ученика
  // недосчитывалась (частый первый тип — ЕГЭ/ОГЭ numeric). Mirror блока в
  // handleStudentSubmission.
  {
    const hwId = studentAssignment.assignment_id;
    let tId: string | null = null;
    let tStudentId: string | null = null;
    try {
      const { data: aRow } = await db
        .from("homework_tutor_assignments")
        .select("tutor_id")
        .eq("id", hwId)
        .maybeSingle();
      tId = (aRow?.tutor_id as string | null) ?? null;
      const { data: tsRow } = await db
        .from("tutor_students")
        .select("id")
        .eq("student_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      tStudentId = (tsRow?.id as string | null) ?? null;
    } catch {
      // best-effort
    }
    await logAnalyticsEventOnce(
      db,
      {
        event_name: "student_first_submission",
        actor_user_id: userId,
        student_id: userId,
        tutor_id: tId,
        tutor_student_id: tStudentId,
        assignment_id: hwId,
        source: "numeric_inline",
      },
      { student_id: userId },
    );
  }

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  if (
    updatedThread &&
    Array.isArray(updatedThread.homework_tutor_thread_messages)
  ) {
    const existingIndex = updatedThread.homework_tutor_thread_messages.findIndex(
      (message) => message.id === savedUserAnswerMessage.id,
    );

    if (existingIndex >= 0) {
      const existingMessage = updatedThread.homework_tutor_thread_messages[existingIndex];
      if (!existingMessage.image_url && savedUserAnswerMessage.image_url) {
        updatedThread.homework_tutor_thread_messages[existingIndex] = {
          ...existingMessage,
          image_url: savedUserAnswerMessage.image_url,
        };
      }
    } else {
      updatedThread.homework_tutor_thread_messages = [
        ...updatedThread.homework_tutor_thread_messages,
        savedUserAnswerMessage as Record<string, unknown>,
      ].sort((a, b) => {
        const aTime = typeof a.created_at === "string" ? Date.parse(a.created_at) : 0;
        const bTime = typeof b.created_at === "string" ? Date.parse(b.created_at) : 0;
        return aTime - bTime;
      });
    }
  }
  return jsonOk(cors, { ...responseData, thread: updatedThread });
}

// ─── Endpoint: POST /student/problem/:hwId/:taskId/submission (student) ─────
//
// Single-shot solution submit for the Phase 1 student-side problem screen.
// Body shape: { numeric, photos[], text }. Caller owns photo upload first
// (existing storage pattern `homework-submissions/{userId}/{assignmentId}/threads/...`);
// this handler validates refs through the shared
// `extractStudentThreadAttachmentRefs` helper.
//
// Synthesizes a single answer string out of the structured payload and runs
// the SAME grading pipeline as the chat-path /threads/:id/check via
// `runStudentAnswerGrading` — no duplicate AI grading logic, no special
// submission semantics in the prompt (Phase 2 owns OCR + dedicated
// 4-verdict pipeline per spec.md "Out of scope").
//
// Difference from chat-path:
//   - User message kind = "submission" (not "answer")
//   - User message stores the structured payload in `submission_payload`
//     (JSONB) so the new screen can re-render the submitted block without
//     re-parsing free-form `content`.
//   - AI feedback message kind = "check_result" — semantically distinct
//     verdict bubble for explicit submissions (vs ongoing dialog).
//
// Anti-leak: `submission_payload` returned to the client through the
// thread refetch is exactly what the client sent (numeric/photos/text
// raw refs) — no signed-URL resolution. Photos remain `storage://` refs;
// the client resolves signed URLs via the existing image endpoints.
async function handleStudentSubmission(
  db: SupabaseClient,
  userId: string,
  hwId: string,
  taskId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  // 1. Validate path UUIDs.
  if (!isUUID(hwId) || !isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid hwId or taskId");
  }

  // 2. Body shape validation.
  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Expected JSON body");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.numeric !== "string") {
    return jsonError(cors, 400, "INVALID_BODY", "numeric must be a string");
  }
  if (typeof b.text !== "string") {
    return jsonError(cors, 400, "INVALID_BODY", "text must be a string");
  }
  if (!Array.isArray(b.photos) || !b.photos.every((p) => typeof p === "string")) {
    return jsonError(cors, 400, "INVALID_BODY", "photos must be an array of strings");
  }
  const numericRaw = b.numeric as string;
  const textRaw = b.text as string;
  const photosRaw = b.photos as string[];
  // voice-speaking-mvp (2026-05-29): optional voice_ref for task_kind='speaking'.
  // Required + validated in step 6 (only when the task is a speaking task).
  const voiceRefRaw = typeof b.voice_ref === "string" ? b.voice_ref.trim() : "";

  // 3. Ownership check (mirror handleGetStudentProblem). 404 — keep
  //    existence private from non-assigned students.
  const { data: sa, error: saError } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id")
    .eq("assignment_id", hwId)
    .eq("student_id", userId)
    .maybeSingle();
  if (saError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify student assignment");
  }
  if (!sa) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }
  const studentAssignment = sa as { id: string; assignment_id: string; student_id: string };

  // 3a. AI-quota gate — MOVED below (fix #3, 2026-05-29): charged after ownership
  // + task load + task_kind/voice_ref/photo validation, immediately before the
  // first AI op. Иначе невалидный submit (нет/битый voice_ref, missing numeric)
  // списывал квоту, хотя ни Whisper, ни Gemini не звались. Один charge на
  // валидный submit покрывает обе AI-операции.

  // 4. Validate photo refs through the canonical student-side validator.
  //    Same Patch B+2 / SSRF / bucket whitelist guards as handleCheckAnswer.
  //    Reuses the existing `image_urls`-shaped extractor by adapting the
  //    body for the canonical helper.
  const refsResult = extractStudentThreadAttachmentRefs(
    { image_urls: photosRaw } as Record<string, unknown>,
    userId,
    hwId,
    cors,
  );
  if (refsResult instanceof Response) return refsResult;
  const photoRefs = refsResult;

  // 5. Load target task (full SELECT — grading needs solution/rubric).
  const { data: task, error: taskError } = await db
    .from("homework_tutor_tasks")
    .select("id, assignment_id, order_num, task_text, task_image_url, ocr_text, correct_answer, rubric_text, rubric_image_urls, solution_text, solution_image_urls, max_score, check_format, task_kind, kim_number, cefr_level, grading_criteria_json, ai_reference_solution, ai_reference_status")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load task");
  }
  if (!task || task.assignment_id !== hwId) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Task not found in assignment");
  }
  const taskKind = (task.task_kind as string) ?? "extended";
  const numericTrim = numericRaw.trim();
  const textTrim = textRaw.trim();

  // 6. task_kind requirements.
  //    - 'speaking' → voice_ref required (устный монолог); numeric/text/photos
  //                   игнорируются. voice-speaking-mvp 2026-05-29.
  //    - 'numeric'  → numeric required, photos optional, text optional
  //    - 'extended' → at least one photo OR text required; numeric optional
  //                   (preview-QA #9 relax 2026-05-11: photo OR text — iPad
  //                    ученики пишут решение в редакторе без фото; numeric
  //                    остаётся «по желанию»)
  //    - 'proof'    → at least one photo required, numeric ignored
  let validatedVoiceRef: string | null = null;
  if (taskKind === "speaking") {
    if (!voiceRefRaw) {
      return jsonError(cors, 400, "VALIDATION", "voice_ref is required for speaking task");
    }
    // Validate ТОЛЬКО через канонический extractStudentThreadAttachmentRefs (не
    // вручную): те же Patch B+2 / SSRF / per-student namespace / bucket whitelist
    // guards, что и для фото — отличается только набор расширений (аудио).
    // voice_ref живёт в bucket homework-submissions, namespace
    // {userId}/{assignmentId}/threads/... (TASK-6 bucket-решение).
    const voiceRefsResult = extractStudentThreadAttachmentRefs(
      { image_urls: [voiceRefRaw] },
      userId,
      hwId,
      cors,
      THREAD_VOICE_EXTENSIONS,
    );
    if (voiceRefsResult instanceof Response) return voiceRefsResult;
    validatedVoiceRef = voiceRefsResult[0] ?? null;
    if (!validatedVoiceRef) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "Invalid voice reference");
    }
  } else if (taskKind === "numeric") {
    if (!numericTrim) {
      return jsonError(cors, 400, "VALIDATION", "numeric is required for numeric task");
    }
  } else if (taskKind === "extended") {
    if (photoRefs.length < 1 && !textTrim) {
      return jsonError(
        cors,
        400,
        "VALIDATION",
        "At least one photo OR text is required for extended task",
      );
    }
  } else if (taskKind === "proof") {
    // Preview-QA #10 (2026-05-11): proof relax — photo OR text. До
    // codex review был strict photos-only; Vladimir выбрал loose
    // вариант (как extended без numeric) для поддержки use cases:
    // ОГЭ описания + теоретические определения, где text-only решение
    // допустимо. Numeric ignored (proof = задача без числового ответа).
    if (photoRefs.length < 1 && !textTrim) {
      return jsonError(
        cors,
        400,
        "VALIDATION",
        "At least one photo OR text is required for proof task",
      );
    }
  } else {
    // Defensive: unknown task_kind — treat like 'extended' (photo OR text
    // required). Same relax as the named branch.
    if (photoRefs.length < 1 && !textTrim) {
      return jsonError(cors, 400, "VALIDATION", "At least one photo or text is required");
    }
  }

  // 7. Resolve thread (lazy provision if missing).
  const { data: existingThread, error: threadLookupError } = await db
    .from("homework_tutor_threads")
    .select("id, status, current_task_order, current_task_id, student_assignment_id")
    .eq("student_assignment_id", studentAssignment.id)
    .maybeSingle();
  if (threadLookupError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load thread");
  }
  let threadRow: Record<string, unknown> | null = existingThread
    ? (existingThread as Record<string, unknown>)
    : null;
  if (!threadRow) {
    const provisioned = await provisionGuidedThread(db, hwId, studentAssignment.id);
    if (provisioned) threadRow = provisioned;
  }
  if (!threadRow || typeof threadRow.id !== "string") {
    return jsonError(cors, 500, "DB_ERROR", "Failed to provision thread");
  }
  const threadId = threadRow.id as string;
  if (threadRow.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  // 8. Advance context — uses taskId as override so we grade the task the
  //    student actually submitted, not whatever the thread cursor says.
  const ctx = await loadAdvanceContext(db, threadId, threadRow, undefined, taskId);
  if (!ctx) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task to submit");
  }
  const { currentState, currentOrder } = ctx;

  // 9. Assignment subject + exam_type (for AI subject-rubric resolver, Phase 2 2026-05-15).
  const { data: assignment, error: assignmentError } = await db
    .from("homework_tutor_assignments")
    .select("subject, exam_type, feedback_language")
    .eq("id", hwId)
    .single();
  if (assignmentError || !assignment) {
    return jsonError(cors, 500, "DB_ERROR", "Assignment not found");
  }

  // 10. Conversation history for the target task (last 15 messages).
  const { data: recentMessages } = await db
    .from("homework_tutor_thread_messages")
    .select("role, content, visible_to_student, message_kind")
    .eq("thread_id", threadId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(15);

  // 3a→ AI-quota gate (moved here, fix #3 2026-05-29). Charged ONLY for a
  // fully-validated submission, immediately before the first AI operation
  // (Whisper for speaking; Gemini grading for numeric/extended/proof). One unit
  // covers both AI calls. Free-students with a paying tutor get 50/day (vs 10).
  const quotaResult = await checkAiQuota(userId, db, {
    incrementUsage: true,
    context: "homework",
  });
  if (!quotaResult.allowed) {
    console.warn(JSON.stringify({
      event: "homework_ai_quota_reached",
      handler: "handleStudentSubmission",
      userId,
      limit: quotaResult.limit,
      messagesUsed: quotaResult.messagesUsed,
      tutorCanUpgrade: quotaResult.tutorCanUpgrade,
    }));
    return buildLimitReachedResponse(quotaResult, cors);
  }

  // 11. Determine the answer text the AI will grade.
  //     - speaking → transcribe voice_ref via Whisper; transcript = answer.
  //     - numeric/extended/proof → synthesize from numeric + optional text.
  let answerText: string;
  if (taskKind === "speaking") {
    // Quota уже списана на шаге 3a — одна единица покрывает ОБЕ AI-операции
    // (Whisper + Gemini) на одну submission (§17). Пустой STT / сбой Whisper
    // ниже возвращают ДО insert'а submission-сообщения и ДО grading →
    // задача НЕ закрывается. Trade-off: квота списана 1 раз даже при пустом
    // STT — приемлемо (Whisper всё равно отработал). Spec §5 / tasks.md TASK-8.
    const voiceRef = validatedVoiceRef as string;
    const mimeType = voiceMimeFromExtension(getThreadAttachmentExtension(voiceRef));

    // Signed URL → rewriteToDirect для server-to-server fetch: edge function в
    // USA, гонять аудио через Москву = +200-400ms без пользы (rule 95).
    const signedUrl = await createSignedStorageUrl(db, voiceRef, "homework-submissions");
    if (!signedUrl) {
      return jsonError(cors, 502, "VOICE_URL_FAILED", "Не удалось получить запись для распознавания. Попробуй ещё раз.");
    }
    let audioBuffer: ArrayBuffer;
    try {
      const audioRes = await fetch(rewriteToDirect(signedUrl));
      if (!audioRes.ok) {
        throw new Error(`audio fetch status ${audioRes.status}`);
      }
      audioBuffer = await audioRes.arrayBuffer();
    } catch (err) {
      console.error("homework_voice_fetch_failed", {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonError(cors, 502, "VOICE_FETCH_FAILED", "Не удалось загрузить запись для распознавания. Попробуй ещё раз.");
    }

    let transcript: string;
    try {
      const transcription = await transcribeAudio(audioBuffer, {
        language: subjectToWhisperLang(assignment.subject),
        mimeType,
      }, {
        // ai-usage-logging (2026-07-06): source='voice'. hwId = assignment id.
        admin: db,
        userId,
        assignmentId: hwId,
      });
      transcript = transcription.text.trim();
    } catch (err) {
      const code = err instanceof VoiceTranscriptionError ? err.code : "TRANSCRIPTION_FAILED";
      console.error("homework_voice_transcribe_failed", { taskId, code });
      if (code === "MISSING_API_KEY") {
        return jsonError(cors, 503, "VOICE_UNAVAILABLE", "Распознавание речи временно недоступно. Попробуй позже.");
      }
      if (code === "AUDIO_TOO_LARGE") {
        return jsonError(cors, 413, "VOICE_TOO_LARGE", "Запись слишком длинная. Сократи ответ и запиши ещё раз.");
      }
      return jsonError(cors, 502, "VOICE_TRANSCRIPTION_FAILED", "Не удалось расшифровать запись. Попробуй записать ещё раз.");
    }

    if (!transcript) {
      // Пустой транскрипт (тишина / нераспознанное): НЕ зовём Gemini, задачу НЕ
      // закрываем, submission НЕ персистим — ученик перезаписывает (Spec §6
      // «никакой отправки вслепую» + AC TASK-8 «пустой STT → задача не закрыта»).
      return jsonError(cors, 422, "VOICE_EMPTY_TRANSCRIPT", "Не удалось распознать речь. Запиши ответ ещё раз — говори чуть громче и ближе к микрофону.");
    }
    answerText = transcript;
  } else {
    // For proof: photos are the "answer" (no numeric). For numeric/extended:
    // numeric is the formal answer, optional text is reasoning.
    const lines: string[] = [];
    if (taskKind !== "proof" && numericTrim) {
      lines.push(`Числовой ответ: ${numericTrim}`);
    }
    if (textTrim) {
      lines.push(textTrim);
    }
    answerText = lines.length > 0
      ? lines.join("\n")
      : "(см. фото решения)";
  }

  // 12. Insert submission message FIRST so the thread refetch at the
  //     end captures it (and the AI feedback inserted by the helper).
  //     `submission_payload` is JSONB — strictly the structured object
  //     {numeric, photos, text}; we never store free-form fields that
  //     the client would render as HTML.
  const serializedAttachments = serializeThreadAttachmentRefs(photoRefs);
  const { data: savedSubmissionMessage, error: saveSubmissionError } = await db
    .from("homework_tutor_thread_messages")
    .insert({
      thread_id: threadId,
      role: "user",
      content: answerText,
      task_id: taskId,
      task_order: currentOrder,
      message_kind: "submission",
      // voice-speaking-mvp (2026-05-29): speaking stores voice_ref in the
      // structured payload (TASK-10 tutor player reads submission_payload.voice_ref).
      // image_url stays unset for speaking (no photos) — voice is NOT an image.
      submission_payload: taskKind === "speaking"
        ? { numeric: "", photos: [], text: "", voice_ref: validatedVoiceRef }
        : { numeric: numericRaw, photos: photoRefs, text: textRaw },
      ...(serializedAttachments && { image_url: serializedAttachments }),
    })
    .select("id, role, content, image_url, task_id, task_order, message_kind, submission_payload, created_at, author_user_id, visible_to_student")
    .single();
  if (saveSubmissionError || !savedSubmissionMessage) {
    console.error("homework_api_submission_insert_failed", {
      threadId,
      hwId,
      taskId,
      error: saveSubmissionError?.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save submission message");
  }

  // 13. Update thread timestamps (mirror handleCheckAnswer).
  await db.from("homework_tutor_threads")
    .update({
      last_student_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  // 13b. Воронка (онбординг v2 T9): первая сдача ученика (раз на ученика).
  {
    let tId: string | null = null;
    let tStudentId: string | null = null;
    try {
      const { data: aRow } = await db
        .from("homework_tutor_assignments")
        .select("tutor_id")
        .eq("id", hwId)
        .maybeSingle();
      tId = (aRow?.tutor_id as string | null) ?? null;
      const { data: tsRow } = await db
        .from("tutor_students")
        .select("id")
        .eq("student_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      tStudentId = (tsRow?.id as string | null) ?? null;
    } catch {
      // best-effort
    }
    await logAnalyticsEventOnce(
      db,
      {
        event_name: "student_first_submission",
        actor_user_id: userId,
        student_id: userId,
        tutor_id: tId,
        tutor_student_id: tStudentId,
        assignment_id: hwId,
      },
      { student_id: userId },
    );
  }

  // 14. Run shared grading helper. feedbackKind="check_result" so the
  //     verdict bubble is semantically distinct from an ongoing dialog
  //     ai_reply.
  const responseData = await runStudentAnswerGrading({
    db,
    threadId,
    userId,
    studentAssignment,
    ctx,
    task,
    assignment,
    studentAnswer: answerText,
    recentMessages: (recentMessages ?? []) as Array<{
      role?: string | null;
      content?: string | null;
      visible_to_student?: boolean | null;
      message_kind?: string | null;
    }>,
    feedbackKind: "check_result",
  });

  // 15. Return the same shape as handleCheckAnswer + the freshly-fetched
  //     thread (which already includes the submission message + AI feedback
  //     + updated task_state, all stripped of tutor-only fields by
  //     fetchStudentThread).
  const updatedThread = await fetchStudentThread(db, threadId);
  if (
    updatedThread &&
    Array.isArray(updatedThread.homework_tutor_thread_messages)
  ) {
    const existingIndex = updatedThread.homework_tutor_thread_messages.findIndex(
      (message) => message.id === savedSubmissionMessage.id,
    );

    if (existingIndex >= 0) {
      const existingMessage = updatedThread.homework_tutor_thread_messages[existingIndex];
      if (!existingMessage.image_url && savedSubmissionMessage.image_url) {
        updatedThread.homework_tutor_thread_messages[existingIndex] = {
          ...existingMessage,
          image_url: savedSubmissionMessage.image_url,
        };
      }
    } else {
      updatedThread.homework_tutor_thread_messages = [
        ...updatedThread.homework_tutor_thread_messages,
        savedSubmissionMessage as Record<string, unknown>,
      ].sort((a, b) => {
        const aTime = typeof a.created_at === "string" ? Date.parse(a.created_at) : 0;
        const bTime = typeof b.created_at === "string" ? Date.parse(b.created_at) : 0;
        return aTime - bTime;
      });
    }
  }

  return jsonOk(cors, { ...responseData, thread: updatedThread });
}

// ─── Endpoint: POST /threads/:id/hint (student — Phase 3) ──────────────────

async function handleRequestHint(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  // AI-quota gate (same contract as handleCheckAnswer). Free-students with a paying tutor
  // get 50/day (vs 10) in homework context.
  const quotaResult = await checkAiQuota(userId, db, {
    incrementUsage: true,
    context: "homework",
  });
  if (!quotaResult.allowed) {
    console.warn(JSON.stringify({
      event: "homework_ai_quota_reached",
      handler: "handleRequestHint",
      userId,
      limit: quotaResult.limit,
      messagesUsed: quotaResult.messagesUsed,
      tutorCanUpgrade: quotaResult.tutorCanUpgrade,
    }));
    return buildLimitReachedResponse(quotaResult, cors);
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;

  // Get task_state for the requested task order
  const { data: allStates } = await db
    .from("homework_tutor_task_states")
    .select("id, task_id, status, attempts, best_score, available_score, wrong_answer_count, hint_count")
    .eq("thread_id", threadId);

  // Find the task state matching the requested order
  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", studentAssignment.assignment_id)
    .order("order_num", { ascending: true });

  const resolvedTask = resolveTaskReference(
    (tasks ?? []) as GuidedTaskIdentityRow[],
    {
      taskId: requestedTaskId,
      taskOrder: requestedTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!resolvedTask) {
    return jsonError(cors, 400, "VALIDATION", "Invalid task reference");
  }

  const currentOrder = resolvedTask.order_num;
  const activeState = allStates?.find((s: Record<string, unknown>) => s.task_id === resolvedTask.id);

  if (!activeState || activeState.status !== "active") {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task for hint");
  }

  // Load task (include rubric + reference solution so hint has full tutor context).
  // Before 2026-04-18, rubric_* and solution_* were missing from hint path — AI gave
  // generic hints that ignored tutor logic. See plan: wild-swinging-nova.md.
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, ocr_text, correct_answer, rubric_text, rubric_image_urls, solution_text, solution_image_urls, max_score, check_format, task_kind, kim_number, cefr_level")
    .eq("id", activeState.task_id)
    .single();

  if (!task) {
    return jsonError(cors, 500, "DB_ERROR", "Task not found");
  }

  // Load assignment for subject + exam_type (subject-rubric Phase 2 — 2026-05-15)
  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("subject, exam_type, feedback_language")
    .eq("id", studentAssignment.assignment_id)
    .single();

  // Load conversation history
  const { data: recentMessages } = await db
    .from("homework_tutor_thread_messages")
    .select("role, content, visible_to_student, message_kind")
    .eq("thread_id", threadId)
    .eq("task_id", task.id)
    .order("created_at", { ascending: true })
    .limit(15);

  // Save hint request message from user
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "user",
    content: "Подсказка",
    task_id: task.id,
    task_order: currentOrder,
    message_kind: "hint_request",
  });

  // Update last_student_message_at AND thread.updated_at (see handleCheckAnswer
  // for rationale — thread.updated_at остаётся honest "last activity" field).
  await db.from("homework_tutor_threads")
    .update({
      last_student_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  // Resolve task/rubric/solution images into AI-compatible data URLs, latest
  // student image into signed URLs, and tutor-curated student identity.
  // Phase 8 (2026-05-20): resolveStudentIdentity → name + gender.
  const [taskImageUrls, rubricImageUrls, solutionImageUrls, taskOcrText, studentImageUrls, studentIdentity] = await Promise.all([
    resolveTaskImageUrlsForAI(db, task.task_image_url),
    resolveTaskImageUrlsForAI(db, task.rubric_image_urls),
    resolveTaskImageUrlsForAI(db, task.solution_image_urls),
    ensureTaskOcrText(db, task, assignment?.subject ?? "math"),
    loadLatestStudentImageUrlsForTask(
      db,
      threadId,
      currentOrder,
      task.id,
      userId,
      studentAssignment.assignment_id,
    ),
    resolveStudentIdentity(db, studentAssignment.id),
  ]);
  const studentName = studentIdentity.name;
  const studentGender = studentIdentity.gender;

  // Call AI for hint
  const hintResult = await generateHint({
    taskText: task.task_text ?? "",
    taskImageUrls,
    studentImageUrls,
    taskOcrText,
    taskId: task.id ?? null,
    assignmentId: studentAssignment.assignment_id ?? null,
    correctAnswer: task.correct_answer,
    rubricText: task.rubric_text,
    rubricImageUrls,
    solutionText: task.solution_text,
    solutionImageUrls,
    subject: assignment?.subject ?? "math",
    // Phase 2 (2026-05-15) subject-rubric resolver inputs.
    examType: (assignment?.exam_type === "oge" || assignment?.exam_type === "ege")
      ? assignment.exam_type
      : null,
    kimNumber: typeof (task as { kim_number?: unknown }).kim_number === "number"
      ? (task as { kim_number: number }).kim_number
      : null,
    taskKind: (() => {
      const tk = (task as { task_kind?: unknown }).task_kind;
      return (tk === "numeric" || tk === "extended" || tk === "proof") ? tk : null;
    })(),
    // CEFR-level fix (2026-05-29): forward explicit tutor level to the hint rubric.
    cefrLevel: (() => {
      const cl = (task as { cefr_level?: unknown }).cefr_level;
      return (cl === "A1" || cl === "A2" || cl === "B1" || cl === "B2" || cl === "C1") ? cl : null;
    })(),
    // Phase 11 (2026-05-31): assignment-level feedback language.
    feedbackLanguage: normalizeFeedbackLanguage((assignment as { feedback_language?: unknown })?.feedback_language) ?? "auto",
    conversationHistory: recentMessages ?? [],
    wrongAnswerCount: (activeState.wrong_answer_count as number) ?? 0,
    hintCount: (activeState.hint_count as number) ?? 0,
    studentName,
    studentGender,
    // Ф5 (2026-07-23): педагогический контекст — только тон подсказки.
    learningContext: studentIdentity.learningContext,
    // ai-usage-logging (2026-07-06): source='homework_hint'. Fire-and-forget.
    logDb: db,
    logUserId: userId,
  });

  // Save hint reply
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: hintResult.hint,
    task_id: task.id,
    task_order: currentOrder,
    message_kind: "ai_reply",
  });

  // Update scoring
  const newHintCount = ((activeState.hint_count as number) ?? 0) + 1;
  const newWrongCount = (activeState.wrong_answer_count as number) ?? 0;
  const newAvailableScore = computeAvailableScore(
    task.max_score ?? 1, newWrongCount, newHintCount,
  );

  await db.from("homework_tutor_task_states").update({
    hint_count: newHintCount,
    available_score: newAvailableScore,
    updated_at: new Date().toISOString(),
  }).eq("id", activeState.id);

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  return jsonOk(cors, {
    hint: hintResult.hint,
    available_score: newAvailableScore,
    max_score: task.max_score ?? 1,
    hint_count: newHintCount,
    wrong_answer_count: newWrongCount,
    thread: updatedThread,
  });
}

// ─── Endpoint: GET /assignments/:id/students/:studentId/thread (tutor) ──────

async function handleGetTutorStudentThread(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid student ID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: studentAssignment, error: studentAssignmentError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (studentAssignmentError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load student assignment");
  }
  if (!studentAssignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Student is not assigned to this homework");
  }

  let thread: Record<string, unknown> | null;
  {
    const { data, error: threadError } = await db
      .from("homework_tutor_threads")
      .select(THREAD_SELECT)
      .eq("student_assignment_id", studentAssignment.id)
      .order("created_at", { referencedTable: "homework_tutor_thread_messages", ascending: true })
      .maybeSingle();

    if (threadError) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load thread");
    }
    thread = data as Record<string, unknown> | null;
  }

  // Lazy provisioning: create thread if it doesn't exist yet
  if (!thread) {
    thread = await provisionGuidedThread(db, assignmentId, studentAssignment.id);
  }

  if (!thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score, check_format")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks for thread");
  }

  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, username")
    .eq("id", studentId)
    .maybeSingle();

  // Resolve tutor identity (avatar + name + gender) and student identity
  // (name + gender) in parallel. Phase 8.1: returns both fields so the tutor
  // viewer can display AI-address preview chip showing exactly how AI talks
  // to this student (.claude/rules/40-homework-system.md Phase 8.1).
  const [tutorProfile, studentIdentity] = await Promise.all([
    resolveTutorProfileForAssignment(db, assignmentId),
    resolveStudentIdentity(db, studentAssignment.id),
  ]);

  const threadWithTutorProfile = {
    ...(thread as Record<string, unknown>),
    tutor_profile: tutorProfile,
  };

  return jsonOk(cors, {
    thread: threadWithTutorProfile,
    tasks: tasks ?? [],
    student: {
      id: profile?.id ?? studentId,
      full_name: profile?.full_name ?? null,
      username: profile?.username ?? null,
      display_name: studentIdentity.name,
      // Phase 8.1: AI gender для preview chip в GuidedThreadViewer.
      // Resolved through canonical priority: tutor_students.gender → profiles.gender → null.
      gender: studentIdentity.gender,
    },
  });
}

// ─── Endpoint: POST /assignments/:id/students/:studentId/thread/messages (tutor) ──

async function handleTutorPostMessage(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid student ID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  // Find student assignment
  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (!sa) {
    return jsonError(cors, 404, "NOT_FOUND", "Student is not assigned to this homework");
  }

  // Find thread
  const { data: thread } = await db
    .from("homework_tutor_threads")
    .select("id, status, current_task_order, current_task_id")
    .eq("student_assignment_id", sa.id)
    .maybeSingle();

  if (!thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  // Parse body
  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  if (!isNonEmptyString(b.content)) {
    return jsonError(cors, 400, "VALIDATION", "content is required");
  }
  const content = (b.content as string).trim();
  const visibleToStudent = b.visible_to_student !== false; // default true
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;
  const imageUrl = typeof b.image_url === "string" && b.image_url.trim() ? b.image_url.trim() : null;

  const { data: assignmentTasks, error: assignmentTasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });
  if (assignmentTasksError || !assignmentTasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve task reference");
  }

  const resolvedTask = resolveTaskReference(
    assignmentTasks as GuidedTaskIdentityRow[],
    {
      taskId: requestedTaskId,
      taskOrder: requestedTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!resolvedTask) {
    return jsonError(cors, 400, "VALIDATION", "Invalid task reference");
  }
  const taskOrder = resolvedTask.order_num;
  const taskId = resolvedTask.id;

  // Insert message with role = 'tutor'
  const { data: msg, error: msgErr } = await db
    .from("homework_tutor_thread_messages")
    .insert({
      thread_id: thread.id,
      role: "tutor",
      content,
      image_url: imageUrl,
      task_id: taskId,
      task_order: taskOrder,
      message_kind: visibleToStudent ? "tutor_message" : "tutor_note",
      visible_to_student: visibleToStudent,
      author_user_id: tutorUserId,
    })
    .select("id, created_at")
    .single();

  if (msgErr) {
    console.error("tutor_post_message_error", { error: msgErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save message");
  }

  // Update last_tutor_message_at
  await db
    .from("homework_tutor_threads")
    .update({ last_tutor_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", thread.id);

  return jsonOk(cors, { id: msg.id, created_at: msg.created_at }, 201);
}

// ─── Endpoint: GET /recent-dialogs (tutor) ───────────────────────────────────
//
// Powers the «Последние действия учеников» event feed on /tutor/home. Returns
// up to `RECENT_DIALOGS_DISPLAY_LIMIT` latest events per tutor, deduped by
// student_id (one student = one row, their single most recent event).
//
// Each item carries a `kind` discriminator (priority high→low when several
// signals coexist on one thread):
//   - 'completed'  — thread.status='completed' (ученик закрыл всё ДЗ).
//   - 'stuck'      — на задаче ≥ STUCK_WRONG неверных ИЛИ ≥ STUCK_HINT подсказок.
//   - 'submitted'  — последнее сообщение ученика = submission/answer (сдал решение).
//   - 'wrote'      — последнее сообщение ученика = question/hint_request (написал в чат).
//   - 'opened'     — ученик открыл условие задачи (task_states.student_opened_at),
//                    но ещё ничего не написал и не пытался решать.
//
// Threads без РЕАЛЬНОЙ активности (assigned-but-never-opened — нет message, нет
// counters, нет student_opened_at) ОТБРАСЫВАЮТСЯ. Раньше они ложно всплывали
// как «Открыл задачу №N», т.к. provisionGuidedThread пишет task_states с
// updated_at = now() при выдаче ДЗ (см. student_opened_at миграцию).
//
// Items sorted by `latestEventAt` DESC (самое свежее действие сверху).
//
// Why service_role: PostgREST nested embed filters через 3 уровня JOIN
// молча теряют строки при drift RLS. Единый серверный aggregation
// консистентен с handleGetThread / handleGetResults.

// Pilot-scale pre-fetch: ≤ 30 tutor students × ≤ few active assignments ≈
// well under 200 threads. We intentionally skip SQL ORDER BY because no
// single DB column is reliably bumped on every action — check/hint paths
// only update last_student_message_at, opens only student_opened_at. Sort
// happens in Deno over the enriched (latestEventAt) set. Cap at 500 as a
// safety ceiling; a tutor with that many active threads will get RPC-based
// aggregation in Phase 2 (parking lot).
const RECENT_DIALOGS_PREFETCH_LIMIT = 500;
const RECENT_DIALOGS_DISPLAY_LIMIT = 5;
// «Застрял» thresholds — single task accumulating this many wrong answers or
// hints reads as struggling. Tunable; kept conservative so the signal is rare.
const RECENT_DIALOGS_STUCK_WRONG = 3;
const RECENT_DIALOGS_STUCK_HINT = 3;

type RecentDialogKind = "opened" | "wrote" | "submitted" | "completed" | "stuck";
type RecentDialogAuthor = "student" | "tutor" | "ai";

interface RecentDialogItem {
  kind: RecentDialogKind;
  studentId: string;
  name: string;
  stream: "ЕГЭ" | "ОГЭ";
  /** Optional, backward-compat only — old clients read it; new UI branches on `kind`. */
  lastAuthor?: RecentDialogAuthor;
  unread: boolean;
  unreadCount: number;
  /** Human summary + graceful fallback for old clients that don't know `kind`. */
  preview: string;
  /** For 'opened' / 'submitted' / 'stuck' — номер задачи (1-based). */
  taskOrder?: number;
  at: string; // ISO timestamp — frontend formats it with date-fns
  hwId: string;
  hwTitle: string;
}

function buildPreviewForDialog(
  content: string | null | undefined,
  imageUrl: string | null | undefined,
): string {
  const raw = (content ?? "").trim();
  const LIMIT = 80;
  if (raw.length > 0) {
    return raw.length > LIMIT ? `${raw.slice(0, LIMIT).trimEnd()}…` : raw;
  }
  if (imageUrl) return "(фото)";
  return "(вложение)";
}

function parseIsoToMillis(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

async function handleGetRecentDialogs(
  db: SupabaseClient,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Response> {
  // 1. Load ALL candidate threads belonging to the tutor (no SQL ORDER BY).
  //    No single column is reliably bumped on every action, so we enrich and
  //    sort by latestEventAt in Deno. Limit 500 — pilot safety cap
  //    (≤ 30 students × ≤ 10 assignments << 500).
  type ThreadRow = {
    id: string;
    status: string | null;
    tutor_last_viewed_at: string | null;
    last_student_message_at: string | null;
    current_task_order: number | null;
    student_assignment_id: string;
    homework_tutor_student_assignments: {
      id: string;
      student_id: string;
      assignment_id: string;
      homework_tutor_assignments: {
        id: string;
        title: string | null;
        tutor_id: string;
        exam_type: string | null;
      };
    };
  };

  const { data: threadsData, error: threadsError } = await db
    .from("homework_tutor_threads")
    .select(`
      id,
      status,
      tutor_last_viewed_at,
      last_student_message_at,
      current_task_order,
      student_assignment_id,
      homework_tutor_student_assignments!inner (
        id,
        student_id,
        assignment_id,
        homework_tutor_assignments!inner (
          id,
          title,
          tutor_id,
          exam_type
        )
      )
    `)
    .eq(
      "homework_tutor_student_assignments.homework_tutor_assignments.tutor_id",
      tutorUserId,
    )
    .limit(RECENT_DIALOGS_PREFETCH_LIMIT);

  if (threadsError) {
    console.error("recent_dialogs_threads_error", { error: threadsError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load recent dialogs");
  }

  const threads = (threadsData ?? []) as unknown as ThreadRow[];
  if (threads.length === 0) return jsonOk(cors, { items: [] });

  // 2. Batch-fetch task_states for all threads: engagement counters + the real
  //    "opened" timestamp + the task's order_num (embedded via FK task_id).
  //    PostgREST has no GROUP BY — we aggregate per thread in Deno.
  type TaskStateRow = {
    thread_id: string;
    attempts: number | null;
    hint_count: number | null;
    wrong_answer_count: number | null;
    student_opened_at: string | null;
    homework_tutor_tasks: { order_num: number | null } | null;
  };
  const allThreadIds = threads.map((t) => t.id);
  const { data: taskStatesData, error: taskStatesError } = await db
    .from("homework_tutor_task_states")
    .select(
      "thread_id, attempts, hint_count, wrong_answer_count, student_opened_at, homework_tutor_tasks ( order_num )",
    )
    .in("thread_id", allThreadIds);

  if (taskStatesError) {
    console.error("recent_dialogs_task_states_error", {
      error: taskStatesError.message,
    });
    // Non-fatal: degrade to message-only signals (submitted / wrote).
  }

  // Per-thread aggregate: engagement flag, worst-task stuck signal, latest open.
  type TaskAgg = {
    hasCounters: boolean;
    maxWrong: number;
    maxHint: number;
    stuckScore: number; // max(wrong+hint) seen — picks the "worst" task order
    stuckOrder: number | null;
    maxOpenedMs: number; // max student_opened_at across the thread's tasks
    openedOrder: number | null;
  };
  const aggByThread = new Map<string, TaskAgg>();
  for (const row of (taskStatesData ?? []) as unknown as TaskStateRow[]) {
    const attempts = typeof row.attempts === "number" ? row.attempts : 0;
    const hint = typeof row.hint_count === "number" ? row.hint_count : 0;
    const wrong = typeof row.wrong_answer_count === "number" ? row.wrong_answer_count : 0;
    const order = typeof row.homework_tutor_tasks?.order_num === "number"
      ? row.homework_tutor_tasks.order_num
      : null;
    const openedMs = parseIsoToMillis(row.student_opened_at);
    const agg = aggByThread.get(row.thread_id) ?? {
      hasCounters: false,
      maxWrong: 0,
      maxHint: 0,
      stuckScore: -1,
      stuckOrder: null,
      maxOpenedMs: 0,
      openedOrder: null,
    };
    if (attempts > 0 || hint > 0 || wrong > 0) agg.hasCounters = true;
    if (wrong > agg.maxWrong) agg.maxWrong = wrong;
    if (hint > agg.maxHint) agg.maxHint = hint;
    // stuckOrder must point at a task that ITSELF crosses a stuck threshold.
    // Ranking by (wrong+hint) alone could pick a non-stuck task (e.g. 2+2=4)
    // over a genuinely stuck one (3+0=3) → wrong task number in «Застрял №N».
    // Among crossing tasks, keep the worst (max wrong+hint).
    const crossesStuck =
      wrong >= RECENT_DIALOGS_STUCK_WRONG || hint >= RECENT_DIALOGS_STUCK_HINT;
    if (crossesStuck && wrong + hint > agg.stuckScore) {
      agg.stuckScore = wrong + hint;
      agg.stuckOrder = order;
    }
    if (openedMs > 0 && openedMs >= agg.maxOpenedMs) {
      agg.maxOpenedMs = openedMs;
      agg.openedOrder = order;
    }
    aggByThread.set(row.thread_id, agg);
  }

  // 3. Keep only threads with GENUINE student activity. THIS IS THE BUG FIX:
  //    a merely-assigned, never-opened HW has provisioned task_states (so the
  //    old max(updated_at) signal lit up and surfaced «Открыл задачу №N»), but
  //    it has no student message, no counters and no student_opened_at — drop
  //    it. latestEventAt is built only from REAL event timestamps.
  type EnrichedThread = {
    row: ThreadRow;
    agg: TaskAgg | undefined;
    latestEventAtMs: number;
    latestEventAtIso: string;
    isCompleted: boolean;
  };

  const enrichedAll: EnrichedThread[] = [];
  for (const row of threads) {
    const agg = aggByThread.get(row.id);
    const lastStudentMessageAtMs = parseIsoToMillis(row.last_student_message_at);
    const maxOpenedMs = agg?.maxOpenedMs ?? 0;
    const isCompleted = row.status === "completed";
    const hasActivity =
      lastStudentMessageAtMs > 0 ||
      (agg?.hasCounters ?? false) ||
      maxOpenedMs > 0 ||
      isCompleted;
    if (!hasActivity) continue;
    const latestEventAtMs = Math.max(lastStudentMessageAtMs, maxOpenedMs);
    // No real student-event timestamp → skip. This also drops a thread that is
    // 'completed' but was closed by the tutor with zero student trace (no
    // message, no open): we surface STUDENT activity, not tutor actions. A
    // genuinely student-completed thread always has last_student_message_at.
    if (latestEventAtMs === 0) continue;

    enrichedAll.push({
      row,
      agg,
      latestEventAtMs,
      latestEventAtIso: new Date(latestEventAtMs).toISOString(),
      isCompleted,
    });
  }

  if (enrichedAll.length === 0) return jsonOk(cors, { items: [] });

  // 4. Sort by latestEventAt DESC, then dedup by student_id (one row per
  //    student = their single most recent event).
  enrichedAll.sort((a, b) => b.latestEventAtMs - a.latestEventAtMs);

  const seenStudents = new Set<string>();
  const picked: EnrichedThread[] = [];
  for (const e of enrichedAll) {
    const studentId = e.row.homework_tutor_student_assignments?.student_id;
    if (!studentId) continue;
    if (seenStudents.has(studentId)) continue;
    seenStudents.add(studentId);
    picked.push(e);
    if (picked.length >= RECENT_DIALOGS_DISPLAY_LIMIT) break;
  }

  if (picked.length === 0) return jsonOk(cors, { items: [] });

  const pickedThreadIds = picked.map((e) => e.row.id);
  const pickedStudentIds = Array.from(
    new Set(
      picked.map((e) => e.row.homework_tutor_student_assignments.student_id),
    ),
  );

  // 5. Latest STUDENT message PER picked thread — drives 'submitted' / 'wrote'
  //    classification and the 'wrote' preview. role='user', visible only
  //    (tutor notes / AI replies / system transitions are not student actions).
  //    One .limit(1) query per thread (≤ 5, parallel — same shape as the
  //    unread counts below). A single global-LIMIT query would let one chatty
  //    thread starve another's latest message out of the result set → that
  //    thread then misclassifies as 'opened' even though the student
  //    wrote/submitted (resurrecting the false-"opened" bug). Per-thread
  //    .limit(1) makes starvation impossible.
  type MessageRow = {
    thread_id: string;
    content: string | null;
    image_url: string | null;
    message_kind: string | null;
    task_order: number | null;
    created_at: string;
  };
  const latestMsgResults = await Promise.all(
    pickedThreadIds.map(async (tid) => {
      const { data, error } = await db
        .from("homework_tutor_thread_messages")
        .select("thread_id, content, image_url, message_kind, task_order, created_at")
        .eq("thread_id", tid)
        .eq("role", "user")
        .neq("visible_to_student", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Non-fatal: a single bad thread must not blank the whole feed.
        console.error("recent_dialogs_latest_msg_error", {
          thread_id: tid,
          error: error.message,
        });
        return null;
      }
      return data as MessageRow | null;
    }),
  );
  const latestStudentMsgByThread = new Map<string, MessageRow>();
  for (const m of latestMsgResults) {
    if (m) latestStudentMsgByThread.set(m.thread_id, m);
  }

  // 4. Resolve student names via tutor_students (display_name) + profiles.username fallback.
  //    tutor_students.tutor_id references public.tutors.id (not auth.uid) — we need
  //    the tutor row id here. Reuse the standard lookup.
  const { data: tutorRow } = await db
    .from("tutors")
    .select("id")
    .eq("user_id", tutorUserId)
    .maybeSingle();

  type StudentRow = {
    student_id: string;
    display_name: string | null;
    exam_type: string | null;
    profiles: { username: string | null } | null;
  };
  const studentMap = new Map<string, StudentRow>();
  if (tutorRow?.id) {
    const { data: studentsData } = await db
      .from("tutor_students")
      .select("student_id, display_name, exam_type, profiles ( username )")
      .eq("tutor_id", tutorRow.id)
      .in("student_id", pickedStudentIds);
    for (const s of (studentsData ?? []) as unknown as StudentRow[]) {
      studentMap.set(s.student_id, s);
    }
  }

  // 6. Assemble response.
  const STREAM_LABEL: Record<string, "ЕГЭ" | "ОГЭ"> = {
    ege: "ЕГЭ",
    oge: "ОГЭ",
  };

  // 6a. Per-thread unread count: number of student messages (role='user',
  //     visible_to_student != false) with created_at > tutor_last_viewed_at.
  //     For 'opened'-only threads the count is naturally 0 (no student msg) →
  //     the row shows a dot, not a badge. One COUNT query per picked thread
  //     (≤ 5) — cheap thanks to index (thread_id, created_at).
  const unreadCounts = await Promise.all(
    picked.map(async (e) => {
      const viewedAtIso = e.row.tutor_last_viewed_at ?? "1970-01-01T00:00:00Z";
      const { count, error } = await db
        .from("homework_tutor_thread_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", e.row.id)
        .eq("role", "user")
        .neq("visible_to_student", false)
        .gt("created_at", viewedAtIso);
      if (error) {
        console.error("recent_dialogs_unread_count_error", {
          thread_id: e.row.id,
          error: error.message,
        });
        return { threadId: e.row.id, count: 0 };
      }
      return { threadId: e.row.id, count: count ?? 0 };
    }),
  );
  const unreadMap = new Map<string, number>();
  for (const u of unreadCounts) unreadMap.set(u.threadId, u.count);

  // ` №N` suffix only when a task order is known.
  const taskSuffix = (order: number | null | undefined): string =>
    typeof order === "number" ? ` №${order}` : "";

  const items: RecentDialogItem[] = picked.map((e) => {
    const t = e.row;
    const sa = t.homework_tutor_student_assignments;
    const assignment = sa.homework_tutor_assignments;
    const studentId = sa.student_id;
    const student = studentMap.get(studentId);
    const agg = e.agg;
    const latestMsg = latestStudentMsgByThread.get(t.id);
    const fallbackOrder = typeof t.current_task_order === "number"
      ? t.current_task_order
      : null;

    const streamKey =
      (assignment.exam_type ?? student?.exam_type ?? "").toLowerCase();
    const stream = STREAM_LABEL[streamKey] ?? "ЕГЭ";
    const name =
      student?.display_name?.trim() ||
      student?.profiles?.username?.trim() ||
      "Ученик";

    // Unread triggers off latestEventAt. GuidedThreadViewer on mount sets
    // tutor_last_viewed_at = NOW() → the signal clears on next /tutor/home load.
    const tutorViewedAtMs = parseIsoToMillis(t.tutor_last_viewed_at);
    const unread = e.latestEventAtMs > tutorViewedAtMs;
    const unreadCount = unreadMap.get(t.id) ?? 0;

    // Classify the headline event — priority high→low. `preview` doubles as
    // the graceful-degradation line for old clients that don't know `kind`.
    const mk = latestMsg?.message_kind ?? null;
    let kind: RecentDialogKind;
    let taskOrder: number | undefined;
    let preview: string;
    if (e.isCompleted) {
      kind = "completed";
      preview = "Завершил ДЗ";
    } else if (
      agg &&
      (agg.maxWrong >= RECENT_DIALOGS_STUCK_WRONG ||
        agg.maxHint >= RECENT_DIALOGS_STUCK_HINT)
    ) {
      kind = "stuck";
      taskOrder = (agg.stuckOrder ?? fallbackOrder) ?? undefined;
      preview = `Застрял на задаче${taskSuffix(taskOrder)}`;
    } else if (mk === "submission" || mk === "answer") {
      kind = "submitted";
      const msgOrder = typeof latestMsg?.task_order === "number"
        ? latestMsg.task_order
        : null;
      taskOrder = (msgOrder ?? fallbackOrder) ?? undefined;
      preview = `Сдал задачу${taskSuffix(taskOrder)}`;
    } else if (mk === "hint_request") {
      kind = "wrote";
      preview = "Попросил подсказку";
    } else if (latestMsg) {
      // 'question' or any other student-authored chat message.
      kind = "wrote";
      preview = buildPreviewForDialog(latestMsg.content, latestMsg.image_url);
    } else if ((agg?.maxOpenedMs ?? 0) > 0) {
      // Only opened the statement — no message, no counters.
      kind = "opened";
      taskOrder = ((agg?.openedOrder ?? null) ?? fallbackOrder) ?? undefined;
      preview = `Открыл условие задачи${taskSuffix(taskOrder)}`;
    } else {
      // Defensive: kept by genuine activity but no message row / open ts
      // resolved (shouldn't happen with the per-thread fetch above). NEVER
      // claim 'opened' here — that would resurrect the false-"opened" bug.
      kind = "wrote";
      preview = "Работает над ДЗ";
    }

    return {
      kind,
      studentId,
      name,
      stream,
      // Backward-compat chip for old clients (they render "Ученик"); new UI
      // branches on `kind` and ignores this.
      lastAuthor: "student",
      unread,
      unreadCount,
      preview,
      taskOrder,
      at: e.latestEventAtIso,
      hwId: assignment.id,
      hwTitle: assignment.title ?? "Без названия",
    };
  });

  return jsonOk(cors, { items });
}

// ─── Endpoint: POST /threads/:id/viewed-by-tutor (tutor) ─────────────────────
//
// Marks a thread as "seen" by the tutor — clears the unread indicator on
// /tutor/home. Called fire-and-forget from GuidedThreadViewer when it mounts
// for a specific tutor+student+assignment.

async function handleMarkThreadViewed(
  db: SupabaseClient,
  tutorUserId: string,
  threadId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(threadId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid thread ID");
  }

  // Verify ownership: thread → student_assignment → assignment.tutor_id == tutorUserId.
  type OwnershipRow = {
    id: string;
    homework_tutor_student_assignments: {
      homework_tutor_assignments: { tutor_id: string | null } | null;
    } | null;
  };
  const { data: ownership, error: ownershipError } = await db
    .from("homework_tutor_threads")
    .select(`
      id,
      homework_tutor_student_assignments!inner (
        homework_tutor_assignments!inner ( tutor_id )
      )
    `)
    .eq("id", threadId)
    .maybeSingle();

  if (ownershipError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify thread ownership");
  }
  const ownershipRow = ownership as unknown as OwnershipRow | null;
  const ownerTutorId =
    ownershipRow?.homework_tutor_student_assignments
      ?.homework_tutor_assignments?.tutor_id ?? null;
  if (!ownershipRow || ownerTutorId !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Thread does not belong to you");
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await db
    .from("homework_tutor_threads")
    .update({ tutor_last_viewed_at: nowIso })
    .eq("id", threadId);

  if (updateError) {
    console.error("mark_thread_viewed_error", { error: updateError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to mark thread as viewed");
  }

  return jsonOk(cors, { ok: true, viewed_at: nowIso });
}

// ─── Endpoint: POST /tutor/demo-check (tutor demo — «проверить свою задачу») ──
//
// v2.1 W1-B: live-разбор ad-hoc задачи+ответа репетитора БЕЗ assignment/student/
// DB-строк — сдвиг aha влево (увидеть проверку Сократа на своём контенте до
// подключения учеников). Reuse `evaluateStudentAnswer` (ядро грейдинга) в ЭТОЙ
// же функции → ноль cross-function import. Text-only V1 (фото — follow-up).
//
// Квота (rule 99): НЕ трогает ученическую дневную квоту; свой per-tutor дневной
// cap (счётчик = прошедшие `tutor_demo_check_ran` за сегодня, без новой таблицы).
const DEMO_CHECK_DAILY_CAP = 10;
const DEMO_CHECK_DEFAULT_MAX_SCORE = 3;
const DEMO_CHECK_MAX_IMAGES = 3;

/**
 * Валидирует демо-рефы фото: принимаем ТОЛЬКО kb-attachments в namespace
 * вызывающего тутора (`storage://kb-attachments/{userId}/...`) — чтобы через
 * демо нельзя было прочитать чужую картинку (ownership поверх SSRF/bucket-гардов
 * resolveTaskImageUrlForAI). Cap 3. Чужое/битое молча дропаем.
 */
function validateDemoImageRefs(refs: unknown, userId: string): string[] {
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const r of refs) {
    if (typeof r !== "string") continue;
    const m = r.match(/^storage:\/\/kb-attachments\/([^/]+)\//);
    if (m && m[1] === userId) out.push(r);
    if (out.length >= DEMO_CHECK_MAX_IMAGES) break;
  }
  return out;
}

async function handleTutorDemoCheck(
  db: SupabaseClient,
  userId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  // 1. Только репетитор (ученик не должен юзать демо как бесплатный грейдер).
  const { data: isTutor, error: roleErr } = await db.rpc("is_tutor", {
    _user_id: userId,
  });
  if (roleErr) {
    return jsonError(cors, 500, "ROLE_CHECK_FAILED", "Не удалось проверить роль. Попробуйте ещё раз.");
  }
  if (!isTutor) {
    return jsonError(cors, 403, "NOT_A_TUTOR", "Демо-разбор доступен только репетитору.");
  }

  // tutors.id для аналитики — воронка репетитора джойнится по tutors.id
  // (tutor_first_student_added / tutor_first_homework_created пишут tutor.id),
  // НЕ auth.uid (FK-дрейф rule 40). Fallback userId, чтобы не терять событие.
  let tutorPkId = userId;
  {
    const { data: tRow } = await db
      .from("tutors")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (tRow?.id) tutorPkId = tRow.id as string;
  }

  const bodyObj = (body && typeof body === "object") ? body as Record<string, unknown> : {};

  // 1b. action='view' — лёгкий beacon «открыл готовый пример» (без AI/cap).
  //     Once-per-tutor (funnel-сигнал «дошёл до демо»).
  if (bodyObj.action === "view") {
    await logAnalyticsEventOnce(
      db,
      { event_name: "tutor_demo_check_viewed", actor_user_id: userId, tutor_id: tutorPkId },
      { tutor_id: tutorPkId },
    );
    return jsonOk(cors, { ok: true });
  }

  // 2. Дневной cap — считаем прошедшие демо-разборы за сегодня (UTC-midnight).
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const { count: ranToday } = await db
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("event_name", "tutor_demo_check_ran")
    .eq("tutor_id", tutorPkId)
    .gte("occurred_at", midnight.toISOString());
  if ((ranToday ?? 0) >= DEMO_CHECK_DAILY_CAP) {
    return jsonError(
      cors,
      429,
      "DEMO_LIMIT_REACHED",
      `Сегодня уже ${DEMO_CHECK_DAILY_CAP} демо-разборов. Попробуйте завтра или отправьте задачу реальному ученику.`,
    );
  }

  // 3. Валидация входа (текст и/или фото — как в ДЗ).
  const b = bodyObj;
  const subject =
    isNonEmptyString(b.subject) &&
    (VALID_SUBJECTS_UPDATE as readonly string[]).includes(b.subject)
      ? b.subject
      : null;
  if (!subject) {
    return jsonError(cors, 400, "VALIDATION", "Укажите предмет.");
  }
  const taskText = isNonEmptyString(b.task_text) ? b.task_text.trim() : "";
  const answerText = isNonEmptyString(b.answer_text) ? b.answer_text.trim() : "";
  // Фото задачи/ответа (как в ДЗ) — только свой namespace kb-attachments, cap 3.
  const taskImageRefs = validateDemoImageRefs(b.task_image_refs, userId);
  const answerImageRefs = validateDemoImageRefs(b.answer_image_refs, userId);
  if (!taskText && taskImageRefs.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Добавьте условие задачи (текст или фото).");
  }
  if (!answerText && answerImageRefs.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Добавьте ответ ученика (текст или фото).");
  }
  const examType =
    isNonEmptyString(b.exam_type) &&
    (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type)
      ? (b.exam_type as "ege" | "oge")
      : "ege";
  const kimNumber = normalizeKimNumber(b.kim_number);
  // Формат проверки — как в ДЗ: 'short_answer' = лайт-проверка краткого ответа;
  // 'detailed_solution' = развёрнутое (критерии ФИПИ, физ-Часть-2 flowchart).
  // Дефолт — развёрнутое (демо продаёт именно покритериальный разбор).
  const checkFormat: "short_answer" | "detailed_solution" =
    b.check_format === "short_answer" ? "short_answer" : "detailed_solution";
  // Макс. балл — опц. от репетитора (шкала предмета: физика № 24 = 3, общество
  // № 25 = 4 и т.п.). Физика № 21-26 → walker ставит свой max (см. ответ), иначе
  // holistic по этой шкале. Если задан и НЕвалиден → 400 (не тихая подмена на 3
  // — иначе демо показало бы другую шкалу, review P2). Пусто/нет → дефолт 3.
  let maxScore = DEMO_CHECK_DEFAULT_MAX_SCORE;
  if (b.max_score !== undefined && b.max_score !== null && b.max_score !== "") {
    const m = typeof b.max_score === "number" ? b.max_score : Number(b.max_score);
    if (!Number.isInteger(m) || m < 1 || m > 100) {
      return jsonError(cors, 400, "VALIDATION", "Макс. балл — целое число от 1 до 100.");
    }
    maxScore = m;
  }

  // Резолвим фото → inline base64/signed для AI (reuse resolveTaskImageUrlsForAI:
  // те же SSRF/bucket/size-гарды, что в реальной проверке). Пусто → [].
  // Placeholder-текст при photo-only (как в ДЗ) — картинку AI получает отдельно.
  const [taskImageUrls, studentImageUrls] = await Promise.all([
    resolveTaskImageUrlsForAI(db, taskImageRefs.length > 0 ? JSON.stringify(taskImageRefs) : null),
    resolveTaskImageUrlsForAI(db, answerImageRefs.length > 0 ? JSON.stringify(answerImageRefs) : null),
  ]);
  const taskTextForAi = taskText || "[Задача на фото]";
  const studentAnswerForAi = answerText || "(решение на фото)";

  // 4. Грейдинг — reuse evaluateStudentAnswer. Ad-hoc: нет solution/rubric.
  //    task_kind='extended' + detailed_solution → развёрнутый разбор (демо-цель).
  //    Физика + kim_number № 21-26 → flowchart-трасса; языки → criteria_breakdown.
  //    Токены логируются в token_usage_logs под source='demo_check' (observability).
  let result;
  try {
    result = await evaluateStudentAnswer({
      studentAnswer: studentAnswerForAi,
      taskText: taskTextForAi,
      taskImageUrls,
      studentImageUrls,
      correctAnswer: null,
      rubricText: null,
      solutionText: null,
      subject,
      examType,
      kimNumber,
      taskKind: checkFormat === "short_answer" ? "numeric" : "extended",
      checkFormat,
      conversationHistory: [],
      wrongAnswerCount: 0,
      hintCount: 0,
      availableScore: maxScore,
      maxScore,
      studentName: null,
      studentGender: null,
      logDb: db,
      logUserId: userId,
      logSource: "demo_check",
    });
  } catch (e) {
    console.error("demo_check_grading_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return jsonError(cors, 502, "GRADING_FAILED", "Не удалось разобрать работу. Попробуйте ещё раз.");
  }

  // 5. Телеметрия (PII-free): демо-разбор прогнан (= инкремент cap-счётчика).
  await logAnalyticsEvent(db, {
    event_name: "tutor_demo_check_ran",
    actor_user_id: userId,
    tutor_id: tutorPkId,
    source: subject,
    meta: {
      verdict: result.verdict,
      has_flowchart: Boolean(result.flowchart_trace),
      has_criteria: Boolean(result.criteria_breakdown),
    },
  });

  // 6. Ответ — только результат разбора (ai_score_comment tutor-only → не шлём).
  return jsonOk(cors, {
    verdict: result.verdict,
    feedback: result.feedback,
    ai_score: result.ai_score,
    max_score: result.flowchart_trace?.max_score ?? maxScore,
    criteria_breakdown: result.criteria_breakdown ?? null,
    flowchart_trace: result.flowchart_trace ?? null,
  });
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  const startTime = Date.now();

  console.log("homework_api_request_start", {
    method: route.method,
    segments: route.segments,
  });

  try {
    const authResult = await authenticateUser(req, cors);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const seg = route.segments;

    // GET /threads/:id (student endpoint)
    if (seg.length === 2 && seg[0] === "threads" && route.method === "GET") {
      return await handleGetThread(db, userId, seg[1], cors);
    }

    // POST /threads/:id/transcribe-voice (student endpoint)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "transcribe-voice" && route.method === "POST") {
      return await handleTranscribeThreadVoice(db, userId, seg[1], req, cors);
    }

    // POST /threads/:id/messages (student endpoint)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "messages" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handlePostThreadMessage(db, userId, seg[1], body, cors);
    }

    // POST /threads/:id/advance (student endpoint)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "advance" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleAdvanceTask(db, userId, seg[1], body, cors);
    }

    // POST /threads/:id/check (student endpoint — Phase 3)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "check" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCheckAnswer(db, userId, seg[1], body, cors);
    }

    // POST /threads/:id/hint (student endpoint — Phase 3)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "hint" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleRequestHint(db, userId, seg[1], body, cors);
    }

    // POST /tutor/demo-check (tutor endpoint — демо-разбор своей задачи, v2.1 W1-B)
    if (seg.length === 2 && seg[0] === "tutor" && seg[1] === "demo-check" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleTutorDemoCheck(db, userId, body, cors);
    }

    // POST /threads/:id/viewed-by-tutor (tutor endpoint — TASK-7 follow-up)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "viewed-by-tutor" && route.method === "POST") {
      return await handleMarkThreadViewed(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/thread (student endpoint — thread + tutor_profile)
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "thread" && route.method === "GET") {
      return await handleGetStudentThreadByAssignment(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/student (student endpoint)
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "student" && route.method === "GET") {
      return await handleGetStudentAssignment(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/identity (student endpoint) — Phase 8 regression fix
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "identity" && route.method === "GET") {
      return await handleGetStudentIdentity(db, userId, seg[1], cors);
    }

    // GET /student/problem/:hwId/:taskId
    // (Phase 1 student-side problem screen — single-task surface.
    //  Spec: docs/delivery/features/student-homework-problem-screen/spec.md §5)
    if (
      seg.length === 4 &&
      seg[0] === "student" &&
      seg[1] === "problem" &&
      route.method === "GET"
    ) {
      return await handleGetStudentProblem(db, userId, seg[2], seg[3], cors);
    }

    // POST /student/problem/:hwId/:taskId/submission
    // (Phase 1 student-side problem screen — single-shot submit.
    //  Spec: docs/delivery/features/student-homework-problem-screen/spec.md §5)
    if (
      seg.length === 5 &&
      seg[0] === "student" &&
      seg[1] === "problem" &&
      seg[4] === "submission" &&
      route.method === "POST"
    ) {
      const submissionBody = await parseJsonBody(req);
      return await handleStudentSubmission(db, userId, seg[2], seg[3], submissionBody, cors);
    }

    // GET /assignments/:id/tasks/:taskId/image-url (tutor + student)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "image-url" && route.method === "GET") {
      return await handleTaskImageSignedUrl(db, userId, seg[1], seg[3], cors);
    }

    // GET /assignments/:id/tasks/:taskId/images (tutor + student)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "images" && route.method === "GET") {
      return await handleTaskImagesSignedUrls(db, userId, seg[1], seg[3], cors);
    }

    // GET /formula-rounds/:roundId (student endpoint)
    if (seg.length === 2 && seg[0] === "formula-rounds" && route.method === "GET") {
      return await handleGetFormulaRound(db, userId, seg[1], cors);
    }

    // GET /formula-rounds/:roundId/results (student endpoint)
    if (seg.length === 3 && seg[0] === "formula-rounds" && seg[2] === "results" && route.method === "GET") {
      return await handleListFormulaRoundResults(db, userId, seg[1], cors);
    }

    // POST /formula-rounds/:roundId/results (student endpoint)
    if (seg.length === 3 && seg[0] === "formula-rounds" && seg[2] === "results" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateFormulaRoundResult(db, userId, seg[1], body, cors);
    }

    const tutorResult = await getTutorOrThrow(db, userId, cors);
    if (tutorResult instanceof Response) return tutorResult;
    const tutor = tutorResult;

    // GET /recent-dialogs (tutor — TASK-7 follow-up)
    if (seg.length === 1 && seg[0] === "recent-dialogs" && route.method === "GET") {
      return await handleGetRecentDialogs(db, userId, cors);
    }

    // POST /assignments
    if (seg.length === 1 && seg[0] === "assignments" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateAssignment(db, userId, tutor.id, body, cors);
    }

    // GET /assignments
    if (seg.length === 1 && seg[0] === "assignments" && route.method === "GET") {
      return await handleListAssignments(db, userId, route.searchParams, cors);
    }

    // GET /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "GET") {
      return await handleGetAssignment(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/tasks/:taskId/rubric-images (tutor only)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "rubric-images" && route.method === "GET") {
      return await handleRubricImagesSignedUrls(db, userId, seg[1], seg[3], cors);
    }

    // GET /assignments/:id/students/:studentId/thread
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "students" && seg[4] === "thread" && route.method === "GET") {
      return await handleGetTutorStudentThread(db, userId, seg[1], seg[3], cors);
    }

    // POST /assignments/:id/students/:studentId/thread/messages (tutor)
    if (seg.length === 6 && seg[0] === "assignments" && seg[2] === "students" && seg[4] === "thread" && seg[5] === "messages" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleTutorPostMessage(db, userId, seg[1], seg[3], body, cors);
    }



    // PUT /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "PUT") {
      const body = await parseJsonBody(req);
      return await handleUpdateAssignment(db, userId, tutor.id, seg[1], body, cors);
    }

    // DELETE /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "DELETE") {
      return await handleDeleteAssignment(db, userId, seg[1], cors);
    }

    // POST /assignments/:id/assign
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "assign" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleAssignStudents(db, userId, tutor.id, seg[1], body, cors);
    }

    // POST /assignments/:id/assign-students (quick add + cascade notify, 2026-05-25)
    if (
      seg.length === 3 &&
      seg[0] === "assignments" &&
      seg[2] === "assign-students" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleQuickAssignStudentsWithNotify(db, userId, tutor.id, seg[1], body, cors);
    }

    // POST /assignments/:id/connect-student-email (онбординг v2 — гейт «Подключить» → email)
    if (
      seg.length === 3 &&
      seg[0] === "assignments" &&
      seg[2] === "connect-student-email" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleConnectStudentByEmail(db, userId, tutor.id, seg[1], body, cors);
    }

    // POST /assignments/:id/notify
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "notify" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleNotifyStudents(db, userId, seg[1], body, cors);
    }

    // POST /assignments/:id/students/:sid/remind
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "students" && seg[4] === "remind" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleRemindStudent(db, userId, seg[1], seg[3], body, cors);
    }

    // POST /assignments/:id/students/:sid/overall-comment (Phase 12, 2026-06-07)
    if (
      seg.length === 5 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "overall-comment" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleSetStudentOverallComment(db, userId, seg[1], seg[3], body, cors);
    }

    // GET /assignments/:id/results
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "results" && route.method === "GET") {
      return await handleGetResults(db, userId, seg[1], cors);
    }

    // PATCH /assignments/:id/students/:sid/tasks/:tid/score-override
    if (
      seg.length === 7 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "tasks" &&
      seg[6] === "score-override" &&
      route.method === "PATCH"
    ) {
      const body = await parseJsonBody(req) as Record<string, unknown>;
      return await handleSetTutorScoreOverride(db, userId, seg[1], seg[3], seg[5], body, cors);
    }

    // POST /assignments/:id/students/:sid/force-complete-all-tasks (2026-05-16)
    if (
      seg.length === 5 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "force-complete-all-tasks" &&
      route.method === "POST"
    ) {
      return await handleBulkForceCompleteStudentTasks(db, userId, seg[1], seg[3], cors);
    }

    // POST /assignments/:id/materials
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "materials" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleAddMaterial(db, userId, seg[1], body, cors);
    }

    // DELETE /assignments/:id/materials/:mid
    if (seg.length === 4 && seg[0] === "assignments" && seg[2] === "materials" && route.method === "DELETE") {
      return await handleDeleteMaterial(db, userId, seg[1], seg[3], cors);
    }

    // GET /assignments/:id/materials/:mid/signed-url
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "materials" && seg[4] === "signed-url" && route.method === "GET") {
      return await handleMaterialSignedUrl(db, userId, seg[1], seg[3], cors);
    }

    // GET /templates
    if (seg.length === 1 && seg[0] === "templates" && route.method === "GET") {
      return await handleListTemplates(db, userId, route.searchParams, cors);
    }

    // POST /templates
    if (seg.length === 1 && seg[0] === "templates" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateTemplate(db, userId, body, cors);
    }

    // POST /templates/:id/fork (unified-task-model, 2026-07-05)
    if (seg.length === 3 && seg[0] === "templates" && seg[2] === "fork" && route.method === "POST") {
      return await handleForkTemplate(db, userId, seg[1], cors);
    }

    // GET /templates/:id
    if (seg.length === 2 && seg[0] === "templates" && route.method === "GET") {
      return await handleGetTemplate(db, userId, seg[1], cors);
    }

    // PATCH /templates/:id (homework-reuse-v1 TASK-6, AC-17)
    if (seg.length === 2 && seg[0] === "templates" && route.method === "PATCH") {
      const body = await parseJsonBody(req);
      return await handleUpdateTemplate(db, userId, seg[1], body, cors);
    }

    // DELETE /templates/:id
    if (seg.length === 2 && seg[0] === "templates" && route.method === "DELETE") {
      return await handleDeleteTemplate(db, userId, seg[1], cors);
    }

    // POST /assignments/:id/save-as-template (homework-reuse-v1 TASK-6, AC-14)
    if (
      seg.length === 3 &&
      seg[0] === "assignments" &&
      seg[2] === "save-as-template" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleCreateTemplateFromAssignment(db, userId, seg[1], body, cors);
    }

    // POST /assignments/:id/save-tasks-to-kb (homework-reuse-v1 TASK-5, AC-10..13)
    if (
      seg.length === 3 &&
      seg[0] === "assignments" &&
      seg[2] === "save-tasks-to-kb" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleSaveTasksToKB(db, userId, seg[1], body, cors);
    }

    // POST /assignments/:id/tasks/:taskId/push-to-kb (unified-task-model, 2026-07-05)
    if (
      seg.length === 5 &&
      seg[0] === "assignments" &&
      seg[2] === "tasks" &&
      seg[4] === "push-to-kb" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleTaskPushToKb(db, userId, seg[1], seg[3], body, cors);
    }

    // POST /assignments/:id/share-links (homework-reuse-v1 TASK-7)
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "share-links" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateShareLink(db, userId, seg[1], body, cors);
    }

    // GET /assignments/:id/share-links
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "share-links" && route.method === "GET") {
      return await handleListShareLinks(db, userId, seg[1], cors);
    }

    // DELETE /share-links/:slug
    if (seg.length === 2 && seg[0] === "share-links" && route.method === "DELETE") {
      return await handleDeleteShareLink(db, userId, seg[1], cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", `Route not found: ${route.method} /${seg.join("/")}`);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("homework_api_request_error", {
      error: String(err),
      elapsed_ms: elapsed,
    });
    return jsonError(cors, 500, "INTERNAL_ERROR", "Internal server error");
  }
});
