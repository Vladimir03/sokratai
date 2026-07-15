import { supabase } from '@/lib/supabaseClient';

/**
 * Admin-клиент вкладки /admin → «Ошибки»: последние client_error из
 * analytics_events (краши ErrorBoundary + деградации MarkdownErrorBoundary).
 *
 * Backed by SECURITY DEFINER RPC `admin_list_client_errors` (миграция
 * 20260715120000, gate public.is_admin). Имя RPC кастится `as never` на
 * границе supabase.rpc — mirror adminTutorPlansApi (generated types.ts
 * новых функций не несёт, это осознанный escape-hatch).
 */

export interface AdminClientErrorRow {
  id: string;
  occurred_at: string;
  /** 'screen' (белый экран ErrorBoundary) | 'markdown_bubble' (деградация пузыря). */
  source: string | null;
  actor_user_id: string | null;
  meta: { message?: string; route?: string; ua?: string } | null;
}

export async function listAdminClientErrors(limit = 300): Promise<AdminClientErrorRow[]> {
  const { data, error } = await supabase.rpc(
    'admin_list_client_errors' as never,
    { p_limit: limit } as never,
  );
  if (error) {
    throw new Error(
      error.message?.includes('NOT_ADMIN')
        ? 'Нет прав администратора.'
        : `Не удалось загрузить ошибки клиента: ${error.message}`,
    );
  }
  return (data ?? []) as AdminClientErrorRow[];
}
