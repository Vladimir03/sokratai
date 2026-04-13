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

type FunctionsErrorContext = {
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function readErrorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if ('error' in payload && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if ('message' in payload && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  return null;
}

export async function getFunctionsErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: FunctionsErrorContext }).context;

    if (context?.json) {
      try {
        const payload = await context.json();
        const payloadMessage = readErrorMessageFromPayload(payload);
        if (payloadMessage) {
          return payloadMessage;
        }
      } catch {
        // Fall through to other parsers.
      }
    }

    if (context?.text) {
      try {
        const text = await context.text();
        if (text.trim()) {
          return text;
        }
      } catch {
        // Fall through to generic error parsing.
      }
    }
  }

  return getAuthErrorMessage(error, fallback);
}
