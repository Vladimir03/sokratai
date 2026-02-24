import { supabase } from '@/lib/supabaseClient';
import type {
  GroupParticipantPaymentStatus,
  UpdateGroupParticipantPaymentResult,
} from '@/types/tutor';

type RawGroupParticipantPaymentResult = {
  ok?: boolean;
  status?: string | null;
  amount?: number | null;
  paid_at?: string | null;
  error_code?: string | null;
};

function normalizeStatus(value: string | null | undefined): GroupParticipantPaymentStatus | null {
  if (value === 'pending' || value === 'paid') {
    return value;
  }
  return null;
}

export async function updateGroupParticipantPaymentStatus(
  lessonId: string,
  tutorStudentId: string,
  paymentStatus: GroupParticipantPaymentStatus,
): Promise<UpdateGroupParticipantPaymentResult> {
  const { data, error } = await supabase.rpc('update_group_participant_payment_status', {
    _lesson_id: lessonId,
    _tutor_student_id: tutorStudentId,
    _payment_status: paymentStatus,
  });

  if (error) {
    console.error('Error updating group participant payment status:', error);
    return {
      ok: false,
      status: null,
      amount: null,
      paid_at: null,
      error_code: 'RPC_ERROR',
    };
  }

  const raw = (data ?? {}) as RawGroupParticipantPaymentResult;
  return {
    ok: Boolean(raw.ok),
    status: normalizeStatus(raw.status),
    amount: raw.amount ?? null,
    paid_at: raw.paid_at ?? null,
    error_code: raw.error_code ?? null,
  };
}
