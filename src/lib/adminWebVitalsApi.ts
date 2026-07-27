import { supabase } from '@/lib/supabaseClient';

/**
 * Admin-клиент вкладки /admin → «Скорость»: полевые Core Web Vitals.
 *
 * Backed by SECURITY DEFINER RPC `admin_web_vitals_p75` / `admin_web_vitals_trend`
 * (миграция 20260726120000, гейт `public.is_admin`). Имена RPC кастятся
 * `as never` на границе `supabase.rpc` — mirror adminClientErrorsApi
 * (generated types.ts новых функций не несёт, это осознанный escape-hatch).
 *
 * Отдаются АГРЕГАТЫ, не строки: /admin нужен p75, а не выгрузка замеров.
 */

/** p75 — канонический перцентиль Core Web Vitals (web.dev), считаем именно его. */
export interface WebVitalsP75Row {
  metric: 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP';
  device: 'mobile' | 'desktop';
  role: 'tutor' | 'student' | 'anon';
  route: string;
  p75: number;
  p50: number;
  samples: number;
  /** Доля замеров в пороге «good», %. Второй взгляд: p75 может быть в норме при длинном хвосте. */
  good_share: number | null;
}

/**
 * Общий p75 по метрике×устройству. ОТДЕЛЬНЫЙ запрос, а не свёртка `WebVitalsP75Row`
 * на клиенте: перцентили нельзя усреднять по маршрутам — среднее из p75 не
 * является ничьим перцентилем. Считает БД, из сырых значений.
 */
export interface WebVitalsSummaryRow {
  metric: WebVitalsP75Row['metric'];
  device: 'mobile' | 'desktop';
  p75: number;
  p50: number;
  samples: number;
  good_share: number | null;
}

export interface WebVitalsTrendRow {
  /** Московские сутки (rule 101) — бакеты считает БД, клиент не пересчитывает. */
  day: string;
  device: 'mobile' | 'desktop';
  p75: number;
  samples: number;
}

function wrapError(error: { message?: string }, what: string): Error {
  return new Error(
    error.message?.includes('NOT_ADMIN')
      ? 'Нет прав администратора.'
      : `Не удалось загрузить ${what}: ${error.message}`,
  );
}

export async function listWebVitalsP75(days = 7, route?: string): Promise<WebVitalsP75Row[]> {
  const { data, error } = await supabase.rpc(
    'admin_web_vitals_p75' as never,
    { p_days: days, p_route: route ?? null } as never,
  );
  if (error) throw wrapError(error, 'метрики скорости');
  return (data ?? []) as WebVitalsP75Row[];
}

export async function listWebVitalsSummary(days = 7): Promise<WebVitalsSummaryRow[]> {
  const { data, error } = await supabase.rpc(
    'admin_web_vitals_summary' as never,
    { p_days: days } as never,
  );
  if (error) throw wrapError(error, 'сводку скорости');
  return (data ?? []) as WebVitalsSummaryRow[];
}

export async function listWebVitalsTrend(
  metric: WebVitalsP75Row['metric'],
  days = 14,
): Promise<WebVitalsTrendRow[]> {
  const { data, error } = await supabase.rpc(
    'admin_web_vitals_trend' as never,
    { p_metric: metric, p_days: days } as never,
  );
  if (error) throw wrapError(error, 'тренд скорости');
  return (data ?? []) as WebVitalsTrendRow[];
}

/**
 * Пороги Core Web Vitals (web.dev). INP заменил FID в 2024-м.
 * Значения — «good» ≤ первое, «poor» > второе; между ними needs-improvement.
 * TTFB и FCP официально диагностические, не Core — но именно они показывают
 * стоимость кросс-граничного хопа до api.sokratai.ru, поэтому мы их считаем.
 */
export const VITALS_THRESHOLDS: Record<
  WebVitalsP75Row['metric'],
  { good: number; poor: number; unit: 'ms' | 'score' }
> = {
  LCP: { good: 2500, poor: 4000, unit: 'ms' },
  INP: { good: 200, poor: 500, unit: 'ms' },
  CLS: { good: 0.1, poor: 0.25, unit: 'score' },
  TTFB: { good: 800, poor: 1800, unit: 'ms' },
  FCP: { good: 1800, poor: 3000, unit: 'ms' },
};

/**
 * Целевые пороги ПРОДУКТА (спека «работоспособный прод»): у ученика на старом
 * iPhone и мобильном интернете бюджет иной, чем у репетитора за десктопом.
 * Один общий числовой таргет врал бы обоим.
 */
export const PRODUCT_TARGETS: Record<
  WebVitalsP75Row['metric'],
  { mobile: number; desktop: number }
> = {
  LCP: { mobile: 2500, desktop: 2000 },
  INP: { mobile: 200, desktop: 200 },
  CLS: { mobile: 0.1, desktop: 0.1 },
  TTFB: { mobile: 1200, desktop: 800 },
  FCP: { mobile: 1800, desktop: 1500 },
};

export function formatVital(metric: WebVitalsP75Row['metric'], value: number): string {
  if (VITALS_THRESHOLDS[metric].unit === 'score') return value.toFixed(3);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} с` : `${Math.round(value)} мс`;
}

export function rateVital(
  metric: WebVitalsP75Row['metric'],
  value: number,
): 'good' | 'needs-improvement' | 'poor' {
  const t = VITALS_THRESHOLDS[metric];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}
