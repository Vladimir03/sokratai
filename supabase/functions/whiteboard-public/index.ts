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
  "id, board_id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, updated_at";
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
  if (ids.length === 0 && board.student_id) ids.push(board.student_id as string);
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

      const { data: guest, error } = await db
        .from("board_guests")
        .insert({
          board_id: link.board_id,
          share_link_id: link.id,
          tutor_student_id: tutorStudentId,
          display_name: displayName,
        })
        .select("id, guest_token, tutor_student_id")
        .single();
      if (error || !guest) return jsonError(500, "DB_ERROR", "Не удалось войти на доску.");
      return jsonOk(
        { guest_token: guest.guest_token, tutor_student_id: guest.tutor_student_id },
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

    // POST /share/:slug/pages/:pageId
    if (req.method === "POST" && segments.length === 4 && segments[2] === "pages") {
      const pageId = segments[3];
      if (!UUID_RE.test(pageId)) return jsonError(400, "VALIDATION", "Некорректный идентификатор листа.");
      if (!guest.tutor_student_id) {
        return jsonError(403, "VIEWER_ONLY", "Вы вошли как зритель — писать пока нельзя.");
      }
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
        .select("id, board_id, elements, zone_tutor_student_id")
        .eq("id", pageId)
        .maybeSingle();
      if (!page || page.board_id !== guest.board_id) {
        return jsonError(404, "NOT_FOUND", "Лист не найден.");
      }
      if (page.zone_tutor_student_id !== guest.tutor_student_id) {
        return jsonError(403, "FOREIGN_ZONE", "Это не ваш лист — писать можно только в своей зоне.");
      }
      // Живое членство (ревью P0 №2): убранный из группы гость сохраняет зону
      // как артефакт урока, но только для чтения — join-время не «замораживает» права.
      const candidates = await listCandidates(db, guest.board_id);
      if (!candidates.some((c) => c.tutor_student_id === guest.tutor_student_id)) {
        return jsonError(403, "NOT_A_PARTICIPANT", "Вы больше не участвуете в этом занятии — доска доступна только для чтения.");
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
