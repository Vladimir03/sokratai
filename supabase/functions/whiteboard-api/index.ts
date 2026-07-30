// whiteboard-api — CRUD досок и страниц онлайн-доски (Фаза 1, задача W1.2).
// Спека: docs/delivery/features/whiteboard/spec.md §5.
//
// Роуты (verify_jwt=true; шлюз отсекает anon, функция достаёт userId через GoTrue
// и дальше работает под service_role — денорм и порядок страниц нельзя доверять клиенту):
//   GET    /boards                 — список досок репетитора
//   POST   /boards                 — создать { title?, student_id?, lesson_id? } (+ первая страница)
//   GET    /boards/:id             — доска + все страницы
//   POST   /boards/:id             — переименовать / записать export_material_id
//   DELETE /boards/:id             — удалить (страницы уходят по CASCADE)
//   POST   /boards/:id/pages       — добавить страницу { background?, grid_mm? }
//   POST   /pages/:id              — сохранить страницу { elements?, app_state?, background?, grid_mm? }
//   DELETE /pages/:id              — удалить страницу (последнюю удалить нельзя)
//   GET    /lessons/:lessonId/board — найти-или-создать доску занятия (вход из карточки занятия)
//
// Ownership (rule 60 FK-дрейф): boards.tutor_id / tutor_lessons.tutor_id /
// tutor_students.tutor_id → tutors.id (resolveTutorPkId), НЕ auth.users.id.
// Ошибки: плоский { error: <рус>, code } (rule 97). В логах — только id и статусы.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TITLE_LEN = 200;
const MAX_PAGES_PER_BOARD = 50;
const MAX_BOARDS_PER_TUTOR = 500;
// Кап элементов на страницу. Рукописный конспект — это сотни штрихов; 20 000
// с запасом покрывает урок и одновременно не даёт залить в jsonb мегабайты.
const MAX_ELEMENTS_PER_PAGE = 20000;
// Кап сырого тела автосейва (jsonb страницы). Больше — это уже не конспект.
const MAX_PAGE_PAYLOAD_BYTES = 4 * 1024 * 1024;

const VALID_BACKGROUNDS = new Set(["blank", "grid", "lines", "dots"]);
const VALID_GRID_MM = new Set([5, 10]);

const BOARD_SELECT =
  "id, student_id, lesson_id, title, export_material_id, created_at, updated_at";
const PAGE_SELECT =
  "id, board_id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, created_at, updated_at";

/**
 * Сигнал синка (Этап 2): бамп rev после КАЖДОГО успешного сохранения листа.
 * Fault-tolerant: сбой бампа не валит сохранение — сигнал догонится следующим.
 */
