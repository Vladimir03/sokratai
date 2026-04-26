import type { HomeworkPreviewTask } from '@/components/tutor/homework-reuse/HomeworkPreviewContent';

// Resolves to api.sokratai.ru proxy in prod (bypasses RU ISP blocks on *.supabase.co).
// Source of truth — VITE_SUPABASE_URL env var; fallback for Lovable preview.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://api.sokratai.ru';
const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;
const SHARE_LINK_SLUG_RE = /^[a-z0-9]{8}$/i;

export type PublicShareResult =
  | { status: 'invalid_slug' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      title: string;
      tasks: HomeworkPreviewTask[];
      show_answers: boolean;
      show_solutions: boolean;
      expires_at: string | null;
    };

export async function fetchPublicHomeworkShare(slug: string): Promise<PublicShareResult> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!SHARE_LINK_SLUG_RE.test(normalizedSlug)) {
    return { status: 'invalid_slug' };
  }

  const response = await fetch(
    `${FUNCTIONS_BASE_URL}/public-homework-share/share/${encodeURIComponent(normalizedSlug)}`,
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (response.status === 400) return { status: 'invalid_slug' };
  if (response.status === 404) return { status: 'not_found' };
  if (payload?.expired === true) return { status: 'expired' };

  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Не удалось загрузить публичную ссылку';
    return { status: 'error', message };
  }

  return {
    status: 'ok',
    title: String(payload?.title ?? 'Домашнее задание'),
    tasks: Array.isArray(payload?.tasks) ? (payload.tasks as HomeworkPreviewTask[]) : [],
    show_answers: payload?.show_answers === true,
    show_solutions: payload?.show_solutions === true,
    expires_at: typeof payload?.expires_at === 'string' ? payload.expires_at : null,
  };
}
