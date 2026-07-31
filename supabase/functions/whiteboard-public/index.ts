// whiteboard-public — ГОСТЕВОЙ доступ к доске без регистрации (B4, Этап 2).
// Эталон — mock-exam-public: verify_jwt=false, service_role, whitelist-ответы,
// throttle на каждый роут. Bearer'ы (slug, guest_token) НЕ логировать (rule 96 №10).
//
// Роуты:
//   GET  /share/:slug                     — метаданные: название + кандидаты-ученики
//   POST /share/:slug/join                — { tutor_student_id? | display_name } → guest_token
//   GET  /share/:slug/state   — доска + листы (whitelist); токен в X-Guest-Token
//   GET  /share/:slug/signals?since= — поллинг revs (у гостя нет JWT → нет Realtime)
//   POST /share/:slug/pages/:pageId  — { elements, base_rev } в СВОЮ зону
//
// Идентификация — выбор «я — Маша» из живого списка группы (whiteboard.chat-паттерн);
// свободное имя = зритель без зоны (read-only).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { throttleCheck } from "../_shared/throttle.ts";
import { rewriteToProxy } from "../_shared/proxy-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[0-9a-f]{12}$/;
const MAX_GUESTS_PER_BOARD = 30;
const MAX_ELEMENTS_PER_PAGE = 20000;
const MAX_PAGE_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_NAME_LEN = 60;

const PAGE_WHITELIST =
  "id, board_id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, zone_guest_id, updated_at";
const MAX_ROLL_PAGES = 20; // зеркало whiteboard-student-api
const IMAGE_URL_TTL_SEC = 4 * 3600;
const BOARD_IMAGE_BUCKET = "board-images";

/**
 * Путь картинки принадлежит этой доске: строго `tutor/<uid>/<boardId>/<file>`.
 * Иначе service_role-подпись = cross-board IDOR (ревью этапов 1–3, P0 №3).
 */
function isBoardImagePath(path: string, boardId: string): boolean {
  const parts = path.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "tutor" &&
    UUID_RE.test(parts[1]) &&
    parts[2] === boardId &&
    parts[3].length > 0
  );
}

/** Есть ли в elements image-ref, НЕ принадлежащий доске (fail-closed на записи). */
function hasForeignImageRef(elements: unknown[], boardId: string): boolean {
  const prefix = `storage://${BOARD_IMAGE_BUCKET}/`;
  for (const el of elements as { type?: string; ref?: string }[]) {
    if (el?.type !== "image" || typeof el.ref !== "string") continue;
    if (!el.ref.startsWith(prefix) || !isBoardImagePath(el.ref.slice(prefix.length), boardId)) {
      return true;
    }
  }
  return false;
}

/** Signed URL картинок листов (у гостя нет storage-прав; host → RU-safe, rule 96).
 * Подписываются ТОЛЬКО пути этой доски (P0 №3). */
async function signBoardImages(
  db: SupabaseClient,
  boardId: string,
  pages: { elements?: unknown }[],
): Promise<Record<string, string>> {
  const prefix = `storage://${BOARD_IMAGE_BUCKET}/`;
  const paths = new Set<string>();
  for (const p of pages) {
    const elements = Array.isArray(p.elements) ? (p.elements as { type?: string; ref?: string }[]) : [];
    for (const el of elements) {
      if (el?.type === "image" && typeof el.ref === "string" && el.ref.startsWith(prefix)) {
        const path = el.ref.slice(prefix.length);
        if (isBoardImagePath(path, boardId)) paths.add(path);
      }
    }
  }
  if (paths.size === 0) return {};
  const list = Array.from(paths);
  const { data: signed } = await db.storage
    .from(BOARD_IMAGE_BUCKET)
    .createSignedUrls(list, IMAGE_URL_TTL_SEC);
  const out: Record<string, string> = {};
  for (let i = 0; i < (signed?.length ?? 0); i++) {
    const item = signed![i];
    if (item.signedUrl) out[`${prefix}${list[i]}`] = rewriteToProxy(item.signedUrl);
  }
  return out;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // x-guest-token: bearer гостя едет ЗАГОЛОВКОМ, не query (ревью P1: URL
  // попадает в access-логи и историю; заголовки — нет).
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guest-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonOk(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, code: string, error: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error, code, ...(extra ?? {}) }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Живая ссылка → board_id. null = нет/отозвана/истекла (снаружи 404, не 403 — privacy). */
async function resolveLink(
  db: SupabaseClient,
  slug: string,
): Promise<{ id: string; board_id: string } | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data } = await db
    .from("board_share_links")
    .select("id, board_id, expires_at, revoked_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return { id: data.id as string, board_id: data.board_id as string };
}

