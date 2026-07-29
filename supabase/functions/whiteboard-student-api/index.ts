// whiteboard-student-api — запись УЧЕНИКА (с аккаунтом) в свою зону доски.
// Фаза P0 Этап 2 (план shiny-leaping-stardust). Чтение ученику не нужно —
// оно идёт напрямую PostgREST под RLS-политиками is_board_participant.
//
// Роуты (verify_jwt=true):
//   POST /pages/:id        { elements, base_rev } — сохранить СВОЮ зону
//   POST /boards/:id/pages { }                    — добавить лист в СВОЙ рулон
//
// Права: ученик пишет ТОЛЬКО elements листа, где zone_tutor_student_id = его
// tutor_students.id (FK-дрейф rule 60: сверка auth.uid ↔ tutor_students.student_id).
// Оптимистическая блокировка: base_rev ≠ текущий rev → 409 REV_CONFLICT с
// серверными elements (клиент делает LWW-reconcile по version/versionNonce).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ELEMENTS_PER_PAGE = 20000;
const MAX_PAGE_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ROLL_PAGES = 20;

const PAGE_SELECT =
  "id, board_id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, created_at, updated_at";

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const isLovable = origin.endsWith(".lovableproject.com") || origin.endsWith(".lovable.app");
  return {
    "Access-Control-Allow-Origin": FALLBACK_ORIGINS.includes(origin) || isLovable ? origin : FALLBACK_ORIGINS[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonOk(cors: Record<string, string>, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonError(cors: Record<string, string>, status: number, code: string, error: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function authenticate(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!resp.ok) return null;
  const user = await resp.json();
  return user?.id ?? null;
}

/** auth.uid → tutor_students.id для репетитора этой доски (живой резолв, rule 100). */
async function resolveMyZoneStudentId(
  db: SupabaseClient,
  userId: string,
  boardTutorId: string,
): Promise<string | null> {
  const { data } = await db
    .from("tutor_students")
    .select("id")
    .eq("student_id", userId)
    .eq("tutor_id", boardTutorId)
    .is("archived_at", null)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function bumpRev(db: SupabaseClient, pageId: string, boardId: string, updatedBy: string): Promise<number> {
  const { data } = await db.from("board_page_revs").select("rev").eq("page_id", pageId).maybeSingle();
  if (data) {
    const next = (data.rev as number) + 1;
    await db
      .from("board_page_revs")
      .update({ rev: next, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq("page_id", pageId);
    return next;
  }
  await db.from("board_page_revs").insert({ page_id: pageId, board_id: boardId, updated_by: updatedBy });
  return 1;
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    const userId = await authenticate(req);
    if (!userId) return jsonError(cors, 401, "UNAUTHORIZED", "Нет активной сессии. Войдите снова.");
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const url = new URL(req.url);
    const idx = url.pathname.indexOf("whiteboard-student-api");
    const segments = (idx >= 0 ? url.pathname.slice(idx + "whiteboard-student-api".length) : "")
      .split("/")
      .filter(Boolean);

    // POST /pages/:id — сохранить свою зону
    if (req.method === "POST" && segments[0] === "pages" && segments.length === 2) {
      const pageId = segments[1];
      if (!UUID_RE.test(pageId)) return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор листа.");

      const raw = await req.text();
      if (raw.length > MAX_PAGE_PAYLOAD_BYTES) {
        return jsonError(cors, 413, "PAYLOAD_TOO_LARGE", "Лист слишком большой. Продолжите на новом листе.");
      }
      let body: { elements?: unknown; base_rev?: unknown };
      try {
        body = JSON.parse(raw);
      } catch {
        return jsonError(cors, 400, "VALIDATION", "Некорректные данные листа.");
      }
      if (!Array.isArray(body.elements) || body.elements.length > MAX_ELEMENTS_PER_PAGE) {
        return jsonError(cors, 400, "VALIDATION", "Некорректные данные листа.");
      }

      const { data: page } = await db
        .from("board_pages")
        .select(`${PAGE_SELECT}, boards!inner(tutor_id)`)
        .eq("id", pageId)
        .maybeSingle();
      if (!page) return jsonError(cors, 404, "NOT_FOUND", "Лист не найден.");

      const boardTutorId = (page.boards as { tutor_id: string }).tutor_id;
      const myStudentId = await resolveMyZoneStudentId(db, userId, boardTutorId);
      if (!myStudentId) return jsonError(cors, 403, "NOT_A_PARTICIPANT", "Вы не участник этой доски.");
      if (page.zone_tutor_student_id !== myStudentId) {
        return jsonError(cors, 403, "FOREIGN_ZONE", "Это не ваш лист — писать можно только в своей зоне.");
      }

      // Оптимистическая блокировка: чужой более свежий rev не затирается молча.
      const { data: revRow } = await db
        .from("board_page_revs")
        .select("rev")
        .eq("page_id", pageId)
        .maybeSingle();
      const currentRev = (revRow?.rev as number | undefined) ?? 1;
      const baseRev = typeof body.base_rev === "number" ? body.base_rev : null;
      if (baseRev !== null && baseRev !== currentRev) {
        return new Response(
          JSON.stringify({
            error: "Лист изменился с другого устройства.",
            code: "REV_CONFLICT",
            rev: currentRev,
            elements: page.elements,
          }),
          { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      const { data: saved, error } = await db
        .from("board_pages")
        .update({ elements: body.elements })
        .eq("id", pageId)
        .select(PAGE_SELECT)
        .single();
      if (error || !saved) {
        return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить лист.");
      }
      const rev = await bumpRev(db, pageId, page.board_id as string, `student:${myStudentId}`);
      return jsonOk(cors, { page: saved, rev });
    }

    // POST /boards/:id/pages — добавить лист в свой рулон (вниз столбца)
    if (
      req.method === "POST" && segments[0] === "boards" && segments.length === 3 &&
      segments[2] === "pages"
    ) {
      const boardId = segments[1];
      if (!UUID_RE.test(boardId)) return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор доски.");

      const { data: board } = await db
        .from("boards")
        .select("id, tutor_id")
        .eq("id", boardId)
        .maybeSingle();
      if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");
      const myStudentId = await resolveMyZoneStudentId(db, userId, board.tutor_id as string);
      if (!myStudentId) return jsonError(cors, 403, "NOT_A_PARTICIPANT", "Вы не участник этой доски.");

      const { data: myPages } = await db
        .from("board_pages")
        .select("id, page_index, app_state")
        .eq("board_id", boardId)
        .eq("zone_tutor_student_id", myStudentId);
      if (!myPages || myPages.length === 0) {
        return jsonError(cors, 409, "NO_ZONE", "У вас пока нет зоны на этой доске — попросите репетитора раздать зоны.");
      }
      if (myPages.length >= MAX_ROLL_PAGES) {
        return jsonError(cors, 409, "LIMIT_REACHED", `В вашем рулоне уже ${MAX_ROLL_PAGES} листов.`);
      }
      // Столбец рулона и следующий ряд — из app_state.frame существующих листов.
      let col = 0;
      let maxRow = 0;
      for (const p of myPages) {
        const frame = (p.app_state as { frame?: { col?: number; row?: number } } | null)?.frame;
        if (frame && typeof frame.col === "number") col = frame.col;
        if (frame && typeof frame.row === "number" && frame.row > maxRow) maxRow = frame.row;
      }
      const { data: all } = await db
        .from("board_pages")
        .select("page_index")
        .eq("board_id", boardId)
        .order("page_index", { ascending: false })
        .limit(1);
      const nextIndex = all && all.length > 0 ? (all[0].page_index as number) + 1 : 0;

      const { data: page, error } = await db
        .from("board_pages")
        .insert({
          board_id: boardId,
          page_index: nextIndex,
          background: "grid",
          grid_mm: 5,
          zone_tutor_student_id: myStudentId,
          app_state: { orientation: "portrait", frame: { col, row: maxRow + 1 } },
        })
        .select(PAGE_SELECT)
        .single();
      if (error || !page) {
        return jsonError(cors, 500, "DB_ERROR", "Не удалось добавить лист.");
      }
      const rev = await bumpRev(db, page.id as string, boardId, `student:${myStudentId}`);
      return jsonOk(cors, { page, rev }, 201);
    }

    return jsonError(cors, 404, "NOT_FOUND", "Неизвестный маршрут.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("whiteboard_student_api_unhandled", { message: message.slice(0, 200) });
    return jsonError(cors, 500, "INTERNAL", `Внутренняя ошибка доски: ${message}`);
  }
});
