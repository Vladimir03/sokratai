// ─── Доска глазами ГОСТЯ без аккаунта (Этап 3, B4) ────────────────────────────
//
// Прямой fetch к whiteboard-public (verify_jwt=false): supabase-js не нужен и
// вреден — у гостя нет сессии. Хост захардкожен RU-safe (rule 96: api.sokratai.ru).
// guest_token — bearer: живёт в localStorage per slug, в логи не попадает.
// Realtime гостю недоступен (нет JWT) → поллинг /signals с backoff.

import { SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabaseClient';
import { parseFrameRow, type SharedFrame } from '@/lib/whiteboard/frameRows';
import type { BoardElement } from '@/lib/whiteboard/model';
import type { SaveResult } from '@/lib/whiteboardStudentApi';

const BASE = 'https://api.sokratai.ru/functions/v1/whiteboard-public';

export class GuestBoardError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = 'GuestBoardError';
    this.code = code;
    this.status = status;
  }
}

interface GuestFetchResult {
  status: number;
  body: Record<string, unknown>;
}

async function guestFetch(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; guestToken?: string } = { method: 'GET' },
): Promise<GuestFetchResult> {
  const resp = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      // bearer гостя — ЗАГОЛОВКОМ, не query: URL оседает в access-логах,
      // истории и диагностических дампах (внешнее ревью, P1).
      ...(init.guestToken ? { 'X-Guest-Token': init.guestToken } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await resp.json()) as Record<string, unknown>;
  } catch {
    // пустое тело — оставляем {}
  }
  return { status: resp.status, body };
}

function throwGuestError(result: GuestFetchResult, fallback: string): never {
  throw new GuestBoardError(
    (result.body.error as string | undefined) ?? fallback,
    (result.body.code as string | undefined) ?? null,
    result.status,
  );
}

// ─── Токен гостя ───────────────────────────────────────────────────────────────

const tokenKey = (slug: string) => `board-guest-token:${slug}`;

export function getStoredGuestToken(slug: string): string | null {
  try {
    return localStorage.getItem(tokenKey(slug));
  } catch {
    return null;
  }
}

export function storeGuestToken(slug: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(slug), token);
  } catch {
    // приватный режим Safari — гость просто пере-джойнится после перезагрузки
  }
}

export function clearGuestToken(slug: string): void {
  try {
    localStorage.removeItem(tokenKey(slug));
  } catch {
    // ignore
  }
}

// ─── Роуты ─────────────────────────────────────────────────────────────────────

export interface GuestBoardMeta {
  boardTitle: string | null;
  members: { tutor_student_id: string; name: string }[];
}

export async function getGuestMeta(slug: string): Promise<GuestBoardMeta> {
  const res = await guestFetch(`/share/${encodeURIComponent(slug)}`);
  if (res.status !== 200) throwGuestError(res, 'Ссылка не действует.');
  return {
    boardTitle: (res.body.board_title as string | null) ?? null,
    members: (res.body.members as GuestBoardMeta['members'] | undefined) ?? [],
  };
}

export async function joinGuestBoard(
  slug: string,
  input: { tutor_student_id?: string; display_name?: string },
): Promise<{ guestToken: string; myTutorStudentId: string | null }> {
  const res = await guestFetch(`/share/${encodeURIComponent(slug)}/join`, {
    method: 'POST',
    body: input,
  });
  if (res.status !== 201) throwGuestError(res, 'Не удалось войти на доску.');
  const token = res.body.guest_token as string;
  storeGuestToken(slug, token);
  return {
    guestToken: token,
    myTutorStudentId: (res.body.tutor_student_id as string | null) ?? null,
  };
}

export interface GuestBoardState {
  boardTitle: string | null;
  myZoneStudentId: string | null;
  imageUrls: Record<string, string>;
  frames: SharedFrame[];
  /** Курсор поллинга: max(updated_at) из revs. */
  since: string | null;
}

export async function getGuestState(slug: string, guestToken: string): Promise<GuestBoardState> {
  const res = await guestFetch(`/share/${encodeURIComponent(slug)}/state`, {
    method: 'GET',
    guestToken,
  });
  if (res.status === 401) {
    clearGuestToken(slug);
    throwGuestError(res, 'Доступ гостя не действует.');
  }
  if (res.status !== 200) throwGuestError(res, 'Не удалось загрузить доску.');

  const revs = (res.body.revs as { page_id: string; rev: number; updated_at: string }[] | undefined) ?? [];
  const revByPage = new Map<string, number>();
  let since: string | null = null;
  for (const r of revs) {
    revByPage.set(r.page_id, Number(r.rev) || 0);
    if (!since || r.updated_at > since) since = r.updated_at;
  }
  const pages = (res.body.pages as Record<string, unknown>[] | undefined) ?? [];
  return {
    boardTitle: ((res.body.board as { title?: string | null } | undefined)?.title as string | null) ?? null,
    myZoneStudentId: (res.body.my_tutor_student_id as string | null) ?? null,
    imageUrls: (res.body.image_urls as Record<string, string> | undefined) ?? {},
    frames: pages.map((row, i) =>
      parseFrameRow(row as never, i, revByPage.get(row.id as string) ?? 0),
    ),
    since,
  };
}

export interface GuestSignal {
  page_id: string;
  rev: number;
  updated_by: string;
  updated_at: string;
}

export interface GuestBring {
  seq: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  at?: string | null;
}

export async function getGuestSignals(
  slug: string,
  guestToken: string,
  since: string | null,
): Promise<{ revs: GuestSignal[]; bring: GuestBring | null; now: string }> {
  const qs = since ? `?${new URLSearchParams({ since }).toString()}` : '';
  const res = await guestFetch(`/share/${encodeURIComponent(slug)}/signals${qs}`, {
    method: 'GET',
    guestToken,
  });
  if (res.status !== 200) throwGuestError(res, 'Потеряна связь с доской.');
  return {
    revs: (res.body.revs as GuestSignal[] | undefined) ?? [],
    bring: (res.body.bring as GuestBring | null | undefined) ?? null,
    now: (res.body.now as string | undefined) ?? new Date().toISOString(),
  };
}

export async function saveGuestPage(
  slug: string,
  guestToken: string,
  pageId: string,
  elements: BoardElement[],
  baseRev: number,
): Promise<SaveResult> {
  const res = await guestFetch(
    `/share/${encodeURIComponent(slug)}/pages/${encodeURIComponent(pageId)}`,
    { method: 'POST', body: { elements, base_rev: baseRev }, guestToken },
  );
  if (res.status === 409 && res.body.code === 'REV_CONFLICT') {
    return {
      conflict: {
        rev: (res.body.rev as number) ?? 0,
        elements: res.body.elements ?? [],
      },
    };
  }
  if (res.status !== 200) throwGuestError(res, 'Не удалось сохранить лист.');
  return { rev: (res.body.rev as number) ?? 0 };
}
