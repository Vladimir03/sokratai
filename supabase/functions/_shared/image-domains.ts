// Single source of truth for storage buckets that may be referenced by AI image
// resolution paths (chat / homework-api / vision_checker). Adding a new bucket
// to any write-path that lands in `homework_tutor_tasks.task_image_url`,
// `solution_image_urls`, or `rubric_image_urls` MUST also add it here, otherwise
// the AI sees a placeholder text and hallucinates ("[Задача на фото]" → guessed
// thermodynamics problem instead of the real electrostatics image).
//
// See `.claude/rules/40-homework-system.md` § "AI image bucket whitelist invariant".

export const HOMEWORK_AI_BUCKETS = [
  "chat-images",
  "homework-task-images",
  "homework-submissions",
  "homework-images",
  "homework-materials",
  "kb-attachments",
] as const;

export type HomeworkAiBucket = typeof HOMEWORK_AI_BUCKETS[number];

/**
 * Build the list of allowed signed-URL prefixes for the given Supabase project.
 * Used by `chat/index.ts::isValidImageUrl` to whitelist signed URLs against SSRF.
 */
export function buildAllowedSignedUrlPrefixes(supabaseUrl: string): string[] {
  const trimmed = supabaseUrl.replace(/\/+$/, "");
  return HOMEWORK_AI_BUCKETS.map(
    (bucket) => `${trimmed}/storage/v1/object/sign/${bucket}/`,
  );
}

/** True if `url` starts with any of the whitelisted signed-URL prefixes. */
export function isAllowedSignedUrl(url: string, supabaseUrl: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  const prefixes = buildAllowedSignedUrlPrefixes(supabaseUrl);
  return prefixes.some((prefix) => url.startsWith(prefix));
}
