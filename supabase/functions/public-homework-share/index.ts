import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient as SupabaseClientType } from "npm:@supabase/supabase-js@2";
import { parseAttachmentUrls } from "../_shared/attachment-refs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARE_LINK_SLUG_RE = /^[a-z0-9]{8}$/i;

// Base columns that are ALWAYS safe for public consumption. `correct_answer`
// добавляется динамически только при show_answers, `solution_text` +
// `solution_image_urls` — только при show_solutions (.claude/rules/
// 40-homework-system.md §«Public share endpoint / Anti-leak»). rubric_* и
// student linkage никогда не селектятся — отсутствуют в whitelist by design.
const PUBLIC_TASK_BASE_COLUMNS = "id, order_num, task_text, max_score, check_format, task_image_url";

type SupabaseClient = SupabaseClientType<any, any, any>;

type TaskRow = {
  id: string;
  order_num: number;
  task_text: string;
  max_score: number;
  check_format: "short_answer" | "detailed_solution" | null;
  task_image_url: string | null;
  // Следующие поля есть в строке ТОЛЬКО когда соответствующий флаг == true.
  correct_answer?: string | null;
  solution_text?: string | null;
  solution_image_urls?: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function parseRoute(req: Request): { slug: string | null } {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const functionIdx = parts.indexOf("public-homework-share");
  const routeParts = functionIdx >= 0 ? parts.slice(functionIdx + 1) : parts;

  if (routeParts.length === 2 && routeParts[0] === "share") {
    return { slug: routeParts[1] };
  }

  return { slug: null };
}

// Path traversal guard — копия паттерна из homework-api/index.ts:222. Rule 40
// требует оба: parseStorageRef + hasUnsafeObjectPath. Без guard'а
// tutor-controlled task_image_url теоретически может содержать `..` / `\0` /
// backslash и попытаться обойти bucket scoping Supabase SDK. Defense-in-depth.
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

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket: string,
): { bucket: string; objectPath: string } | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;

  if (trimmed.startsWith("storage://")) {
    const rest = trimmed.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
    const objectPath = rest.slice(slashIdx + 1).replace(/^\/+/, "");
    if (hasUnsafeObjectPath(objectPath)) return null;
    return {
      bucket: rest.slice(0, slashIdx),
      objectPath,
    };
  }

  const objectPath = trimmed.replace(/^\/+/, "");
  if (hasUnsafeObjectPath(objectPath)) return null;
  return { bucket: defaultBucket, objectPath };
}

async function createSignedStorageUrls(
  db: SupabaseClient,
  refs: string[],
  defaultBucket: string,
): Promise<string[]> {
  const urls: string[] = [];

  for (const ref of refs) {
    if (ref.startsWith("http://") || ref.startsWith("https://")) {
      urls.push(ref);
      continue;
    }

    const parsed = parseStorageRef(ref, defaultBucket);
    if (!parsed?.bucket || !parsed.objectPath) continue;

    const { data, error } = await db.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.objectPath, 3600);

    if (error || !data?.signedUrl) {
      console.warn("public_homework_share_signed_url_failed", {
        bucket: parsed.bucket,
        objectPath: parsed.objectPath,
        error: error?.message,
      });
      continue;
    }

    urls.push(data.signedUrl);
  }

  return urls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { slug } = parseRoute(req);
  if (!slug) {
    return jsonResponse({ error: "Route not found" }, 404);
  }

  const normalizedSlug = slug.toLowerCase();
  if (!SHARE_LINK_SLUG_RE.test(normalizedSlug)) {
    return jsonResponse({ error: "Invalid slug format", code: "invalid_slug" }, 400);
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: shareLink, error: shareError } = await db
      .from("homework_share_links")
      .select("slug, assignment_id, show_answers, show_solutions, expires_at")
      .eq("slug", normalizedSlug)
      .maybeSingle();

    if (shareError) {
      console.error("public_homework_share_link_fetch_failed", { error: shareError.message });
      return jsonResponse({ error: "Failed to load share link" }, 500);
    }

    if (!shareLink) {
      return jsonResponse({ error: "Share link not found", code: "not_found" }, 404);
    }

    if (shareLink.expires_at && new Date(shareLink.expires_at).getTime() < Date.now()) {
      return jsonResponse({ expired: true, tasks: [] });
    }

    const { data: assignment, error: assignmentError } = await db
      .from("homework_tutor_assignments")
      .select("id, title")
      .eq("id", shareLink.assignment_id)
      .maybeSingle();

    if (assignmentError) {
      console.error("public_homework_share_assignment_fetch_failed", { error: assignmentError.message });
      return jsonResponse({ error: "Failed to load homework" }, 500);
    }

    if (!assignment) {
      return jsonResponse({ error: "Homework not found", code: "not_found" }, 404);
    }

    // Column-whitelisted SELECT: correct_answer / solution_* попадают в
    // строки ТОЛЬКО при соответствующем флаге (rule 40). Response-side
    // scrubbing — слабее, чем column omission: при column omission поля
    // никогда не живут в памяти процесса, не попадают в логи / crash dumps.
    const selectColumns = [PUBLIC_TASK_BASE_COLUMNS];
    if (shareLink.show_answers) selectColumns.push("correct_answer");
    if (shareLink.show_solutions) selectColumns.push("solution_text", "solution_image_urls");

    const { data: taskRows, error: tasksError } = await db
      .from("homework_tutor_tasks")
      .select(selectColumns.join(", "))
      .eq("assignment_id", shareLink.assignment_id)
      .order("order_num", { ascending: true });

    if (tasksError) {
      console.error("public_homework_share_tasks_fetch_failed", { error: tasksError.message });
      return jsonResponse({ error: "Failed to load tasks" }, 500);
    }

    const tasks = await Promise.all(((taskRows ?? []) as unknown as TaskRow[]).map(async (task) => {
      const taskImageUrls = await createSignedStorageUrls(
        db,
        parseAttachmentUrls(task.task_image_url),
        "homework-task-images",
      );
      const solutionImageUrls = shareLink.show_solutions
        ? await createSignedStorageUrls(
          db,
          parseAttachmentUrls(task.solution_image_urls ?? null),
          "homework-task-images",
        )
        : [];

      return {
        id: task.id,
        order_num: task.order_num,
        task_text: task.task_text,
        max_score: task.max_score,
        kim_number: null,
        check_format: task.check_format,
        task_image_urls: taskImageUrls,
        correct_answer: shareLink.show_answers ? (task.correct_answer ?? null) : null,
        solution_text: shareLink.show_solutions ? (task.solution_text ?? null) : null,
        solution_image_urls: solutionImageUrls,
      };
    }));

    console.info(JSON.stringify({
      event: "homework_share_link_visited",
      slug: normalizedSlug,
    }));

    return jsonResponse({
      title: assignment.title,
      tasks,
      show_answers: shareLink.show_answers,
      show_solutions: shareLink.show_solutions,
      expires_at: shareLink.expires_at,
      expired: false,
    });
  } catch (error) {
    console.error("public_homework_share_unhandled_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "Unexpected error" }, 500);
  }
});
