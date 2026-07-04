// strict-criteria-grading Phase 3 / Phase A (2026-06-30):
// Фоновая генерация AI-ЭТАЛОНА решения задач ДЗ.
//
// Триггерится fire-and-forget из homework-api (handleCreate/UpdateAssignment)
// с { assignment_id }. service_role-only (internal). Для физики + развёрнутых
// задач (task_kind extended/proof) без tutor `solution_text` AI решает задачу
// сам → кэш в `homework_tutor_tasks.ai_reference_solution` (+ confidence/status).
// Эталон переиспользуется всеми учениками задачи (амортизация) и потребляется
// Phase B грейдингом (сравнение решения ученика с эталоном).
//
// Инварианты:
//   - Балл здесь НЕ считается — это только генерация эталона.
//   - Эталон tutor-only (никогда ученику; anti-leak — миграция 20260630160000).
//   - НЕ идёт через checkAiQuota (tutor-initiated, one-time, амортизируется).
//   - Если tutor задал solution_text — AI не решает (репетиторский эталон wins).
//   - Идемпотентность: генерим только status NULL/failed; claim → pending.
//   - Если функция не задеплоена — homework-api fetch свалится молча (граничная
//     деградация; репетитор/следующая правка перезапустят).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  callLovableJson,
  inlineImageUrlToBase64,
  type LovableImagePart,
  type LovableMessage,
  type LovableTextPart,
} from "../_shared/ai-lovable.ts";
import { resolveSubjectRubric } from "../_shared/subject-rubrics/index.ts";
import { parseAttachmentUrls } from "../_shared/attachment-refs.ts";
import { rewriteToDirect } from "../_shared/proxy-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Phase A — только физика (расширяемо: добавить subject в множество).
const REFERENCE_SUBJECTS = new Set(["physics"]);
const SIGNED_URL_TTL_SEC = 600;
const MAX_TASK_IMAGES_FOR_SOLVE = 5;
const MAX_TASK_TEXT_CHARS = 6000;
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Storage helpers (mirror mock-exam-grade) ────────────────────────────────

interface ParsedRef {
  bucket: string;
  path: string;
}

function parseStorageRef(ref: string | null | undefined): ParsedRef | null {
  if (!ref || typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed.startsWith("storage://")) return null;
  const rest = trimmed.slice("storage://".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) return null;
  const bucket = rest.slice(0, slashIdx);
  const path = rest.slice(slashIdx + 1);
  if (!bucket || !path) return null;
  return { bucket, path };
}

async function createSignedUrl(db: SupabaseClient, ref: string | null): Promise<string | null> {
  // SSRF guard (review fix P1 #5): принимаем ТОЛЬКО storage://bucket/path.
  // `task_image_url` tutor-controlled, а валидатор create/update его не ограничивает
  // storage:// → произвольный http(s) здесь = server-side SSRF из edge с
  // service-role. Резолвим только storage-ref в подписанный Supabase URL
  // (inlineImageUrlToBase64 сам rewriteToDirect).
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    console.warn("hw_reference_signed_url_failed", { bucket: parsed.bucket, error: error?.message });
    return null;
  }
  // Server-side fetch — direct host (inlineImageUrlToBase64 сам rewriteToDirect,
  // но SDK уже отдаёт direct; defensive).
  return rewriteToDirect(data.signedUrl);
}

async function resolveTaskImages(db: SupabaseClient, taskImageUrl: unknown): Promise<string[]> {
  const raw = typeof taskImageUrl === "string" ? taskImageUrl : null;
  if (!raw) return [];
  const refs = parseAttachmentUrls(raw).slice(0, MAX_TASK_IMAGES_FOR_SOLVE);
  const out: string[] = [];
  for (const ref of refs) {
    const signed = await createSignedUrl(db, ref);
    if (!signed) continue;
    const dataUrl = await inlineImageUrlToBase64(signed, "hw_reference_solve");
    if (dataUrl) out.push(dataUrl);
  }
  return out;
}

function clampText(value: unknown, max: number): string {
  const s = typeof value === "string" ? value : "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ─── Solve prompt ────────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  task_text: unknown;
  task_image_url: unknown;
  max_score: unknown;
  kim_number: unknown;
  check_format: unknown;
  task_kind: unknown;
  solution_text: unknown;
  ai_reference_status: unknown;
}

function buildSolveMessages(
  rubric: { role: string; methodology: string },
  task: TaskRow,
  imageDataUrls: string[],
): LovableMessage[] {
  const systemContent = [
    rubric.role,
    "ТВОЯ ЗАДАЧА: реши эту задачу ЕГЭ по физике ПОЛНОСТЬЮ и создай ЭТАЛОННОЕ решение — по нему AI будет проверять работы учеников. Будь строгим и точным, как эксперт ФИПИ.",
    "Оформи решение по элементам ФИПИ: исходные законы/формулы из кодификатора, обозначения новых величин, алгебраические преобразования и вычисления, числовой ответ с единицами измерения. Для качественных задач — формулировка ответа + объяснение со ссылкой на конкретные физические законы; для № 26 — обоснование применимости законов.",
    "МЕТОДОЛОГИЯ ФИПИ (для структуры эталона):",
    rubric.methodology,
    "",
    `Условие задачи: ${clampText(task.task_text, MAX_TASK_TEXT_CHARS)}`,
    imageDataUrls.length > 0 ? "К задаче приложено изображение с условием — используй его." : "",
    typeof task.max_score === "number" ? `Максимальный балл за задачу: ${task.max_score}.` : "",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток:",
    '{"reference_solution":"полное решение по шагам (законы, обозначения, преобразования, числовой ответ с единицами; можно LaTeX)","final_answer":"итоговый ответ с единицами","confidence":"low|medium|high"}',
    "confidence: high — задача стандартная, решение однозначно; medium — есть неоднозначность в условии; low — условие нечитаемо/неполно или задача нестандартна: тогда НЕ выдумывай данные и отметь это в reference_solution.",
  ]
    .filter(Boolean)
    .join("\n");

  const userParts: Array<LovableTextPart | LovableImagePart> = [
    { type: "text", text: "Реши задачу и верни эталон строго в JSON." },
  ];
  for (const url of imageDataUrls) {
    userParts.push({ type: "image_url", image_url: { url } });
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts },
  ];
}

