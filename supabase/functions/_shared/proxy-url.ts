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

const SUPABASE_DIRECT_HOST = "vrsseotrfmsxpbciyqzc.supabase.co";

/**
 * Hostname of our Selectel VPS reverse proxy. Single source of truth — import
 * `SUPABASE_PROXY_URL` (full URL) where needed by validators / SSRF whitelists.
 */
export const SUPABASE_PROXY_HOST = "api.sokratai.ru";

/**
 * Full URL form of the proxy host (with `https://` scheme, no trailing slash).
 * Use as a prefix in signed-URL whitelists, e.g.
 *   `${SUPABASE_PROXY_URL}/storage/v1/object/sign/<bucket>/<path>`.
 */
export const SUPABASE_PROXY_URL = `https://${SUPABASE_PROXY_HOST}`;

const DIRECT_PREFIX = `https://${SUPABASE_DIRECT_HOST}/`;
const PROXY_PREFIX = `${SUPABASE_PROXY_URL}/`;

/**
 * Rewrites the host of a Supabase URL from the direct project domain to our
 * proxy domain. Safe to call on any string — non-Supabase URLs and empty
 * strings pass through unchanged.
 *
 * Hostname-aware: matches only when the direct host is the URL host (URL
 * starts with `https://<direct-host>/`), NOT when it appears as a substring
 * inside a query param or fragment (e.g. `?ref=https://...supabase.co/...`).
 *
 * Use ONLY for URLs that will be exposed to browser clients (RU users hit
 * the URL directly with `<img src>` or fetch). For server-to-server calls
 * (e.g., edge function → Supabase Storage download), the direct URL is
 * faster — call `rewriteToDirect` instead, no proxy round-trip needed.
 */
export function rewriteToProxy<T>(value: T): T {
  if (!value || typeof value !== "string") return value;
  if (!value.startsWith(DIRECT_PREFIX)) return value;
  return (PROXY_PREFIX + value.slice(DIRECT_PREFIX.length)) as T;
}

/**
 * Reverse of rewriteToProxy: converts api.sokratai.ru host back to the direct
 * Supabase project domain. Use BEFORE server-side fetch() inside edge functions
 * to avoid the unnecessary US -> RU -> US roundtrip.
 *
 * Edge functions run inside Supabase USA. Going through our Selectel proxy in
 * Moscow adds 200-400ms latency without security benefit (server-to-server
 * fetches don't hit RU ISP blocks).
 *
 * Both hosts produce valid signed URLs because the JWT token is bound to the
 * project signing key, not to the hostname.
 *
 * Hostname-aware (mirror of rewriteToProxy): matches only when the proxy host
 * is the URL host, NOT when it appears as a substring elsewhere in the string.
 */
export function rewriteToDirect<T extends string | null | undefined>(value: T): T {
  if (!value || typeof value !== "string") return value;
  if (!value.startsWith(PROXY_PREFIX)) return value;
  return (DIRECT_PREFIX + value.slice(PROXY_PREFIX.length)) as T;
}
