import { supabase } from '@/lib/supabaseClient';

const PENDING_INVITE_CODE_STORAGE_KEY = 'pending_invite_code';
// Групповая ссылка (?g={join_code}, 2026-07-27): парный ключ читается ТОЛЬКО
// здесь — AuthGuard/Login/OAuth-кнопки зовут claimPendingInvite() как раньше
// и не знают про группу (минимальная инвазия в auth-флоу, rule 96).
const PENDING_INVITE_GROUP_CODE_STORAGE_KEY = 'pending_invite_group_code';

export type ClaimInviteGroupStatus =
  | 'joined'
  | 'moved'
  | 'already_member'
  | 'group_not_found'
  | 'group_attach_failed';

export type ClaimInviteResult = {
  status: 'linked' | 'already_linked';
  tutor_name: string;
  group_status?: ClaimInviteGroupStatus;
  group_name?: string;
};

export type ClaimPendingInviteResult =
  | ClaimInviteResult
  | { status: 'no_pending' };

export function persistPendingInvite(inviteCode: string, groupCode?: string | null): void {
  localStorage.setItem(PENDING_INVITE_CODE_STORAGE_KEY, inviteCode);
  if (groupCode) {
    localStorage.setItem(PENDING_INVITE_GROUP_CODE_STORAGE_KEY, groupCode);
  } else {
    localStorage.removeItem(PENDING_INVITE_GROUP_CODE_STORAGE_KEY);
  }
}

export function clearPendingInvite(): void {
  localStorage.removeItem(PENDING_INVITE_CODE_STORAGE_KEY);
  localStorage.removeItem(PENDING_INVITE_GROUP_CODE_STORAGE_KEY);
}

export async function claimInvite(
  inviteCode: string,
  groupCode?: string | null,
): Promise<ClaimInviteResult> {
  const normalizedInviteCode = inviteCode.trim();

  if (!normalizedInviteCode) {
    throw new Error('Invite code is required');
  }

  const normalizedGroupCode = groupCode?.trim() || undefined;

  const { data, error } = await supabase.functions.invoke<ClaimInviteResult>('claim-invite', {
    body: {
      invite_code: normalizedInviteCode,
      ...(normalizedGroupCode ? { group_code: normalizedGroupCode } : {}),
    },
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Empty response from claim-invite');
  }

  return data;
}

/**
 * Returns true if the error is terminal (invalid code, self-link, tutor
 * account, bad request) and retrying won't help — localStorage should be
 * cleaned.
 */
function isTerminalClaimError(error: unknown): boolean {
  // supabase.functions.invoke throws FunctionsHttpError with context.status
  if (error && typeof error === 'object' && 'context' in error) {
    const ctx = (error as { context?: { status?: number } }).context;
    if (ctx && typeof ctx.status === 'number') {
      // 400 = bad request / self-link, 404 = invalid invite code,
      // 403 = TUTOR_ACCOUNT (ревью 5.6 P1 #4: без очистки ключ жил вечно —
      // тьютор открыл свой инвайт, поймал 403, а позже вошедший на том же
      // браузере ученик молча забирал этот инвайт).
      return ctx.status === 400 || ctx.status === 403 || ctx.status === 404;
    }
  }
  return false;
}

export async function claimPendingInvite(): Promise<ClaimPendingInviteResult> {
  const inviteCode = localStorage.getItem(PENDING_INVITE_CODE_STORAGE_KEY);
  if (!inviteCode) {
    return { status: 'no_pending' };
  }
  const groupCode = localStorage.getItem(PENDING_INVITE_GROUP_CODE_STORAGE_KEY);

  try {
    const result = await claimInvite(inviteCode, groupCode);
    clearPendingInvite();
    return result;
  } catch (error) {
    console.error('Failed to claim invite:', error);
    // Terminal errors (invalid code, self-link) — clean up, retry is pointless
    if (isTerminalClaimError(error)) {
      clearPendingInvite();
    }
    // Retriable errors (5xx, network) — keep in localStorage for next login
    throw error;
  }
}
