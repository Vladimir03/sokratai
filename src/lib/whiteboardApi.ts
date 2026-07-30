import { supabase } from '@/lib/supabaseClient';
import { extractEdgeFunctionError } from '@/lib/edgeFunctionError';
import type { BoardBackground, BoardGridMm } from '@/lib/whiteboard/model';

// ─── whiteboard-api client (Фаза 1, задача W1.2) ──────────────────────────────
//
// Тонкий клиент над path-routed edge-функцией `whiteboard-api` (verify_jwt=true).
// Транспорт — `supabase.functions.invoke` с подпутём: FunctionsClient собирает
// URL от нашего захардкоженного `api.sokratai.ru` (RU-safe, rule 96).
// Ошибки разбираются через `extractEdgeFunctionError` (плоский `{error, code}`, rule 97).

export interface Board {
  id: string;
  student_id: string | null;
  lesson_id: string | null;
  title: string | null;
  export_material_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardPageRow {
  id: string;
  board_id: string;
  page_index: number;
  elements: unknown;
  app_state: Record<string, unknown> | null;
  background: BoardBackground;
  grid_mm: BoardGridMm;
  /** Зона ученика (рулон = несколько строк одного ученика); NULL — лист репетитора. */
  zone_tutor_student_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardWithPages {
  board: Board;
  pages: BoardPageRow[];
}

/** rule 97 flat-shape error carrier — `code` нужен для ветвления (LAST_PAGE и пр.). */
export class WhiteboardApiError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'WhiteboardApiError';
    this.code = code;
  }
}

const FN = 'whiteboard-api';

async function invokeWhiteboard<T>(
  subpath: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown },
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`${FN}${subpath}`, {
    method: init.method,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  if (error) {
    const { message, code } = await extractEdgeFunctionError(
      error,
      data,
      'Не удалось выполнить операцию с доской. Попробуйте ещё раз.',
    );
    throw new WhiteboardApiError(message, code);
  }
  return data as T;
}

/** GET /boards */
export async function listBoards(): Promise<Board[]> {
  const res = await invokeWhiteboard<{ items: Board[] }>('/boards', { method: 'GET' });
  return res.items ?? [];
}

/** POST /boards — создаёт доску вместе с первой страницей. */
export async function createBoard(input: {
  title?: string | null;
  student_id?: string | null;
  lesson_id?: string | null;
} = {}): Promise<BoardWithPages> {
  return invokeWhiteboard<BoardWithPages>('/boards', {
    method: 'POST',
    body: {
      title: input.title ?? null,
      student_id: input.student_id ?? null,
      lesson_id: input.lesson_id ?? null,
    },
  });
}

/** GET /boards/:id */
export async function getBoard(boardId: string): Promise<BoardWithPages> {
  return invokeWhiteboard<BoardWithPages>(`/boards/${encodeURIComponent(boardId)}`, {
    method: 'GET',
  });
}

/** POST /boards/:id — переименование и запись ссылки на последний экспорт. */
export async function updateBoard(
  boardId: string,
  patch: { title?: string | null; export_material_id?: string | null },
): Promise<Board> {
  const res = await invokeWhiteboard<{ board: Board }>(
    `/boards/${encodeURIComponent(boardId)}`,
    { method: 'POST', body: patch },
  );
  return res.board;
}

/** DELETE /boards/:id */
export async function deleteBoard(boardId: string): Promise<void> {
  await invokeWhiteboard<{ ok: true }>(`/boards/${encodeURIComponent(boardId)}`, {
    method: 'DELETE',
  });
}

/** POST /boards/:id/pages. `elements` — атомарное создание С контентом
 * (PDF-импорт: обрыв сети не оставляет осиротевший пустой лист). */
export async function createBoardPage(
  boardId: string,
  input: {
    background?: BoardBackground;
    grid_mm?: BoardGridMm;
    app_state?: Record<string, unknown>;
    elements?: unknown[];
  } = {},
): Promise<BoardPageRow> {
  const res = await invokeWhiteboard<{ page: BoardPageRow }>(
    `/boards/${encodeURIComponent(boardId)}/pages`,
    {
      method: 'POST',
      body: {
        background: input.background ?? 'grid',
        grid_mm: input.grid_mm ?? 5,
        ...(input.app_state ? { app_state: input.app_state } : {}),
        ...(input.elements ? { elements: input.elements } : {}),
      },
    },
  );
  return res.page;
}

