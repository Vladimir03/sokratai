import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

// Fallback values for Lovable preview environment where env vars may be undefined
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 
  'https://vrsseotrfmsxpbciyqzc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  }
});

/**
 * Extract user-friendly error message from auth errors.
 * Converts raw "Failed to fetch" into actionable Russian message
 * and logs diagnostic info for debugging.
 */
export function getAuthErrorMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error ?? '');

  if (message.toLowerCase().includes('fetch')) {
    console.error('[Auth] Network error:', {
      message,
      online: typeof navigator !== 'undefined' ? navigator.onLine : 'N/A',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
      supabaseUrl: SUPABASE_URL,
      origin: typeof window !== 'undefined' ? window.location.origin : 'N/A',
    });
    return 'Ошибка сети. Проверьте подключение к интернету и попробуйте снова.';
  }

  return message || fallback;
}
