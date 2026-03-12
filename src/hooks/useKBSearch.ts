import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { ExamType } from '@/types/kb';

// =============================================
// Types
// =============================================

export interface KBSearchResult {
  result_type: 'topic' | 'task' | 'material';
  result_id: string;
  parent_topic_id: string | null;
  title: string;
  snippet: string | null;
  exam: ExamType | null;
  source: string;
  relevance: number;
}

export interface KBSearchGrouped {
  topics: KBSearchResult[];
  tasks: KBSearchResult[];
  materials: KBSearchResult[];
}

// =============================================
// Fetcher — auth.uid() is resolved server-side
// =============================================

async function fetchKBSearch(
  query: string,
  examFilter: ExamType,
): Promise<KBSearchResult[]> {
  const { data, error } = await (supabase.rpc as any)('kb_search', {
    query,
    exam_filter: examFilter,
    source_filter: null,
    result_limit: 20,
  });
  if (error) throw error;
  return (data ?? []) as KBSearchResult[];
}

// =============================================
// Hook
// =============================================

/**
 * KB search with 300ms debounce.
 * Calls supabase.rpc('kb_search') and groups results by type.
 * Identity is resolved server-side via auth.uid().
 */
export function useKBSearch(query: string, examFilter: ExamType) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the query by 300ms
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDebouncedQuery('');
      return;
    }

    timerRef.current = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const enabled = debouncedQuery.length >= 2;

  const queryKey = useMemo(
    () => ['tutor', 'kb', 'search', debouncedQuery, examFilter] as const,
    [debouncedQuery, examFilter],
  );

  const { data: results, isLoading } = useQuery<KBSearchResult[]>({
    queryKey,
    queryFn: () => fetchKBSearch(debouncedQuery, examFilter),
    enabled,
    staleTime: 30_000,
    gcTime: 60_000,
  });

  const grouped = useMemo<KBSearchGrouped>(() => {
    const items = results ?? [];
    return {
      topics: items.filter((r) => r.result_type === 'topic'),
      tasks: items.filter((r) => r.result_type === 'task'),
      materials: items.filter((r) => r.result_type === 'material'),
    };
  }, [results]);

  return {
    ...grouped,
    isLoading: enabled && isLoading,
    hasResults: enabled && (results?.length ?? 0) > 0,
    isActive: enabled,
  };
}