async function bumpPageRev(
  db: SupabaseClient,
  pageId: string,
  boardId: string,
  updatedBy: string,
): Promise<number> {
  try {
    // Атомарный upsert-инкремент (ревью этапов 1–3, P0 №1): прежний
    // SELECT → UPDATE терял инкременты при конкурентных бампах.
    const { data, error } = await db.rpc("wb_bump_page_rev", {
      p_page_id: pageId,
      p_board_id: boardId,
      p_updated_by: updatedBy,
    });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  } catch (e) {
    console.error("whiteboard_api_rev_bump_failed", {
      page_id: pageId,
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    // Fault-tolerant: сбой сигнала не валит сохранение; 0 = «rev неизвестен»,
    // клиент подтянет актуальный из ближайшего события/снапшота.
    return 0;
  }
}

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("WHITEBOARD_API_ALLOWED_ORIGINS") ??
    Deno.env.get("HOMEWORK_API_ALLOWED_ORIGINS");
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return FALLBACK_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  const isLovableOrigin =
    origin.endsWith(".lovableproject.com") || origin.endsWith(".lovable.app");
  const matchedOrigin = allowed.includes(origin) || isLovableOrigin
    ? origin
    : allowed[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers (rule 97 flat shape) ───────────────────────────────────

function jsonOk(cors: Record<string, string>, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonError(
  cors: Record<string, string>,
  status: number,
  code: string,
  error: string,
): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function authenticateUser(
  req: Request,
  cors: Record<string, string>,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Нет активной сессии. Войдите снова.");
  }
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!resp.ok) {
    console.error("whiteboard_api_auth_failed", { status: resp.status });
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  return { userId: user.id };
}

/** auth.users.id → tutors.id (FK-конверсия, rule 60). null если профиля тутора нет. */
async function resolveTutorPkId(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from("tutors").select("id").eq("user_id", userId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// ─── Routing / validation ────────────────────────────────────────────────────

function parseRoute(req: Request): { segments: string[]; method: string } {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf("whiteboard-api");
  const rest = idx >= 0 ? url.pathname.slice(idx + "whiteboard-api".length) : "";
  return { segments: rest.split("/").filter(Boolean), method: req.method };
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t.slice(0, MAX_TITLE_LEN) : null;
}

function optionalUuid(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) return undefined; // undefined = невалидно
  return raw;
}

/** Проверяет владение доской и возвращает её. null — нет такой или чужая. */
async function loadOwnedBoard(
  db: SupabaseClient,
  boardId: string,
  tutorPkId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("boards")
    .select(`${BOARD_SELECT}, tutor_id`)
    .eq("id", boardId)
    .maybeSingle();
  if (!data || data.tutor_id !== tutorPkId) return null;
  const { tutor_id: _drop, ...board } = data as Record<string, unknown>;
  return board;
}

// ─── Handlers: boards ────────────────────────────────────────────────────────

async function handleListBoards(
  db: SupabaseClient,
  tutorPkId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { data, error } = await db
    .from("boards")
    .select(BOARD_SELECT)
    .eq("tutor_id", tutorPkId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(200);
  if (error) {
    console.error("whiteboard_api_list_failed", { code: error.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список досок.");
  }
  return jsonOk(cors, { items: data ?? [] });
}

/**
 * Создаёт доску вместе с первой страницей. Доска без страниц бессмысленна:
 * клиенту пришлось бы делать второй запрос, а сбой между ними оставил бы
 * пустую доску, которую нечем открыть.
 */
async function createBoardWithFirstPage(
  db: SupabaseClient,
  tutorPkId: string,
  fields: { title: string | null; student_id: string | null; lesson_id: string | null },
  cors: Record<string, string>,
): Promise<Response> {
  const { count } = await db
    .from("boards")
    .select("id", { count: "exact", head: true })
    .eq("tutor_id", tutorPkId);
  if ((count ?? 0) >= MAX_BOARDS_PER_TUTOR) {
    return jsonError(
      cors,
      409,
      "LIMIT_REACHED",
      `Достигнут предел в ${MAX_BOARDS_PER_TUTOR} досок. Удалите ненужные.`,
    );
  }

  const { data: board, error } = await db
    .from("boards")
    .insert({ tutor_id: tutorPkId, ...fields })
    .select(BOARD_SELECT)
    .single();
  if (error || !board) {
    console.error("whiteboard_api_create_failed", { code: error?.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать доску.");
  }

  const { data: page, error: pageError } = await db
    .from("board_pages")
    .insert({ board_id: board.id, page_index: 0 })
    .select(PAGE_SELECT)
    .single();
  if (pageError || !page) {
    // Откатываем доску: пустая доска без страниц не открывается.
    await db.from("boards").delete().eq("id", board.id);
    console.error("whiteboard_api_create_page_failed", { code: pageError?.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать страницу доски.");
  }

  console.log("whiteboard_api_board_created", { board_id: board.id, has_lesson: !!fields.lesson_id });
  return jsonOk(cors, { board, pages: [page] }, 201);
}

async function handleCreateBoard(
  db: SupabaseClient,
  tutorPkId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const body = await parseJsonBody(req) ?? {};

  const studentId = optionalUuid(body.student_id);
  const lessonId = optionalUuid(body.lesson_id);
  if (studentId === undefined || lessonId === undefined) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор ученика или занятия.");
  }

  // Привязку проверяем на владение: чужое занятие/ученик к своей доске не крепится.
  if (lessonId) {
    const { data: lesson } = await db
      .from("tutor_lessons")
      .select("id, tutor_id")
      .eq("id", lessonId)
      .maybeSingle();
    if (!lesson || lesson.tutor_id !== tutorPkId) {
      return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");
    }
  }
  if (studentId) {
    const { data: student } = await db
      .from("tutor_students")
      .select("id, tutor_id")
      .eq("id", studentId)
      .maybeSingle();
    if (!student || student.tutor_id !== tutorPkId) {
      return jsonError(cors, 404, "NOT_FOUND", "Ученик не найден.");
    }
  }

  return createBoardWithFirstPage(
    db,
    tutorPkId,
    { title: cleanTitle(body.title), student_id: studentId, lesson_id: lessonId },
    cors,
  );
}

async function handleGetBoard(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  const { data: pages, error } = await db
    .from("board_pages")
    .select(PAGE_SELECT)
    .eq("board_id", boardId)
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("whiteboard_api_pages_failed", { code: error.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить страницы доски.");
  }
  return jsonOk(cors, { board, pages: pages ?? [] });
}

async function handleUpdateBoard(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  const body = await parseJsonBody(req);
  if (!body) return jsonError(cors, 400, "VALIDATION", "Пустой запрос.");

  const patch: Record<string, unknown> = {};
  if ("title" in body) patch.title = cleanTitle(body.title);
  if ("export_material_id" in body) {
    const materialId = optionalUuid(body.export_material_id);
    if (materialId === undefined) {
      return jsonError(cors, 400, "VALIDATION", "Некорректная ссылка на материал.");
    }
    patch.export_material_id = materialId;
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Нечего обновлять.");
  }

  const { data, error } = await db
    .from("boards")
    .update(patch)
    .eq("id", boardId)
    .select(BOARD_SELECT)
    .single();
  if (error || !data) {
    console.error("whiteboard_api_update_failed", { code: error?.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить доску.");
  }
  return jsonOk(cors, { board: data });
}

async function handleDeleteBoard(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  const { error } = await db.from("boards").delete().eq("id", boardId);
  if (error) {
    console.error("whiteboard_api_delete_failed", { code: error.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось удалить доску.");
  }
  console.log("whiteboard_api_board_deleted", { board_id: boardId });
  return jsonOk(cors, { ok: true });
}

/**
 * Найти-или-создать доску занятия — вход одним кликом из карточки занятия.
 * Идемпотентен: повторный клик открывает ту же доску, а не плодит новые.
 */
async function handleLessonBoard(
  db: SupabaseClient,
  tutorPkId: string,
  lessonId: string,
  cors: Record<string, string>,
): Promise<Response> {
  // ⚠️ FK-дрейф (rule 60): boards.student_id → tutor_students.id, и в занятии это
  // `tutor_student_id`. Поле `tutor_lessons.student_id` — это profiles.id (auth uid),
  // его вставка сюда валится на FK (ревью 5.6 + репорт владельца: «доска из
  // занятия не создаётся»).
  const { data: lesson } = await db
    .from("tutor_lessons")
    .select("id, tutor_id, tutor_student_id")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson || lesson.tutor_id !== tutorPkId) {
    return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");
  }

  const { data: existing } = await db
    .from("boards")
    .select(BOARD_SELECT)
    .eq("lesson_id", lessonId)
    .eq("tutor_id", tutorPkId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing && existing.length > 0) {
    return handleGetBoard(db, tutorPkId, existing[0].id as string, cors);
  }

  return createBoardWithFirstPage(
    db,
    tutorPkId,
    {
      title: null,
      student_id: (lesson.tutor_student_id as string | null) ?? null,
      lesson_id: lessonId,
    },
    cors,
  );
}

// ─── Handlers: pages ─────────────────────────────────────────────────────────

async function handleCreatePage(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  const body = await parseJsonBody(req) ?? {};
  const background = typeof body.background === "string" ? body.background : "grid";
  const gridMm = typeof body.grid_mm === "number" ? body.grid_mm : 5;
  if (!VALID_BACKGROUNDS.has(background) || !VALID_GRID_MM.has(gridMm)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректная разлиновка страницы.");
  }

  const { data: last, error: lastError } = await db
    .from("board_pages")
    .select("page_index")
    .eq("board_id", boardId)
    .order("page_index", { ascending: false })
    .limit(1);
  if (lastError) {
    console.error("whiteboard_api_page_index_failed", { code: lastError.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось добавить страницу.");
  }

  const { count } = await db
    .from("board_pages")
    .select("id", { count: "exact", head: true })
    .eq("board_id", boardId);
  if ((count ?? 0) >= MAX_PAGES_PER_BOARD) {
    return jsonError(
      cors,
      409,
      "LIMIT_REACHED",
      `В доске не может быть больше ${MAX_PAGES_PER_BOARD} страниц.`,
    );
  }

  const nextIndex = last && last.length > 0 ? (last[0].page_index as number) + 1 : 0;
  // app_state (позиция-ячейка сетки и пр.) — object; клиент досылает своё.
  const appState =
    body.app_state && typeof body.app_state === "object" && !Array.isArray(body.app_state)
      ? body.app_state
      : {};
  // elements при создании (PDF-импорт, ревью P1): лист рождается СРАЗУ с
  // подложкой — обрыв сети между create и save больше не оставляет пустой лист.
  let elements: unknown[] = [];
  if ("elements" in body) {
    if (!Array.isArray(body.elements) || body.elements.length > MAX_ELEMENTS_PER_PAGE) {
      return jsonError(cors, 400, "VALIDATION", "Некорректные данные страницы.");
    }
    elements = body.elements;
  }
  const { data, error } = await db
    .from("board_pages")
    .insert({
      board_id: boardId,
      page_index: nextIndex,
      background,
      grid_mm: gridMm,
      app_state: appState,
      ...(elements.length > 0 ? { elements } : {}),
    })
    .select(PAGE_SELECT)
    .single();
  if (error || !data) {
    console.error("whiteboard_api_page_create_failed", { code: error?.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось добавить страницу.");
  }
  await bumpPageRev(db, data.id as string, boardId, "tutor");
  return jsonOk(cors, { page: data }, 201);
}

// ─── Зоны-рулоны (Этап 2, B2): раздача по группе занятия ─────────────────────

async function handleDistributeZones(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  // Состав: группа занятия (живое членство) либо индивидуальный ученик доски.
  let memberIds: string[] = [];
  if (board.lesson_id) {
    const { data: lesson } = await db
      .from("tutor_lessons")
      .select("id, group_source_tutor_group_id, tutor_student_id")
      .eq("id", board.lesson_id as string)
      .maybeSingle();
    if (lesson?.group_source_tutor_group_id) {
      const { data: members, error: membersError } = await db
        .from("tutor_group_memberships")
        .select("tutor_student_id, is_active, tutor_students!inner(id, archived_at)")
        .eq("tutor_group_id", lesson.group_source_tutor_group_id)
        .eq("is_active", true);
      if (membersError) {
        // Fail-closed на резолве получателей (rule 98).
        return jsonError(cors, 503, "RECIPIENTS_LOOKUP_FAILED", "Не удалось получить состав группы. Попробуйте ещё раз.");
      }
      memberIds = (members ?? [])
        .filter((m) => !(m.tutor_students as { archived_at: string | null }).archived_at)
        .map((m) => m.tutor_student_id as string);
    } else if (lesson?.tutor_student_id) {
      memberIds = [lesson.tutor_student_id as string];
    }
  }
  if (memberIds.length === 0 && board.student_id) {
    memberIds = [board.student_id as string];
  }
  if (memberIds.length === 0) {
    return jsonError(cors, 409, "NO_STUDENTS", "У занятия нет учеников — раздавать зоны некому.");
  }

  const { data: existingPages, error: pagesError } = await db
    .from("board_pages")
    .select("id, page_index, zone_tutor_student_id, app_state")
    .eq("board_id", boardId);
  if (pagesError) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось прочитать листы доски.");
  }
  const pages = existingPages ?? [];
  const alreadyZoned = new Set(
    pages.map((p) => p.zone_tutor_student_id as string | null).filter(Boolean),
  );
  // Занятые столбцы рулонов (row ≥ 1) — новые рулоны идут в свободные.
  const usedCols = new Set<number>();
  for (const p of pages) {
    const frame = (p.app_state as { frame?: { col?: number; row?: number } } | null)?.frame;
    if (frame && typeof frame.col === "number" && typeof frame.row === "number" && frame.row >= 1) {
      usedCols.add(frame.col);
    }
  }
  let nextIndex = pages.reduce((max, p) => Math.max(max, (p.page_index as number) ?? 0), -1) + 1;
  let nextCol = 0;
  const takeCol = () => {
    while (usedCols.has(nextCol)) nextCol++;
    usedCols.add(nextCol);
    return nextCol;
  };

  const created: unknown[] = [];
  for (const tutorStudentId of memberIds) {
    if (alreadyZoned.has(tutorStudentId)) continue; // идемпотентность повторной раздачи
    const col = takeCol();
    const { data: page, error } = await db
      .from("board_pages")
      .insert({
        board_id: boardId,
        page_index: nextIndex++,
        background: "grid",
        grid_mm: 5,
        zone_tutor_student_id: tutorStudentId,
        app_state: { orientation: "portrait", frame: { col, row: 1 } },
      })
      .select(PAGE_SELECT)
      .single();
    if (error || !page) {
      console.error("whiteboard_api_zone_create_failed", { code: error?.code });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось создать зону ученика.");
    }
    await bumpPageRev(db, page.id as string, boardId, "tutor");
    created.push(page);
  }

  console.log("whiteboard_api_zones_distributed", { board_id: boardId, created: created.length });
  return jsonOk(cors, { pages: created }, created.length > 0 ? 201 : 200);
}

// ─── Гостевая ссылка (Этап 2, B4): create-or-get / revoke ─────────────────────

function generateSlug(): string {
  // 12 hex (~48 бит) — паттерн join_code; НЕ crypto.randomUUID (единый стиль).
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function handleShareLink(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  method: string,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  if (method === "DELETE") {
    await db
      .from("board_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("board_id", boardId)
      .is("revoked_at", null);
    return jsonOk(cors, { ok: true });
  }

  const { data: existing } = await db
    .from("board_share_links")
    .select("slug")
    .eq("board_id", boardId)
    .is("revoked_at", null)
    .maybeSingle();
  if (existing?.slug) return jsonOk(cors, { slug: existing.slug });

  const { data: createdLink, error } = await db
    .from("board_share_links")
    .insert({ board_id: boardId, tutor_id: tutorPkId, slug: generateSlug() })
    .select("slug")
    .single();
  if (error || !createdLink) {
    console.error("whiteboard_api_share_create_failed", { code: error?.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать ссылку.");
  }
  return jsonOk(cors, { slug: createdLink.slug }, 201);
}

/**
 * POST /boards/:id/bring — «Привести всех к моему виду» (Этап 4, B1).
 * Ученикам сигнал уходит broadcast'ом с клиента; здесь ПЕРСИСТ для гостей:
 * у них нет JWT → нет Realtime, bring доезжает поллингом /signals
 * (whiteboard-public читает boards.live_bring). Клиенты дедупят по seq и
 * игнорируют старше 2 минут — поэтому перезапись одной колонки достаточна.
 */
async function handleBring(
  db: SupabaseClient,
  tutorPkId: string,
  boardId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const board = await loadOwnedBoard(db, boardId, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Доска не найдена.");

  const body = await parseJsonBody(req) ?? {};
  const b = body.bounds as { minX?: unknown; minY?: unknown; maxX?: unknown; maxY?: unknown } | undefined;
  const nums = [b?.minX, b?.minY, b?.maxX, b?.maxY];
  if (
    !b || nums.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
    (b.maxX as number) <= (b.minX as number) || (b.maxY as number) <= (b.minY as number)
  ) {
    return jsonError(cors, 400, "VALIDATION", "Некорректная область для показа.");
  }

  const bring = {
    seq: Date.now(),
    bounds: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
    at: new Date().toISOString(),
  };
  const { error } = await db.from("boards").update({ live_bring: bring }).eq("id", boardId);
  if (error) {
    console.error("whiteboard_api_bring_failed", { code: error.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось позвать участников.");
  }
  return jsonOk(cors, { ok: true, seq: bring.seq });
}

async function handleSavePage(
  db: SupabaseClient,
  tutorPkId: string,
  pageId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const { data: page } = await db
    .from("board_pages")
    .select("id, board_id")
    .eq("id", pageId)
    .maybeSingle();
  if (!page) return jsonError(cors, 404, "NOT_FOUND", "Страница не найдена.");

  const board = await loadOwnedBoard(db, page.board_id as string, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Страница не найдена.");

  const raw = await req.text();
  if (raw.length > MAX_PAGE_PAYLOAD_BYTES) {
    return jsonError(
      cors,
      413,
      "PAYLOAD_TOO_LARGE",
      "Страница слишком большая. Разбейте конспект на несколько страниц.",
    );
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError(cors, 400, "VALIDATION", "Некорректные данные страницы.");
  }

  const patch: Record<string, unknown> = {};
  if ("elements" in body) {
    if (!Array.isArray(body.elements)) {
      return jsonError(cors, 400, "VALIDATION", "Некорректные данные страницы.");
    }
    if (body.elements.length > MAX_ELEMENTS_PER_PAGE) {
      return jsonError(
        cors,
        413,
        "PAYLOAD_TOO_LARGE",
        "На странице слишком много элементов. Добавьте новую страницу.",
      );
    }
    patch.elements = body.elements;
  }
  if ("app_state" in body) {
    if (body.app_state === null || typeof body.app_state !== "object" || Array.isArray(body.app_state)) {
      return jsonError(cors, 400, "VALIDATION", "Некорректные данные страницы.");
    }
    patch.app_state = body.app_state;
  }
  if ("background" in body) {
    if (typeof body.background !== "string" || !VALID_BACKGROUNDS.has(body.background)) {
      return jsonError(cors, 400, "VALIDATION", "Некорректная разлиновка страницы.");
    }
    patch.background = body.background;
  }
  if ("grid_mm" in body) {
    if (typeof body.grid_mm !== "number" || !VALID_GRID_MM.has(body.grid_mm)) {
      return jsonError(cors, 400, "VALIDATION", "Некорректный шаг клетки.");
    }
    patch.grid_mm = body.grid_mm;
  }
  if ("zone_tutor_student_id" in body) {
    // Назначение/снятие зоны — только репетитор, и только СВОЙ ученик (rule 60:
    // tutor_students.tutor_id → tutors.id, сверяем с tutorPkId).
    if (body.zone_tutor_student_id === null) {
      patch.zone_tutor_student_id = null;
    } else if (typeof body.zone_tutor_student_id === "string" && UUID_RE.test(body.zone_tutor_student_id)) {
      const { data: student } = await db
        .from("tutor_students")
        .select("id, tutor_id")
        .eq("id", body.zone_tutor_student_id)
        .maybeSingle();
      if (!student || student.tutor_id !== tutorPkId) {
        return jsonError(cors, 404, "NOT_FOUND", "Ученик не найден.");
      }
      patch.zone_tutor_student_id = body.zone_tutor_student_id;
    } else {
      return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор ученика.");
    }
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Нечего сохранять.");
  }

  // Оптимистическая блокировка (Этап 3, доревизия по ревью P0 №1): CAS и бамп —
  // ОДНА транзакция в RPC под FOR UPDATE. Прежний check-then-write пропускал
  // одновременные сейвы с одинаковым base_rev (lost update). base_rev опционален
  // (переходный клиент без него получает LWW, но бамп всё равно атомарный).
  let rev = 0;
  if ("elements" in patch) {
    const baseRev = typeof body.base_rev === "number" ? body.base_rev : null;
    const { data: cas, error: casError } = await db.rpc("wb_save_page_elements", {
      p_page_id: pageId,
      p_elements: patch.elements,
      p_base_rev: baseRev,
      p_updated_by: "tutor",
    });
    if (casError || !cas) {
      console.error("whiteboard_api_page_cas_failed", { code: casError?.code });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить страницу.");
    }
    const outcome = cas as { status: string; rev?: number; elements?: unknown };
    if (outcome.status === "not_found") {
      return jsonError(cors, 404, "NOT_FOUND", "Страница не найдена.");
    }
    if (outcome.status === "conflict") {
      return new Response(
        JSON.stringify({
          error: "Лист изменил другой участник.",
          code: "REV_CONFLICT",
          rev: outcome.rev ?? 0,
          elements: outcome.elements ?? [],
        }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    rev = Number(outcome.rev) || 0;
    delete patch.elements;
  }

  let data: Record<string, unknown> | null = null;
  if (Object.keys(patch).length > 0) {
    const { data: updated, error } = await db
      .from("board_pages")
      .update(patch)
      .eq("id", pageId)
      .select(PAGE_SELECT)
      .single();
    if (error || !updated) {
      console.error("whiteboard_api_page_save_failed", { code: error?.code });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить страницу.");
    }
    data = updated;
    // Патч без elements (зона/разлиновка) — участникам тоже нужен сигнал.
    if (rev === 0) rev = await bumpPageRev(db, pageId, page.board_id as string, "tutor");
  } else {
    const { data: fresh } = await db
      .from("board_pages")
      .select(PAGE_SELECT)
      .eq("id", pageId)
      .maybeSingle();
    data = fresh ?? null;
  }
  if (!data) return jsonError(cors, 404, "NOT_FOUND", "Страница не найдена.");

  // Доска «поднимается» в списке недавних — это и есть смысл её updated_at.
  await db.from("boards").update({ updated_at: new Date().toISOString() }).eq("id", page.board_id);

  return jsonOk(cors, { page: data, rev });
}

async function handleDeletePage(
  db: SupabaseClient,
  tutorPkId: string,
  pageId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { data: page } = await db
    .from("board_pages")
    .select("id, board_id, page_index")
    .eq("id", pageId)
    .maybeSingle();
  if (!page) return jsonError(cors, 404, "NOT_FOUND", "Страница не найдена.");

  const board = await loadOwnedBoard(db, page.board_id as string, tutorPkId);
  if (!board) return jsonError(cors, 404, "NOT_FOUND", "Страница не найдена.");

  const { data: siblings, error: siblingsError } = await db
    .from("board_pages")
    .select("id, page_index")
    .eq("board_id", page.board_id)
    .order("page_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (siblingsError) {
    console.error("whiteboard_api_page_siblings_failed", { code: siblingsError.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось удалить страницу.");
  }
  if ((siblings?.length ?? 0) <= 1) {
    return jsonError(
      cors,
      409,
      "LAST_PAGE",
      "Нельзя удалить единственную страницу доски.",
    );
  }

  const { error } = await db.from("board_pages").delete().eq("id", pageId);
  if (error) {
    console.error("whiteboard_api_page_delete_failed", { code: error.code });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось удалить страницу.");
  }

  // Переиндексация хвоста: page_index обязан оставаться плотным, иначе номера
  // страниц в UI и в PDF разойдутся с их порядком.
  const remaining = (siblings ?? []).filter((p) => p.id !== pageId);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].page_index !== i) {
      await db.from("board_pages").update({ page_index: i }).eq("id", remaining[i].id);
    }
  }

  return jsonOk(cors, { ok: true });
}

// ─── Entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const auth = await authenticateUser(req, cors);
    if (auth instanceof Response) return auth;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const tutorPkId = await resolveTutorPkId(db, auth.userId);
    if (!tutorPkId) {
      return jsonError(cors, 403, "NOT_A_TUTOR", "Доступ только для репетиторов.");
    }

    const { segments, method } = parseRoute(req);

    // /boards …
    if (segments[0] === "boards") {
      if (segments.length === 1) {
        if (method === "GET") return handleListBoards(db, tutorPkId, cors);
        if (method === "POST") return handleCreateBoard(db, tutorPkId, req, cors);
      }
      const boardId = segments[1];
      if (boardId && !UUID_RE.test(boardId)) {
        return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор доски.");
      }
      if (segments.length === 2 && boardId) {
        if (method === "GET") return handleGetBoard(db, tutorPkId, boardId, cors);
        if (method === "POST") return handleUpdateBoard(db, tutorPkId, boardId, req, cors);
        if (method === "DELETE") return handleDeleteBoard(db, tutorPkId, boardId, cors);
      }
      if (segments.length === 3 && boardId && segments[2] === "pages" && method === "POST") {
        return handleCreatePage(db, tutorPkId, boardId, req, cors);
      }
      if (segments.length === 3 && boardId && segments[2] === "bring" && method === "POST") {
        return handleBring(db, tutorPkId, boardId, req, cors);
      }
      if (segments.length === 3 && boardId && segments[2] === "zones" && method === "POST") {
        return handleDistributeZones(db, tutorPkId, boardId, cors);
      }
      if (
        segments.length === 3 && boardId && segments[2] === "share" &&
        (method === "POST" || method === "DELETE")
      ) {
        return handleShareLink(db, tutorPkId, boardId, method, cors);
      }
    }

    // /pages/:id
    if (segments[0] === "pages" && segments.length === 2) {
      const pageId = segments[1];
      if (!UUID_RE.test(pageId)) {
        return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор страницы.");
      }
      if (method === "POST") return handleSavePage(db, tutorPkId, pageId, req, cors);
      if (method === "DELETE") return handleDeletePage(db, tutorPkId, pageId, cors);
    }

    // /lessons/:lessonId/board
    if (
      segments[0] === "lessons" && segments.length === 3 && segments[2] === "board" &&
      method === "GET"
    ) {
      const lessonId = segments[1];
      if (!UUID_RE.test(lessonId)) {
        return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор занятия.");
      }
      return handleLessonBoard(db, tutorPkId, lessonId, cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", "Неизвестный маршрут.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("whiteboard_api_unhandled", { message: message.slice(0, 200) });
    return jsonError(cors, 500, "INTERNAL", `Внутренняя ошибка доски: ${message}`);
  }
});
