import { createClient } from "npm:@supabase/supabase-js@2";

export type HomeworkState = "IDLE" | "HW_SELECTING" | "HW_SUBMITTING" | "HW_CONFIRMING" | "HW_REVIEW";

export interface HomeworkAnswerEntry {
  text: string;
  images: string[];
}

export type HomeworkAnswersByTask = Record<string, HomeworkAnswerEntry>;

export interface HomeworkContext {
  assignment_id?: string;
  submission_id?: string;
  task_index?: number;
  total_tasks?: number;
  task_ids?: string[];
  text?: string;
  images?: string[];
  answers_by_task?: HomeworkAnswersByTask;
}

export interface HomeworkStateRecord {
  user_id: string;
  state: HomeworkState;
  context: HomeworkContext;
  updated_at: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STALE_HOURS = Number(Deno.env.get("HOMEWORK_STATE_STALE_HOURS") ?? "12");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for homework state machine");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const TABLE_NAME = "homework_tutor_user_bot_state";

function isHomeworkState(value: unknown): value is HomeworkState {
  return value === "IDLE" || value === "HW_SELECTING" || value === "HW_SUBMITTING" || value === "HW_CONFIRMING" || value === "HW_REVIEW";
}

function sanitizeContext(raw: unknown): HomeworkContext {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const ctx = raw as Record<string, unknown>;
  const images = Array.isArray(ctx.images) ? ctx.images.filter((v): v is string => typeof v === "string") : [];
  const taskIds = Array.isArray(ctx.task_ids) ? ctx.task_ids.filter((v): v is string => typeof v === "string") : [];
  const answersByTaskRaw = ctx.answers_by_task && typeof ctx.answers_by_task === "object"
    ? (ctx.answers_by_task as Record<string, unknown>)
    : {};

  const answersByTask: HomeworkAnswersByTask = {};
  for (const [taskId, answer] of Object.entries(answersByTaskRaw)) {
    if (!answer || typeof answer !== "object") continue;
    const a = answer as Record<string, unknown>;
    answersByTask[taskId] = {
      text: typeof a.text === "string" ? a.text : "",
      images: Array.isArray(a.images) ? a.images.filter((v): v is string => typeof v === "string") : [],
    };
  }

  return {
    assignment_id: typeof ctx.assignment_id === "string" ? ctx.assignment_id : undefined,
    submission_id: typeof ctx.submission_id === "string" ? ctx.submission_id : undefined,
    task_index: typeof ctx.task_index === "number" ? ctx.task_index : undefined,
    total_tasks: typeof ctx.total_tasks === "number" ? ctx.total_tasks : undefined,
    task_ids: taskIds,
    text: typeof ctx.text === "string" ? ctx.text : "",
    images,
    answers_by_task: answersByTask,
  };
}

export async function setState(userId: string, state: HomeworkState, context: HomeworkContext): Promise<void> {
  console.log("homework_state_set", { userId, state });

  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert(
      {
        user_id: userId,
        state,
        context,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("homework_state_set_error", { userId, state, error });
    throw new Error(`Failed to set homework state: ${error.message}`);
  }
}

export async function resetState(userId: string): Promise<void> {
  console.log("homework_state_reset", { userId });
  await setState(userId, "IDLE", {});
}

export async function getState(userId: string): Promise<{ state: HomeworkState; context: HomeworkContext }> {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("state, context, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("homework_state_get_error", { userId, error });
    throw new Error(`Failed to get homework state: ${error.message}`);
  }

  if (!data) {
    console.log("homework_state_get", { userId, state: "IDLE", source: "default" });
    return { state: "IDLE", context: {} };
  }

  const state: HomeworkState = isHomeworkState(data.state) ? data.state : "IDLE";
  const context = sanitizeContext(data.context);
  console.log("homework_state_get", { userId, state });

  if (state !== "IDLE" && data.updated_at) {
    const updatedAt = new Date(data.updated_at);
    if (!Number.isNaN(updatedAt.getTime())) {
      const staleMs = STALE_HOURS * 60 * 60 * 1000;
      const ageMs = Date.now() - updatedAt.getTime();
      if (ageMs > staleMs) {
        console.log("homework_state_stale_reset", { userId, state, updated_at: data.updated_at, stale_hours: STALE_HOURS });
        await resetState(userId);
        return { state: "IDLE", context: {} };
      }
    }
  }

  return { state, context };
}
