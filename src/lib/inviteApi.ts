import { supabase } from '@/lib/supabaseClient';

const PENDING_INVITE_CODE_STORAGE_KEY = 'pending_invite_code';

export type ClaimInviteResult = {
  status: 'linked' | 'already_linked';
  tutor_name: string;
};

export type ClaimPendingInviteResult =
  | ClaimInviteResult
  | { status: 'no_pending' };

export async function claimInvite(inviteCode: string): Promise<ClaimInviteResult> {
  const normalizedInviteCode = inviteCode.trim();

  if (!normalizedInviteCode) {
    throw new Error('Invite code is required');
  }

  const { data, error } = await supabase.functions.invoke<ClaimInviteResult>('claim-invite', {
    body: { invite_code: normalizedInviteCode },
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Empty response from claim-invite');
  }

  return data;
}

export async function claimPendingInvite(): Promise<ClaimPendingInviteResult> {
  const inviteCode = localStorage.getItem(PENDING_INVITE_CODE_STORAGE_KEY);
  if (!inviteCode) {
    return { status: 'no_pending' };
  }

  try {
    const result = await claimInvite(inviteCode);
    localStorage.removeItem(PENDING_INVITE_CODE_STORAGE_KEY);
    return result;
  } catch (error) {
    console.error('Failed to claim invite:', error);
    throw error;
  }
}
