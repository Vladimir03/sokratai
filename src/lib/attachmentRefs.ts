/**
 * Shared attachment-ref helpers for KB and homework multi-photo flows.
 *
 * Spec reference:
 * docs/delivery/features/homework-multi-photo/spec.md
 */

/** Max images allowed per homework task / KB task import (UI-enforced limit). */
export const MAX_TASK_IMAGES = 5;

/** Max images allowed per homework rubric. */
export const MAX_RUBRIC_IMAGES = 3;

/**
 * Parse `attachment_url`-style fields which may be:
 *  - null / undefined / "" → []
 *  - single storage ref string → [ref]
 *  - JSON array of refs → string[]
 */
export function parseAttachmentUrls(
  value: string | null | undefined,
): string[] {
  if (!value || typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0,
        );
      }
    } catch {
      // malformed JSON — fall through to single-value
    }
  }

  return [trimmed];
}

/**
 * Serialize an array of storage refs back to the `attachment_url` field.
 *  - [] → null
 *  - [ref] → ref (single string, backward-compatible)
 *  - [ref1, ref2, ...] → JSON array string
 */
export function serializeAttachmentUrls(refs: string[]): string | null {
  if (refs.length === 0) return null;
  if (refs.length === 1) return refs[0];
  return JSON.stringify(refs);
}