export interface SavePageConflict {
  rev: number;
  elements: unknown;
}

export interface SavePageOutcome {
  page?: BoardPageRow;
  rev?: number;
  conflict?: SavePageConflict;
}

/**
 * POST /pages/:id — автосохранение сцены и разлиновки. С Этапа 3 несёт
 * base_rev: репетитор может конкурировать с учеником В ЕГО ЗОНЕ, и 409
 * REV_CONFLICT возвращает серверные elements для reconcile (не исключение —
 * это ШТАТНЫЙ путь совместной работы).
 */
export async function saveBoardPage(
  pageId: string,
  patch: {
    elements?: unknown[];
    app_state?: Record<string, unknown>;
    background?: BoardBackground;
    grid_mm?: BoardGridMm;
    zone_tutor_student_id?: string | null;
    base_rev?: number;
  },
): Promise<SavePageOutcome> {
  const { data, error } = await supabase.functions.invoke(
    `${FN}/pages/${encodeURIComponent(pageId)}`,
    { method: 'POST', body: patch },
  );
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = (await ctx.json()) as {
          code?: string;
          error?: string;
          rev?: number;
          elements?: unknown;
        };
        if (parsed.code === 'REV_CONFLICT' && typeof parsed.rev === 'number') {
          return { conflict: { rev: parsed.rev, elements: parsed.elements ?? [] } };
        }
        throw new WhiteboardApiError(
          parsed.error ?? 'Не удалось сохранить лист. Попробуйте ещё раз.',
          parsed.code ?? null,
        );
      } catch (err) {
        if (err instanceof WhiteboardApiError) throw err;
      }
    }
    throw new WhiteboardApiError('Не удалось сохранить лист. Попробуйте ещё раз.');
  }
  const res = data as { page: BoardPageRow; rev?: number };
  return { page: res.page, rev: res.rev };
}

/** DELETE /pages/:id — единственную страницу удалить нельзя (409 LAST_PAGE). */
export async function deleteBoardPage(pageId: string): Promise<void> {
  await invokeWhiteboard<{ ok: true }>(`/pages/${encodeURIComponent(pageId)}`, {
    method: 'DELETE',
  });
}

/** GET /lessons/:lessonId/board — найти-или-создать доску занятия (идемпотентно). */
export async function getOrCreateLessonBoard(lessonId: string): Promise<BoardWithPages> {
  return invokeWhiteboard<BoardWithPages>(
    `/lessons/${encodeURIComponent(lessonId)}/board`,
    { method: 'GET' },
  );
}

/** POST /boards/:id/zones — раздать рулоны-зоны по группе занятия (идемпотентно). */
export async function distributeZones(boardId: string): Promise<BoardPageRow[]> {
  const res = await invokeWhiteboard<{ pages: BoardPageRow[] }>(
    `/boards/${encodeURIComponent(boardId)}/zones`,
    { method: 'POST', body: {} },
  );
  return res.pages ?? [];
}

/** POST /boards/:id/bring — персист «Привести всех» для гостей (поллинг /signals);
 * ученикам сигнал уходит broadcast'ом (boardLive) — это только гостевое плечо. */
export async function sendBoardBring(
  boardId: string,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): Promise<void> {
  await invokeWhiteboard<{ ok: true }>(`/boards/${encodeURIComponent(boardId)}/bring`, {
    method: 'POST',
    body: { bounds },
  });
}

/** POST /boards/:id/share — создать/получить гостевую ссылку (slug — bearer, не логировать). */
export async function ensureShareLink(boardId: string): Promise<string> {
  const res = await invokeWhiteboard<{ slug: string }>(
    `/boards/${encodeURIComponent(boardId)}/share`,
    { method: 'POST', body: {} },
  );
  return res.slug;
}

/** DELETE /boards/:id/share — отозвать гостевую ссылку (гости отваливаются сразу). */
export async function revokeShareLink(boardId: string): Promise<void> {
  await invokeWhiteboard<{ ok: true }>(
    `/boards/${encodeURIComponent(boardId)}/share`,
    { method: 'DELETE' },
  );
}
