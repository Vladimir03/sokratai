// whiteboard-public — ГОСТЕВОЙ доступ к доске без регистрации (B4, Этап 2).
// Эталон — mock-exam-public: verify_jwt=false, service_role, whitelist-ответы,
// throttle на каждый роут. Bearer'ы (slug, guest_token) НЕ логировать (rule 96 №10).
//
// Роуты:
//   GET  /share/:slug                     — метаданные: название + кандидаты-ученики
//   POST /share/:slug/join                — { tutor_student_id? | display_name } → guest_token
//   GET  /share/:slug/state?guest_token=  — доска + листы (whitelist)
//   GET  /share/:slug/signals?guest_token=&since= — поллинг revs (у гостя нет JWT → нет Realtime)
//   POST /share/:slug/pages/:pageId?guest_token=  — { elements, base_rev } в СВОЮ зону
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

/** Signed URL картинок листов (у гостя нет storage-прав; host → RU-safe, rule 96). */
async function signBoardImages(
  db: SupabaseClient,
  pages: { elements?: unknown }[],
): Promise<Record<string, string>> {
  const prefix = `storage://${BOARD_IMAGE_BUCKET}/`;
  const paths = new Set<string>();
  for (const p of pages) {
    const elements = Array.isArray(p.elements) ? (p.elements as { type?: string; ref?: string }[]) : [];
    for (const el of elements) {
      if (el?.type === "image" && typeof el.ref === "string" && el.ref.startsWith(prefix)) {
        paths.add(el.ref.slice(prefix.length));
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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Общий троттл ДО резолва ссылки: иначе перебор slug'ов не ограничен ничем
    // (роут-специфичные лимиты стоят уже после успешного резолва).
    if (!(await throttleCheck(db, `wb:any:${ip}`, 120, 60_000))) {
      return jsonError(429, "THROTTLED", "Слишком много запросов. Попробуйте через минуту.");
    }

    const link = await resolveLink(db, slug);
    if (!link) return jsonError(404, "NOT_FOUND", "Ссылка не действует. Попросите у репетитора новую.");

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

    const guestToken = url.searchParams.get("guest_token");
    const guest = await resolveGuest(db, link.id, guestToken);
    if (!guest) return jsonError(401, "UNAUTHORIZED", "Доступ гостя не действует. Войдите по ссылке заново.");

    // GET /share/:slug/state
    if (req.method === "GET" && segments.length === 3 && segments[2] === "state") {
      if (!(await throttleCheck(db, `wb:state:${guest.id}`, 10, 60_000))) {
        return jsonError(429, "THROTTLED", "Слишком часто. Подождите немного.");
      }
      const { data: board } = await db
        .from("boards")
        .select("id, title")
        .eq("id", guest.board_id)
        .maybeSingle();
      const { data: pages } = await db
        .from("board_pages")
        .select(PAGE_WHITELIST)
        .eq("board_id", guest.board_id)
        .order("page_index", { ascending: true });
      const { data: revs } = await db
        .from("board_page_revs")
        .select("page_id, rev, updated_by, updated_at")
        .eq("board_id", guest.board_id);
      await db.from("board_guests").update({ last_seen_at: new Date().toISOString() }).eq("id", guest.id);
      // Подписанные URL картинок: у гостя нет storage-прав, подписывает сервер.
      const imageUrls = await signBoardImages(db, pages ?? []);
      return jsonOk({
        board: { id: board?.id, title: (board?.title as string | null) ?? null },
        my_tutor_student_id: guest.tutor_student_id,
        pages: pages ?? [],
        revs: revs ?? [],
        image_urls: imageUrls,
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
      return jsonOk({ revs: revs ?? [], now: new Date().toISOString() });
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

      const { data: revRow } = await db
        .from("board_page_revs")
        .select("rev")
        .eq("page_id", pageId)
        .maybeSingle();
      const currentRev = (revRow?.rev as number | undefined) ?? 1;
      const baseRev = typeof body.base_rev === "number" ? body.base_rev : null;
      if (baseRev !== null && baseRev !== currentRev) {
        return jsonError(409, "REV_CONFLICT", "Лист изменился с другого устройства.", {
          rev: currentRev,
          elements: page.elements,
        });
      }

      const { error } = await db.from("board_pages").update({ elements: body.elements }).eq("id", pageId);
      if (error) return jsonError(500, "DB_ERROR", "Не удалось сохранить лист.");
      const nextRev = currentRev + 1;
      await db
        .from("board_page_revs")
        .update({ rev: nextRev, updated_by: `guest:${guest.id}`, updated_at: new Date().toISOString() })
        .eq("page_id", pageId);
      await db.from("board_guests").update({ last_seen_at: new Date().toISOString() }).eq("id", guest.id);
      return jsonOk({ rev: nextRev });
    }

    return jsonError(404, "NOT_FOUND", "Неизвестный маршрут.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("whiteboard_public_unhandled", { message: message.slice(0, 200) });
    return jsonError(500, "INTERNAL", `Внутренняя ошибка доски: ${message}`);
  }
});
