import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

/**
 * Фаза 2 (2026-07-20): чтения вариантов пробников — клиентский PostgREST под
 * RLS «каталог ∪ мои» (миграция 20260720170000). Записи — ТОЛЬКО через edge
 * (`mockExamApi`: createMockExamVariant и др.).
 *
 * Паттерн задан MockExamVariantPreviewSheet (прямой select под RLS).
 * `owner_id`/`subject` — новые колонки; generated types.ts отстаёт до
 * регенерации Lovable → row-каст (конвенция escape-hatch, tutorCalendarEvents).
 */

export interface MockExamVariantSummary {
  id: string;
  title: string;
  exam_type: string;
  /** NULL у легаси-строк → читатели берут 'physics'. */
  subject: string | null;
  source_attribution: string | null;
  duration_minutes: number;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
  task_count: number;
  /** NULL = каталожный; non-NULL = мой личный (RLS чужие не отдаёт). */
  owner_id: string | null;
}

export interface MockExamVariantTaskRow {
  id: string;
  kim_number: number;
  part: 1 | 2;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  check_mode: string | null;
  max_score: number;
  solution_text: string | null;
  solution_image_urls: string | null;
  topic: string | null;
}

export interface MockExamVariantDetail {
  variant: MockExamVariantSummary;
  tasks: MockExamVariantTaskRow[];
  /** true = вариант уже назначен → контент заморожен (edge вернёт 409). */
  inUse: boolean;
}

const VARIANT_SUMMARY_SELECT =
  'id, title, exam_type, subject, source_attribution, duration_minutes, total_max_score, part1_max, part2_max, task_count, owner_id';

export const MOCK_EXAM_VARIANTS_KEY = ['tutor', 'mock-exams', 'variants'] as const;

export function useMockExamVariants() {
  const query = useQuery<MockExamVariantSummary[]>({
    queryKey: MOCK_EXAM_VARIANTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mock_exam_variants')
        .select(VARIANT_SUMMARY_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MockExamVariantSummary[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return {
    variants: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useMockExamVariantDetail(variantId: string | null) {
  const query = useQuery<MockExamVariantDetail>({
    queryKey: ['tutor', 'mock-exams', 'variant', variantId],
    enabled: Boolean(variantId),
    queryFn: async () => {
      // Батч — проверяем .error КАЖДОГО запроса (правило rule 100: не отдавать
      // «пустой» результат при частичном сбое — кэш затёрся бы деградацией).
      const [variantQ, tasksQ, assignmentsQ] = await Promise.all([
        supabase
          .from('mock_exam_variants')
          .select(VARIANT_SUMMARY_SELECT)
          .eq('id', variantId!)
          .maybeSingle(),
        supabase
          .from('mock_exam_variant_tasks')
          .select('id, kim_number, part, order_num, task_text, task_image_url, correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic')
          .eq('variant_id', variantId!)
          .order('order_num', { ascending: true }),
        supabase
          .from('mock_exam_assignments')
          .select('id')
          .eq('variant_id', variantId!)
          .limit(1),
      ]);
      if (variantQ.error) throw variantQ.error;
      if (!variantQ.data) throw new Error('Вариант не найден');
      if (tasksQ.error) throw tasksQ.error;
      if (assignmentsQ.error) throw assignmentsQ.error;
      return {
        variant: variantQ.data as unknown as MockExamVariantSummary,
        tasks: (tasksQ.data ?? []) as unknown as MockExamVariantTaskRow[],
        // RLS: чужих assignments на МОЙ личный вариант не бывает (вариант видит
        // только владелец) → мои назначения = все назначения этого варианта.
        inUse: (assignmentsQ.data ?? []).length > 0,
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  return {
    detail: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
  };
}
