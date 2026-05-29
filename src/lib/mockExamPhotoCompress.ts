/**
 * Thin re-export of the generic image compression helper. Kept as a separate
 * module to preserve existing import paths in `mock-exam` code (introduced in
 * Phase 6, 2026-05-15, see .claude/rules/45-mock-exams.md). The actual logic lives in
 * `src/lib/imageCompression.ts` and is shared with tutor paste handlers.
 *
 * Mock-exam-specific defaults (4 MB / 2048px long side) are also the generic
 * defaults — no override needed.
 */

export type { CompressOptions } from './imageCompression';
export { compressForUpload as compressMockExamPhoto } from './imageCompression';
