import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";
const TRAINER_IP_SALT = Deno.env.get("TRAINER_IP_SALT") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json",
} as const;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMITS = 20;
const CLIENT_STARTED_AT_MAX_SKEW_MS = 24 * 60 * 60 * 1000;

type TrainerSubmitPayload = {
  session_id: string;
  score: number;
  total: number;
  weak_formulas: string[];
  duration_ms: number;
  client_started_at: string;
};

type ValidationResult =
  | { ok: true; value: TrainerSubmitPayload }
  | { ok: false; field: string };

if (!TRAINER_IP_SALT) {
  console.warn("trainer-submit: TRAINER_IP_SALT is not set; using empty fallback");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: CORS_HEADERS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function validatePayload(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, field: "body" };
  }

  const { session_id, score, total, weak_formulas, duration_ms, client_started_at } = body;

  if (typeof session_id !== "string" || !SESSION_ID_RE.test(session_id)) {
    return { ok: false, field: "session_id" };
  }

  if (!isIntegerInRange(total, 1, 50)) {
    return { ok: false, field: "total" };
  }

  if (!isIntegerInRange(score, 0, total)) {
    return { ok: false, field: "score" };
  }

  if (!Array.isArray(weak_formulas) || weak_formulas.length > 50) {
    return { ok: false, field: "weak_formulas" };
  }

  for (const item of weak_formulas) {
    if (typeof item !== "string" || item.length > 64) {
      return { ok: false, field: "weak_formulas" };
    }
  }

  if (!isIntegerInRange(duration_ms, 0, 3_600_000)) {
    return { ok: false, field: "duration_ms" };
  }

  if (typeof client_started_at !== "string" || !ISO_8601_RE.test(client_started_at)) {
    return { ok: false, field: "client_started_at" };
  }

  const startedAtMs = Date.parse(client_started_at);
  if (!Number.isFinite(startedAtMs)) {
    return { ok: false, field: "client_started_at" };
  }

  if (Math.abs(Date.now() - startedAtMs) > CLIENT_STARTED_AT_MAX_SKEW_MS) {
    return { ok: false, field: "client_started_at" };
  }

  return {
    ok: true,
    value: {
      session_id,
      score,
      total,
      weak_formulas,
      duration_ms,
      client_started_at,
    },
  };
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const cloudflareIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  return "unknown";
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function logHashPrefix(ipHash: string): string {
  return ipHash.slice(0, 8);
}

function buildInsertPayload(payload: TrainerSubmitPayload, ipHash: string): Record<string, unknown> {
  return {
    source: "trainer",
    student_id: null,
    round_id: null,
    session_id: payload.session_id,
    score: payload.score,
    total: payload.total,
    weak_formulas: payload.weak_formulas,
    duration_seconds: Math.floor(payload.duration_ms / 1000),
    ip_hash: ipHash,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("trainer-submit: missing Supabase env vars");
      return json({ error: "internal" }, 500);
    }

    const body = await req.json().catch(() => null);
    const validation = validatePayload(body);
    if (!validation.ok) {
      return json({ error: "invalid_payload", field: validation.field }, 400);
    }

    const payload = validation.value;
    const clientIp = getClientIp(req);
    const ipHash = await sha256Hex(clientIp + TRAINER_IP_SALT);
    const ipHashPrefix = logHashPrefix(ipHash);

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const windowStartIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count, error: rateLimitError } = await db
      .from("formula_round_results")
      .select("id", { count: "exact", head: true })
      .eq("source", "trainer")
      .eq("ip_hash", ipHash)
      .gt("created_at", windowStartIso);

    if (rateLimitError) {
      console.error("trainer-submit: rate limit lookup failed", {
        ip_hash_prefix: ipHashPrefix,
        message: rateLimitError.message,
      });
      return json({ error: "internal" }, 500);
    }

    if ((count ?? 0) >= RATE_LIMIT_MAX_SUBMITS) {
      console.warn("trainer-submit: rate limited", { ip_hash_prefix: ipHashPrefix });
      return json({ error: "rate_limited" }, 429);
    }

    const insertPayload = buildInsertPayload(payload, ipHash);
    const { data, error: insertError } = await db
      .from("formula_round_results")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertError || !data?.id) {
      console.error("trainer-submit: insert failed", {
        ip_hash_prefix: ipHashPrefix,
        message: insertError?.message ?? "missing id",
      });
      return json({ error: "internal" }, 500);
    }

    return json({ ok: true, id: data.id });
  } catch (error) {
    console.error("trainer-submit: unhandled error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "internal" }, 500);
  }
});
