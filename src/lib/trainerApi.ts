export type SubmitTrainerRoundPayload = {
  session_id: string;
  score: number;
  total: number;
  weak_formulas: string[];
  duration_ms: number;
  client_started_at: string;
};

export type SubmitTrainerRoundResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'invalid' | 'network' };

export async function submitTrainerRound(
  payload: SubmitTrainerRoundPayload,
): Promise<SubmitTrainerRoundResult> {
  // HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
  const supabaseUrl = 'https://api.sokratai.ru';

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/functions/v1/trainer-submit`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (response.status === 429) {
      return { ok: false, reason: 'rate_limited' };
    }

    if (response.status === 400) {
      return { ok: false, reason: 'invalid' };
    }

    if (!response.ok) {
      return { ok: false, reason: 'network' };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!data?.id) {
      return { ok: false, reason: 'network' };
    }

    return { ok: true, id: data.id };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