function isEligibleTask(t: TaskRow): boolean {
  const kind = typeof t.task_kind === "string" ? t.task_kind : "";
  const isExtended = kind === "extended" || kind === "proof";
  const hasTutorSolution = typeof t.solution_text === "string" && t.solution_text.trim().length > 0;
  const alreadyDone = t.ai_reference_status === "ready" || t.ai_reference_status === "pending";
  return isExtended && !hasTutorSolution && !alreadyDone;
}

async function generateReferenceForTask(
  db: SupabaseClient,
  assignment: { exam_type: unknown },
  task: TaskRow,
): Promise<{ solution: string; confidence: string } | null> {
  const rubric = resolveSubjectRubric({
    subject: "physics",
    exam_type: typeof assignment.exam_type === "string" ? (assignment.exam_type as "ege" | "oge") : "ege",
    kim_number: typeof task.kim_number === "number" ? task.kim_number : null,
    task_kind: "extended",
    task_text: typeof task.task_text === "string" ? task.task_text : null,
    tutor_rubric: null,
  });

  const imageDataUrls = await resolveTaskImages(db, task.task_image_url);
  const messages = buildSolveMessages(rubric, task, imageDataUrls);
  const result = await callLovableJson(messages, "hw_reference_solve");

  const solutionRaw = result?.reference_solution;
  const solution = typeof solutionRaw === "string" ? solutionRaw.trim() : "";
  if (!solution) return null;

  const confidenceRaw = result?.confidence;
  const confidence =
    typeof confidenceRaw === "string" && CONFIDENCE_VALUES.has(confidenceRaw) ? confidenceRaw : "medium";

  const finalAnswer = result?.final_answer;
  const finalLine =
    typeof finalAnswer === "string" && finalAnswer.trim() ? `\n\nИтоговый ответ: ${finalAnswer.trim()}` : "";

  return { solution: solution + finalLine, confidence };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Internal-only: bearer must be the service role key (fire-and-forget caller).
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json(401, { error: "unauthorized" });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "bad_json" });
  }
  const assignmentId = body && typeof body.assignment_id === "string" ? body.assignment_id : null;
  if (!assignmentId) return json(400, { error: "assignment_id required" });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: assignment, error: aErr } = await db
    .from("homework_tutor_assignments")
    .select("id, subject, exam_type")
    .eq("id", assignmentId)
    .single();
  if (aErr || !assignment) return json(404, { error: "assignment_not_found" });
  if (!REFERENCE_SUBJECTS.has(assignment.subject as string)) {
    return json(200, { ok: true, skipped: "subject_not_eligible" });
  }

  const { data: tasks, error: tErr } = await db
    .from("homework_tutor_tasks")
    .select(
      "id, task_text, task_image_url, max_score, kim_number, check_format, task_kind, solution_text, ai_reference_status",
    )
    .eq("assignment_id", assignmentId);
  if (tErr) return json(500, { error: "tasks_fetch_failed" });

  const eligible = ((tasks ?? []) as TaskRow[]).filter(isEligibleTask);
  if (eligible.length === 0) return json(200, { ok: true, generated: 0 });

  // Authoritative claim (review fix P1 #4): атомарно флипаем null/failed → pending
  // и получаем ТОЛЬКО реально захваченные строки. Конкурентный триггер увидит их
  // уже 'pending' (row-lock сериализует UPDATE ... WHERE) → получит disjoint set.
  // Цикл идёт по claimed, не по устаревшему eligible.
  const eligibleIds = eligible.map((t) => t.id);
  const { data: claimed, error: claimErr } = await db
    .from("homework_tutor_tasks")
    .update({ ai_reference_status: "pending" })
    .in("id", eligibleIds)
    .or("ai_reference_status.is.null,ai_reference_status.eq.failed")
    .select("id, task_text, task_image_url, max_score, kim_number");
  if (claimErr) return json(500, { error: "claim_failed" });
  const claimedRows = (claimed ?? []) as unknown as TaskRow[];
  if (claimedRows.length === 0) return json(200, { ok: true, generated: 0 });

  let generated = 0;
  let failed = 0;
  for (const task of claimedRows) {
    try {
      const ref = await generateReferenceForTask(db, assignment, task);
      if (!ref) throw new Error("empty_reference");
      await db
        .from("homework_tutor_tasks")
        .update({
          ai_reference_solution: ref.solution,
          ai_reference_confidence: ref.confidence,
          ai_reference_status: "ready",
          ai_reference_generated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("ai_reference_status", "pending"); // guard: не перетираем чужой ready
      generated++;
    } catch (err) {
      failed++;
      console.warn("hw_reference_generate_failed", {
        task_id: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await db
        .from("homework_tutor_tasks")
        .update({ ai_reference_status: "failed", ai_reference_generated_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("ai_reference_status", "pending"); // guard: не откатываем ready→failed
    }
  }

  console.log("hw_reference_generate_done", { assignment_id: assignmentId, generated, failed });
  return json(200, { ok: true, generated, failed });
});