/** Живой гость этой ссылки. Проверяет ВСЮ цепочку (link мог быть отозван). */
async function resolveGuest(
  db: SupabaseClient,
  linkId: string,
  guestToken: string | null,
): Promise<{ id: string; board_id: string; tutor_student_id: string | null } | null> {
  if (!guestToken || !UUID_RE.test(guestToken)) return null;
  const { data } = await db
    .from("board_guests")
    .select("id, board_id, tutor_student_id, share_link_id, revoked_at")
    .eq("guest_token", guestToken)
    .maybeSingle();
  if (!data || data.revoked_at || data.share_link_id !== linkId) return null;
  return {
    id: data.id as string,
    board_id: data.board_id as string,
    tutor_student_id: (data.tutor_student_id as string | null) ?? null,
  };
}

/** Кандидаты на «я — Маша»: живые члены группы занятия / индивидуальный ученик. */
async function listCandidates(
  db: SupabaseClient,
  boardId: string,
): Promise<{ tutor_student_id: string; name: string }[]> {
  const { data: board } = await db
    .from("boards")
    .select("id, lesson_id, student_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return [];
  const ids: string[] = [];
  if (board.lesson_id) {
    const { data: lesson } = await db
      .from("tutor_lessons")
      .select("group_source_tutor_group_id, tutor_student_id")
      .eq("id", board.lesson_id as string)
      .maybeSingle();
    if (lesson?.group_source_tutor_group_id) {
      const { data: members } = await db
        .from("tutor_group_memberships")
        .select("tutor_student_id")
        .eq("tutor_group_id", lesson.group_source_tutor_group_id)
        .eq("is_active", true);
      for (const m of members ?? []) ids.push(m.tutor_student_id as string);
    } else if (lesson?.tutor_student_id) {
      ids.push(lesson.tutor_student_id as string);
    }
  }
  if (board.student_id) ids.push(board.student_id as string);
  // Владельцы зон (Этап 5): зоны раздаются пикером и на досках БЕЗ занятия —
  // без этой ветки кандидаты были пусты, все входили зрителями и НИКТО не мог
  // писать (провал теста Елены 30.07).
  const { data: zonePages } = await db
    .from("board_pages")
    .select("zone_tutor_student_id")
    .eq("board_id", boardId)
    .not("zone_tutor_student_id", "is", null);
  for (const p of zonePages ?? []) ids.push(p.zone_tutor_student_id as string);
  if (ids.length === 0) return [];
  // ⚠️ Колонка имени — display_name (колонки `name` в tutor_students НЕТ;
  // тот же промах уже чинился на фронте — селект с несуществующей колонкой
  // молча отдал бы пустой список кандидатов и сломал гостевой вход).
  const { data: students } = await db
    .from("tutor_students")
    .select("id, display_name, archived_at")
    .in("id", ids);
  // Anti-leak: гость до входа видит ТОЛЬКО имена (их ученики группы и так знают).
  return (students ?? [])
    .filter((s) => !s.archived_at)
    .map((s) => ({
      tutor_student_id: s.id as string,
      name: (s.display_name as string | null) ?? "Ученик",
    }));
}

/**
 * Лист-рулон для участника (фаза «Лист — каждому вошедшему»): свободный
 * столбец row≥1, привязка ЛИБО к ученику CRM, ЛИБО к гостю (CHECK в БД).
 * Аллокатор колонок неатомарен (принятый residual зон, ревью Этапа 5) —
 * коллизии чинит deconflictCells на загрузке у репетитора.
 */
async function createRollSheet(
  db: SupabaseClient,
  boardId: string,
  binding: { tutorStudentId?: string | null; guestId?: string | null },
  updatedBy: string,
): Promise<Record<string, unknown> | null> {
  const { data: pages } = await db
    .from("board_pages")
    .select("page_index, app_state")
    .eq("board_id", boardId);
  const rows = pages ?? [];
  const usedCols = new Set<number>();
  let maxIndex = -1;
  for (const p of rows) {
    maxIndex = Math.max(maxIndex, (p.page_index as number) ?? 0);
    const frame = (p.app_state as { frame?: { col?: number; row?: number } } | null)?.frame;
    if (frame && typeof frame.col === "number" && typeof frame.row === "number" && frame.row >= 1) {
      usedCols.add(frame.col);
    }
  }
  let col = 0;
  while (usedCols.has(col)) col++;
  const { data: page, error } = await db
    .from("board_pages")
    .insert({
      board_id: boardId,
      page_index: maxIndex + 1,
      background: "grid",
      grid_mm: 5,
      zone_tutor_student_id: binding.tutorStudentId ?? null,
      zone_guest_id: binding.guestId ?? null,
      app_state: { orientation: "portrait", frame: { col, row: 1 } },
    })
    .select(PAGE_WHITELIST)
    .single();
  if (error || !page) {
    console.error("whiteboard_public_sheet_create_failed", { code: error?.code });
    return null;
  }
  // Сигнал обязателен (иначе лист невидим realtime'у репетитора до первого
  // сейва) — одна повторная попытка, как в остальных create-путях (ревью P1).
  const bump = await db.rpc("wb_bump_page_rev", {
    p_page_id: page.id,
    p_board_id: boardId,
    p_updated_by: updatedBy,
  });
  if (bump.error) {
    const retry = await db.rpc("wb_bump_page_rev", {
      p_page_id: page.id,
      p_board_id: boardId,
      p_updated_by: updatedBy,
    });
    if (retry.error) {
      console.error("whiteboard_public_sheet_bump_failed", { code: retry.error.code });
    }
  }
  return page;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);
    const idx = url.pathname.indexOf("whiteboard-public");
    const segments = (idx >= 0 ? url.pathname.slice(idx + "whiteboard-public".length) : "")
      .split("/")
      .filter(Boolean);
    if (segments[0] !== "share" || !segments[1]) {
      return jsonError(404, "NOT_FOUND", "Неизвестный маршрут.");
    }
    const slug = segments[1];
    const ip = clientIp(req);

    // Двухуровневый троттл (доревизия по ревью P2: прежний общий 120/IP/мин
    // душил ГРУППУ за одним RU NAT — 4 ученика × поллинг съедали лимит).
    // 1) Широкая страховка на IP — только против потопа.
    if (!(await throttleCheck(db, `wb:any:${ip}`, 600, 60_000))) {
      return jsonError(429, "THROTTLED", "Слишком много запросов. Попробуйте через минуту.");
    }

    const link = await resolveLink(db, slug);
    // 2) Перебор slug'ов режется по ПРОМАХАМ: легитимный трафик группы промахов
    //    не делает, а брутфорс получает 429 после 20 мимо за 10 минут.
    if (!link) {
      if (!(await throttleCheck(db, `wb:miss:${ip}`, 20, 600_000))) {
        return jsonError(429, "THROTTLED", "Слишком много запросов. Попробуйте позже.");
      }
      return jsonError(404, "NOT_FOUND", "Ссылка не действует. Попросите у репетитора новую.");
    }

    // GET /share/:slug — метаданные
    if (req.method === "GET" && segments.length === 2) {
      if (!(await throttleCheck(db, `wb:meta:${ip}`, 30, 60_000))) {
        return jsonError(429, "THROTTLED", "Слишком много запросов. Попробуйте через минуту.");
      }
      const { data: board } = await db
        .from("boards")
        .select("id, title")
        .eq("id", link.board_id)
        .maybeSingle();
      const members = await listCandidates(db, link.board_id);
      return jsonOk({ board_title: (board?.title as string | null) ?? null, members });
    }

    // POST /share/:slug/join
    if (req.method === "POST" && segments.length === 3 && segments[2] === "join") {
      if (!(await throttleCheck(db, `wb:join:${ip}`, 10, 600_000))) {
        return jsonError(429, "THROTTLED", "Слишком много попыток входа. Подождите немного.");
      }
      const body = (await req.json().catch(() => ({}))) as {
        tutor_student_id?: unknown;
        display_name?: unknown;
      };
      const { count } = await db
        .from("board_guests")
        .select("id", { count: "exact", head: true })
        .eq("board_id", link.board_id)
        .is("revoked_at", null);
      if ((count ?? 0) >= MAX_GUESTS_PER_BOARD) {
        return jsonError(409, "LIMIT_REACHED", "На доске слишком много гостей.");
      }

      let tutorStudentId: string | null = null;
      let displayName = "";
      if (typeof body.tutor_student_id === "string" && UUID_RE.test(body.tutor_student_id)) {
        const members = await listCandidates(db, link.board_id);
        const match = members.find((m) => m.tutor_student_id === body.tutor_student_id);
        if (!match) return jsonError(404, "NOT_FOUND", "Такого ученика нет в этой группе.");
        tutorStudentId = match.tutor_student_id;
        displayName = match.name;
      } else if (typeof body.display_name === "string" && body.display_name.trim()) {
        displayName = body.display_name.trim().slice(0, MAX_NAME_LEN);
      } else {
        return jsonError(400, "VALIDATION", "Выберите себя из списка или введите имя.");
      }

      // Пере-вход той же личности (дискавери 31.07): прежние гости РЕВОКАЮТСЯ,
      // их листы ПЕРЕПРИВЯЗЫВАЮТСЯ новому входу — человек возвращается на свой
      // лист, а панель не показывает «Владимир, Владимир». Порядок «ревок →
      // insert» обязателен: уникальные partial-индексы активной личности
      // (миграция 20260731140000) отвергли бы insert при живом прежнем входе.
      // Конкурентный двойной вход: проигравший ловит 23505 и повторяет цикл
      // один раз — уже видя победителя как prior (ревью guest-sheets, P1 №1).
      const nameKey = displayName.trim().toLowerCase();
      let guest: { id: string; guest_token: string; tutor_student_id: string | null } | null = null;
      for (let attempt = 0; attempt < 2 && !guest; attempt++) {
        const { data: priorGuests } = await db
          .from("board_guests")
          .select("id, tutor_student_id, display_name")
          .eq("share_link_id", link.id)
          .is("revoked_at", null);
        const priorIds = (priorGuests ?? [])
          .filter((g) =>
            tutorStudentId
              ? g.tutor_student_id === tutorStudentId
              : !g.tutor_student_id &&
                typeof g.display_name === "string" &&
                g.display_name.trim().toLowerCase() === nameKey
          )
          .map((g) => g.id as string);
        if (priorIds.length > 0) {
          await db
            .from("board_guests")
            .update({ revoked_at: new Date().toISOString() })
            .in("id", priorIds);
        }
        const { data: inserted, error } = await db
          .from("board_guests")
          .insert({
            board_id: link.board_id,
            share_link_id: link.id,
            tutor_student_id: tutorStudentId,
            display_name: displayName,
          })
          .select("id, guest_token, tutor_student_id")
          .single();
        if (inserted) {
          guest = inserted as typeof guest;
        } else if (error?.code !== "23505" || attempt === 1) {
          return jsonError(500, "DB_ERROR", "Не удалось войти на доску.");
        }
      }
      if (!guest) return jsonError(500, "DB_ERROR", "Не удалось войти на доску.");

      // Перепривязка листов ВСЕЙ истории этой личности на ссылке (включая
      // ревокнутые входы прошлых гонок) — лечит любой хвост.
      const { data: identityGuests } = await db
        .from("board_guests")
        .select("id, tutor_student_id, display_name")
        .eq("share_link_id", link.id)
        .neq("id", guest.id);
      const identityIds = (identityGuests ?? [])
        .filter((g) =>
          tutorStudentId
            ? g.tutor_student_id === tutorStudentId
            : !g.tutor_student_id &&
              typeof g.display_name === "string" &&
              g.display_name.trim().toLowerCase() === nameKey
        )
        .map((g) => g.id as string);
      if (identityIds.length > 0) {
        const { data: rebound } = await db
          .from("board_pages")
          .update({ zone_guest_id: guest.id })
          .in("zone_guest_id", identityIds)
          .select("id");
        for (const p of rebound ?? []) {
          await db.rpc("wb_bump_page_rev", {
            p_page_id: p.id,
            p_board_id: link.board_id,
            p_updated_by: `guest:${guest.id}`,
          });
        }
      }

      // «Лист — каждому вошедшему»: свой лист появляется САМ, репетитор не
      // делает ничего. Идемпотентно: если лист личности уже есть — не плодим.
      // Сбой создания = 500 с ревоком входа (ревью P1 №3: 201 без листа
      // возвращал ровно исходный провал «вижу, но не пишу»).
      const sheetFilter = tutorStudentId
        ? { column: "zone_tutor_student_id", value: tutorStudentId }
        : { column: "zone_guest_id", value: guest.id };
      const { data: existingSheet } = await db
        .from("board_pages")
        .select("id")
        .eq("board_id", link.board_id)
        .eq(sheetFilter.column, sheetFilter.value)
        .limit(1);
      if (!existingSheet || existingSheet.length === 0) {
        const sheet = await createRollSheet(
          db,
          link.board_id,
          tutorStudentId ? { tutorStudentId } : { guestId: guest.id },
          `guest:${guest.id}`,
        );
        if (!sheet) {
          await db
            .from("board_guests")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", guest.id);
          return jsonError(500, "DB_ERROR", "Не удалось подготовить ваш лист. Попробуйте войти ещё раз.");
        }
      }

      return jsonOk(
        {
          guest_token: guest.guest_token,
          tutor_student_id: guest.tutor_student_id,
          guest_id: guest.id,
        },
        201,
      );
    }

    // Токен — ТОЛЬКО заголовком. Query-фолбэк удалён (ревью этапов 3–4, P1):
    // прод никогда не жил на query-транспорте (Этап 3 не выкатывался), а bearer
    // в URL оседает в access-логах и истории.
    const guestToken = req.headers.get("x-guest-token");
    const guest = await resolveGuest(db, link.id, guestToken);
    if (!guest) return jsonError(401, "UNAUTHORIZED", "Доступ гостя не действует. Войдите по ссылке заново.");

    // GET /share/:slug/state
    if (req.method === "GET" && segments.length === 3 && segments[2] === "state") {
      // 40/мин: каждый rev-сигнал поллинга (2.5 с) дёргает resync=/state —
      // прежние 10/мин душили живой урок собственным лимитом (ревью, P1).
      if (!(await throttleCheck(db, `wb:state:${guest.id}`, 40, 60_000))) {
        return jsonError(429, "THROTTLED", "Слишком часто. Подождите немного.");
      }
      const { data: board, error: boardError } = await db
        .from("boards")
        .select("id, title")
        .eq("id", guest.board_id)
        .maybeSingle();
      // rev — ВСТРОЕННЫМ селектом (один снапшот): раздельные запросы давали
      // пару «старые elements + новый rev», и следующий сейв законно затирал
      // более свежую сцену (ревью, P0). Ошибки НЕ маскируются пустой доской:
      // клиентский resync снёс бы локальные рамки и очередь сочла бы их
      // сохранёнными (ревью, P0) — fail-closed 503.
      const { data: pages, error: pagesError } = await db
        .from("board_pages")
        .select(`${PAGE_WHITELIST}, board_page_revs(rev)`)
        .eq("board_id", guest.board_id)
        .order("page_index", { ascending: true });
      if (boardError || pagesError || !board) {
        return jsonError(503, "STATE_READ_FAILED", "Не удалось загрузить доску. Попробуйте ещё раз.");
      }
      const rows = (pages ?? []).map((p) => {
        const { board_page_revs: revRow, ...rest } = p as Record<string, unknown> & {
          board_page_revs?: { rev?: number } | null;
        };
        return { ...rest, rev: Number(revRow?.rev) || 0 };
      });
      await db.from("board_guests").update({ last_seen_at: new Date().toISOString() }).eq("id", guest.id);
      // Подписанные URL картинок: у гостя нет storage-прав, подписывает сервер.
      const imageUrls = await signBoardImages(db, guest.board_id, rows);
      return jsonOk({
        board: { id: board.id, title: (board.title as string | null) ?? null },
        my_tutor_student_id: guest.tutor_student_id,
        // Идентичность гостя для writable по zone_guest_id (лист гостя не из CRM).
        my_guest_id: guest.id,
        pages: rows,
        image_urls: imageUrls,
        // Watermark поллинга: клиент стартует /signals?since= отсюда.
        now: new Date().toISOString(),
      });
    }

    // GET /share/:slug/signals?since=
    if (req.method === "GET" && segments.length === 3 && segments[2] === "signals") {
      if (!(await throttleCheck(db, `wb:sig:${guest.id}`, 40, 60_000))) {
        return jsonError(429, "THROTTLED", "Слишком часто.");
      }
      const since = url.searchParams.get("since");
      let query = db
        .from("board_page_revs")
        .select("page_id, rev, updated_by, updated_at")
        .eq("board_id", guest.board_id);
      if (since) query = query.gt("updated_at", since);
      const { data: revs } = await query;
      // Пульс присутствия (Этап 5): панель репетитора видит гостей по
      // last_seen_at — /state дёргается только при изменениях, поэтому
      // «тихий» гость обновляет метку отсюда (каждые 2.5/15 с).
      // await обязателен: PostgREST-builder ленив и без await не исполнится.
      await db.from("board_guests").update({ last_seen_at: new Date().toISOString() }).eq("id", guest.id);
      // bring (Этап 4): у гостя нет Realtime — «Привести всех» доезжает отсюда.
      // Отдаём ВСЕГДА (не фильтруя по since): клиент дедупит по seq и сам
      // игнорирует сигнал старше 2 минут.
      const { data: boardRow } = await db
        .from("boards")
        .select("live_bring")
        .eq("id", guest.board_id)
        .maybeSingle();
      return jsonOk({
        revs: revs ?? [],
        bring: boardRow?.live_bring ?? null,
        now: new Date().toISOString(),
      });
    }

    // POST /share/:slug/pages — «+ Лист» в мой рулон (кейс Елены: «у ученика
    // кончился лист»; растёт ВНИЗ его столбца, зеркало student-api).
    if (req.method === "POST" && segments.length === 3 && segments[2] === "pages") {
      if (!(await throttleCheck(db, `wb:addpage:${guest.id}`, 10, 60_000))) {
        return jsonError(429, "THROTTLED", "Слишком часто.");
      }
      const myFilter = guest.tutor_student_id
        ? { column: "zone_tutor_student_id", value: guest.tutor_student_id }
        : { column: "zone_guest_id", value: guest.id };
      const { data: myPages, error: myPagesError } = await db
        .from("board_pages")
        .select("id, page_index, app_state")
        .eq("board_id", guest.board_id)
        .eq(myFilter.column, myFilter.value);
      if (myPagesError) return jsonError(500, "DB_ERROR", "Не удалось добавить лист.");
      if (!myPages || myPages.length === 0) {
        return jsonError(409, "NO_ZONE", "У вас пока нет своего листа — попросите репетитора выдать его.");
      }
      if (myPages.length >= MAX_ROLL_PAGES) {
        return jsonError(409, "LIMIT_REACHED", `В вашем рулоне уже ${MAX_ROLL_PAGES} листов.`);
      }
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
        .eq("board_id", guest.board_id)
        .order("page_index", { ascending: false })
        .limit(1);
      const nextIndex = all && all.length > 0 ? (all[0].page_index as number) + 1 : 0;
      const { data: page, error: addError } = await db
        .from("board_pages")
        .insert({
          board_id: guest.board_id,
          page_index: nextIndex,
          background: "grid",
          grid_mm: 5,
          zone_tutor_student_id: guest.tutor_student_id,
          zone_guest_id: guest.tutor_student_id ? null : guest.id,
          app_state: { orientation: "portrait", frame: { col, row: maxRow + 1 } },
        })
        .select(PAGE_WHITELIST)
        .single();
      if (addError || !page) return jsonError(500, "DB_ERROR", "Не удалось добавить лист.");
      const { data: revData } = await db.rpc("wb_bump_page_rev", {
        p_page_id: page.id,
        p_board_id: guest.board_id,
        p_updated_by: `guest:${guest.id}`,
      });
      return jsonOk({ page, rev: Number(revData) || 0 }, 201);
    }

    // POST /share/:slug/pages/:pageId
    if (req.method === "POST" && segments.length === 4 && segments[2] === "pages") {
      const pageId = segments[3];
      if (!UUID_RE.test(pageId)) return jsonError(400, "VALIDATION", "Некорректный идентификатор листа.");
      // ⚠️ Гард «!tutor_student_id → VIEWER_ONLY» УДАЛЁН (ревью guest-sheets,
      // P0 №1: он стоял ВЫШЕ проверки владения и глушил весь сценарий
      // свободного гостя). Право писать решает владение листом ниже
      // (zone_guest_id === guest.id ИЛИ zone_tutor_student_id).
      if (!(await throttleCheck(db, `wb:save:${guest.id}`, 90, 60_000))) {
        return jsonError(429, "THROTTLED", "Слишком часто.");
      }
      const raw = await req.text();
      if (raw.length > MAX_PAGE_PAYLOAD_BYTES) {
        return jsonError(413, "PAYLOAD_TOO_LARGE", "Лист слишком большой. Продолжите на новом листе.");
      }
      let body: { elements?: unknown; base_rev?: unknown };
      try {
        body = JSON.parse(raw);
      } catch {
        return jsonError(400, "VALIDATION", "Некорректные данные листа.");
      }
      if (!Array.isArray(body.elements) || body.elements.length > MAX_ELEMENTS_PER_PAGE) {
        return jsonError(400, "VALIDATION", "Некорректные данные листа.");
      }

      const { data: page } = await db
        .from("board_pages")
        .select("id, board_id, elements, zone_tutor_student_id, zone_guest_id")
        .eq("id", pageId)
        .maybeSingle();
      if (!page || page.board_id !== guest.board_id) {
        return jsonError(404, "NOT_FOUND", "Лист не найден.");
      }
      // Лист мой ЛИБО как ученика CRM, ЛИБО как гостя (фаза «Лист — каждому
      // вошедшему»: гость не из списка тоже пишет — в свой zone_guest_id-лист).
      const ownsByStudent =
        !!guest.tutor_student_id && page.zone_tutor_student_id === guest.tutor_student_id;
      const ownsByGuest = page.zone_guest_id === guest.id;
      if (!ownsByStudent && !ownsByGuest) {
        return jsonError(403, "FOREIGN_ZONE", "Это не ваш лист — писать можно только в своей зоне.");
      }
      // Живое членство (ревью P0 №2) — только для привязки через CRM: убранный
      // из группы сохраняет зону как артефакт, но read-only. Для гостевого листа
      // «членство» = живой bearer, он уже проверен resolveGuest.
      if (ownsByStudent && !ownsByGuest) {
        const candidates = await listCandidates(db, guest.board_id);
        if (!candidates.some((c) => c.tutor_student_id === guest.tutor_student_id)) {
          return jsonError(403, "NOT_A_PARTICIPANT", "Вы больше не участвуете в этом занятии — доска доступна только для чтения.");
        }
      }
      // Fail-closed: чужой image-ref = попытка подписи чужого файла (P0 №3).
      if (hasForeignImageRef(body.elements, guest.board_id)) {
        return jsonError(400, "VALIDATION", "Некорректные данные листа.");
      }

      // CAS и бамп — одна транзакция. base_rev ОБЯЗАТЕЛЕН (ревью этапов 3–4,
      // P0): гостевой клиент всегда его шлёт, легаси-версий этого роута в
      // проде не существовало — NULL-обход CAS закрыт fail-closed.
      const baseRev = body.base_rev;
      if (typeof baseRev !== "number" || !Number.isInteger(baseRev) || baseRev < 0) {
        return jsonError(400, "VALIDATION", "Некорректные данные листа.");
      }
      const { data: cas, error: casError } = await db.rpc("wb_save_page_elements", {
        p_page_id: pageId,
        p_elements: body.elements,
        p_base_rev: baseRev,
        p_updated_by: `guest:${guest.id}`,
      });
      if (casError || !cas) return jsonError(500, "DB_ERROR", "Не удалось сохранить лист.");
      const outcome = cas as { status: string; rev?: number; elements?: unknown };
      if (outcome.status === "not_found") return jsonError(404, "NOT_FOUND", "Лист не найден.");
      if (outcome.status === "conflict") {
        return jsonError(409, "REV_CONFLICT", "Лист изменился с другого устройства.", {
          rev: outcome.rev ?? 0,
          elements: outcome.elements ?? [],
        });
      }
      await db.from("board_guests").update({ last_seen_at: new Date().toISOString() }).eq("id", guest.id);
      return jsonOk({ rev: Number(outcome.rev) || 0 });
    }

    return jsonError(404, "NOT_FOUND", "Неизвестный маршрут.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("whiteboard_public_unhandled", { message: message.slice(0, 200) });
    return jsonError(500, "INTERNAL", `Внутренняя ошибка доски: ${message}`);
  }
});
