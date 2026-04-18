/**
 * Local-time YYYY-MM-DD key for streak/daily-goal bookkeeping.
 *
 * Runs in the user's device timezone (matches what a student "feels" as "today").
 * R-5 in prd.md explicitly accepts timezone cheating as out-of-scope for Phase 1.
 */
export function todayLocalKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calendar days between two YYYY-MM-DD keys: daysBetween(a, b) = b - a.
 *
 * Normalised through Date.UTC to avoid DST drift — we only care about
 * whole-day deltas, never hours.
 *
 * Returns NaN if either argument fails to parse.
 */
export function daysBetween(a: string, b: string): number {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (!pa || !pb) return Number.NaN;
  const utcA = Date.UTC(pa.y, pa.m - 1, pa.d);
  const utcB = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((utcB - utcA) / 86_400_000);
}

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { y, m, d };
}
