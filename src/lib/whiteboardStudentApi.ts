import { supabase } from '@/lib/supabaseClient';
import { parseFrameRow, type SharedFrame } from '@/lib/whiteboard/frameRows';
import type { BoardElement } from '@/lib/whiteboard/model';

// ─── Доска глазами УЧЕНИКА с аккаунтом (Этап 3, B4) ───────────────────────────
//
// Чтение — напрямую PostgREST под RLS (политики is_board_participant из
// миграции 20260730120000): column-GRANT'ы уже отдают только whitelist.
// Запись — edge `whiteboard-student-api` (verify_jwt=true): сервер сам решает,
// «его ли зона», клиентским правам не доверяем.
//
// 409 REV_CONFLICT несёт серверные elements + rev — транспорт обязан отдать их
// вызывающему (штатный путь reconcile), поэтому invoke здесь свой, а не
// extractEdgeFunctionError (тот отдаёт только message/code).

export class StudentBoardError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'StudentBoardError';
    this.code = code;
  }
}

export interface SaveConflict {
  rev: number;
  elements: unknown;
}

export type SaveResult = { rev: number } | { conflict: SaveConflict };

export interface StudentBoardState {
  boardId: string;
  boardTitle: string | null;
  myZoneStudentId: string | null;
  zoneNames: Record<string, string>;
  imageUrls: Record<string, string>;
  frames: SharedFrame[];
}

const FN_URL_BASE = 'whiteboard-student-api';

async function invokeStudentApi<T>(subpath: string, body: unknown): Promise<T | { conflict: SaveConflict }> {
  const { data, error } = await supabase.functions.invoke(`${FN_URL_BASE}${subpath}`, {
    method: 'POST',
    body,
  });
  if (error) {
    // 409 с полезной нагрузкой: тело лежит в error.context (Response).
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
        throw new StudentBoardError(
          parsed.error ?? 'Не удалось сохранить лист. Попробуйте ещё раз.',
          parsed.code ?? null,
        );
      } catch (err) {
        if (err instanceof StudentBoardError) throw err;
      }
    }
    throw new StudentBoardError('Не удалось выполнить операцию с доской.');
  }
  return data as T;
}

/**
 * Полное состояние доски: строки — PostgREST под RLS; «моя зона», подписи зон
 * и signed URL картинок — edge GET /boards/:id/me (у ученика НЕТ RLS-чтения
 * tutor_students и НЕТ storage-прав на board-images — только сервер).
 */
export async function getStudentBoardState(boardId: string): Promise<StudentBoardState> {
  // rev — встроенным селектом (единый снимок elements+rev, ревью P0).
  const [{ data: board, error: boardError }, { data: pages, error: pagesError }, me] =
    await Promise.all([
      supabase.from('boards').select('id, title').eq('id', boardId).maybeSingle(),
      supabase
        .from('board_pages')
        .select(
          'id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, board_page_revs(rev)',
        )
        .eq('board_id', boardId)
        .order('page_index', { ascending: true }),
      invokeStudentMe(boardId),
    ]);

  if (boardError || pagesError) {
    throw new StudentBoardError('Не удалось загрузить доску. Проверьте сеть и попробуйте ещё раз.');
  }
  if (!board) {
    throw new StudentBoardError('Доска не найдена или у вас больше нет к ней доступа.', 'NOT_FOUND');
  }

  return {
    boardId,
    boardTitle: (board.title as string | null) ?? null,
    myZoneStudentId: me.myTutorStudentId,
    zoneNames: me.zoneNames,
    imageUrls: me.imageUrls,
    frames: (pages ?? []).map((row, i) => {
      const embedded = (row as { board_page_revs?: { rev?: number } | { rev?: number }[] | null })
        .board_page_revs;
      const revRow = Array.isArray(embedded) ? embedded[0] : embedded;
      return parseFrameRow(row, i, Number(revRow?.rev) || 0);
    }),
  };
}

/** GET /boards/:id/me — также используется для догруза URL новых картинок. */
export async function invokeStudentMe(boardId: string): Promise<{
  myTutorStudentId: string | null;
  zoneNames: Record<string, string>;
  imageUrls: Record<string, string>;
}> {
  const { data, error } = await supabase.functions.invoke(
    `${FN_URL_BASE}/boards/${encodeURIComponent(boardId)}/me`,
    { method: 'GET' },
  );
  if (error) {
    throw new StudentBoardError('Доска не найдена или у вас больше нет к ней доступа.', 'NOT_FOUND');
  }
  const body = data as {
    my_tutor_student_id?: string | null;
    zone_names?: Record<string, string>;
    image_urls?: Record<string, string>;
  };
  return {
    myTutorStudentId: body.my_tutor_student_id ?? null,
    zoneNames: body.zone_names ?? {},
    imageUrls: body.image_urls ?? {},
  };
}

/**
 * Перечитать один лист (реакция на чужой rev-сигнал). rev — ВСТРОЕННЫМ
 * селектом, один DB-снимок (ревью этапов 3–4, P0): раздельные запросы давали
 * пару «старые elements + новый rev», и следующий сейв затирал свежую сцену.
 */
export async function refetchStudentPage(
  pageId: string,
): Promise<{ row: Record<string, unknown>; rev: number } | null> {
  const { data: row } = await supabase
    .from('board_pages')
    .select(
      'id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, board_page_revs(rev)',
    )
    .eq('id', pageId)
    .maybeSingle();
  if (!row) return null;
  const embedded = (row as { board_page_revs?: { rev?: number } | { rev?: number }[] | null })
    .board_page_revs;
  const revRow = Array.isArray(embedded) ? embedded[0] : embedded;
  return { row: row as Record<string, unknown>, rev: Number(revRow?.rev) || 0 };
}

/** Сохранить СВОЮ зону. 409 → conflict с серверными elements. */
export async function saveStudentPage(
  pageId: string,
  elements: BoardElement[],
  baseRev: number,
): Promise<SaveResult> {
  const res = await invokeStudentApi<{ rev: number }>(`/pages/${encodeURIComponent(pageId)}`, {
    elements,
    base_rev: baseRev,
  });
  return res;
}

/** Добавить лист в свой рулон. */
export async function addStudentRollPage(boardId: string): Promise<SharedFrame> {
  const res = await invokeStudentApi<{ page: Record<string, unknown>; rev: number }>(
    `/boards/${encodeURIComponent(boardId)}/pages`,
    {},
  );
  if ('conflict' in res) {
    throw new StudentBoardError('Не удалось добавить лист.');
  }
  return parseFrameRow(res.page as never, 0, res.rev);
}
