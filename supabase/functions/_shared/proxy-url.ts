// Rewrite Supabase URLs to go through our Selectel VPS proxy at api.sokratai.ru.
//
// Why: edge functions run inside Supabase, so SDK-generated signed URLs (e.g.
// from `client.storage.from(...).createSignedUrl(...)`) bake in the direct
// project domain `vrsseotrfmsxpbciyqzc.supabase.co`. Russian ISPs block that
// domain on DNS/IP level. Browser tries to fetch the signed image URL → blocked.
//
// Fix: before returning any client-facing URL, rewrite the host to api.sokratai.ru.
// JWT signed URL token is bound to project signing key, NOT to hostname — so
// the same token works regardless of which hostname the browser hits.

const SUPABASE_DIRECT = "vrsseotrfmsxpbciyqzc.supabase.co";
const SUPABASE_PROXY = "api.sokratai.ru";

/**
 * Rewrites the host of a Supabase URL from the direct project domain to our
 * proxy domain. Safe to call on any string — non-Supabase URLs and empty
 * strings pass through unchanged.
 *
 * Use ONLY for URLs that will be exposed to browser clients (RU users hit
 * the URL directly with `<img src>` or fetch). For server-to-server calls
 * (e.g., edge function → Supabase Storage download), the direct URL is
 * faster — no rewrite needed.
 */
export function rewriteToProxy<T>(value: T): T {
  if (!value || typeof value !== "string") return value;
  if (!value.includes(SUPABASE_DIRECT)) return value;
  return value.replaceAll(SUPABASE_DIRECT, SUPABASE_PROXY) as T;
}
