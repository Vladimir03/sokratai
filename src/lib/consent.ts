import { supabase } from "@/lib/supabaseClient";

export const CONSENT_VERSION = "v1-2026-05";

export type ConsentSource =
  | "web-signup-tutor"
  | "web-signup-student"
  | "google-oauth-tutor"
  | "google-oauth-student"
  | "telegram-oauth-tutor"
  | "telegram-oauth-student";

const PENDING_KEY = "pending_consent_v1";

type PendingConsent = {
  source: ConsentSource;
  ts: number;
};

/**
 * Stash consent intent before an OAuth redirect (Google, Telegram).
 * Read+applied after the SIGNED_IN event on return.
 */
export function stashPendingConsent(source: ConsentSource): void {
  try {
    const payload: PendingConsent = { source, ts: Date.now() };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // ignore — sessionStorage may be unavailable in some embeds
  }
}

function readPendingConsent(): PendingConsent | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingConsent;
    // Expire after 30 minutes — OAuth round-trip is usually <2 min.
    if (Date.now() - parsed.ts > 30 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingConsent(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

/**
 * Write consent timestamp + version + source to profiles.
 * RLS policy "Users can update their own profile" allows this.
 * Idempotent: skips update if consent_accepted_at already set.
 */
export async function recordConsent(
  userId: string,
  source: ConsentSource,
): Promise<boolean> {
  try {
    const { data: existing, error: readErr } = await supabase
      .from("profiles")
      .select("consent_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    if (readErr) {
      console.warn("[consent] read failed", readErr);
    }
    if (existing?.consent_accepted_at) return true;

    const { error } = await supabase
      .from("profiles")
      .update({
        consent_accepted_at: new Date().toISOString(),
        consent_version: CONSENT_VERSION,
        consent_source: source,
      })
      .eq("id", userId);
    if (error) {
      console.warn("[consent] update failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[consent] threw", e);
    return false;
  }
}

/**
 * Apply pending consent stashed before OAuth redirect, if any.
 * Call from onAuthStateChange("SIGNED_IN") handler on signup pages.
 */
export async function applyPendingConsent(userId: string): Promise<void> {
  const pending = readPendingConsent();
  if (!pending) return;
  const ok = await recordConsent(userId, pending.source);
  if (ok) clearPendingConsent();
}