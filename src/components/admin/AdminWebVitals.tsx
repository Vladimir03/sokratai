import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  formatVital,
  listWebVitalsP75,
  listWebVitalsSummary,
  rateVital,
  PRODUCT_TARGETS,
  type WebVitalsP75Row,
  type WebVitalsSummaryRow,
} from '@/lib/adminWebVitalsApi';

/**
 * /admin → «Скорость»: полевые Core Web Vitals с реальных устройств.
 *
 * Не лаборатория: наше узкое место — РФ-DPI и кросс-граничный хоп до
 * api.sokratai.ru, чего Lighthouse не воспроизводит. Значения — p75
 * (канонический перцентиль web.dev), раздельно mobile/desktop, потому что
 * бюджет ученика на старом iPhone и репетитора за десктопом — разные бюджеты.
 *
 * Сводка приходит ОТДЕЛЬНОЙ RPC: усреднять p75 по маршрутам нельзя, общий
 * перцентиль считается из сырых значений в БД.
 */

const METRIC_ORDER: WebVitalsP75Row['metric'][] = ['LCP', 'INP', 'CLS', 'TTFB', 'FCP'];

const METRIC_HINT: Record<WebVitalsP75Row['metric'], string> = {
  LCP: 'Largest Contentful Paint — когда появился главный контент. Ученик видит задачу.',
  INP: 'Interaction to Next Paint — отклик на действие. Заменил FID в 2024-м.',
  CLS: 'Cumulative Layout Shift — насколько прыгает вёрстка при загрузке.',
  TTFB: 'Time to First Byte — ответ сервера. Здесь виден кросс-граничный хоп и DPI.',
  FCP: 'First Contentful Paint — первый отрисованный пиксель контента.',
};

const RANGES = [
  { days: 7, label: '7 дней' },
  { days: 14, label: '14 дней' },
  { days: 30, label: '30 дней' },
];

/** Цвет по порогу web.dev, а не по продуктовой цели: это внешняя объективная шкала. */
const RATING_TONE: Record<string, string> = {
  good: 'text-emerald-600',
  'needs-improvement': 'text-amber-600',
  poor: 'text-rose-600',
};

function DeviceIcon({ device }: { device: 'mobile' | 'desktop' }) {
  const Icon = device === 'mobile' ? Smartphone : Monitor;
  return <Icon className="w-3.5 h-3.5" aria-hidden="true" />;
}

function MetricCard({ metric, rows }: { metric: WebVitalsP75Row['metric']; rows: WebVitalsSummaryRow[] }) {
  const mobile = rows.find((r) => r.device === 'mobile');
  const desktop = rows.find((r) => r.device === 'desktop');

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{metric}</span>
        <span className="text-xs text-slate-400 tabular-nums">
          {(mobile?.samples ?? 0) + (desktop?.samples ?? 0)} замеров
        </span>
      </div>
      <p className="mt-1 text-xs leading-snug text-slate-500">{METRIC_HINT[metric]}</p>

      <div className="mt-3 space-y-1.5">
        {(['mobile', 'desktop'] as const).map((device) => {
          const row = device === 'mobile' ? mobile : desktop;
          const target = PRODUCT_TARGETS[metric][device];
          return (
            <div key={device} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-slate-500">
                <DeviceIcon device={device} />
                {device === 'mobile' ? 'моб.' : 'десктоп'}
              </span>
              {row ? (
                <span className="flex items-baseline gap-2">
                  <span className={`font-semibold tabular-nums ${RATING_TONE[rateVital(metric, row.p75)]}`}>
                    {formatVital(metric, row.p75)}
                  </span>
                  <span
                    className="text-xs text-slate-400 tabular-nums"
                    title={`Продуктовая цель для этого сегмента: ${formatVital(metric, target)}`}
                  >
                    цель {formatVital(metric, target)}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-slate-400">нет данных</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RouteRow {
  route: string;
  device: 'mobile' | 'desktop';
  samples: number;
  values: Partial<Record<WebVitalsP75Row['metric'], number>>;
}

/**
 * Сводим плоские строки RPC в таблицу «маршрут × метрика». Роль намеренно
 * схлопывается: она выводится из маршрута, поэтому в разрезе по маршруту
 * не несёт новой информации и только дробила бы и без того небольшую выборку.
 */
function buildRouteRows(rows: WebVitalsP75Row[]): RouteRow[] {
  const map = new Map<string, RouteRow>();
  for (const r of rows) {
    const key = `${r.route}|${r.device}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { route: r.route, device: r.device, samples: 0, values: {} };
      map.set(key, entry);
    }
    entry.values[r.metric] = r.p75;
    // Замеры одной метрики = число pageview'ов; берём максимум, а не сумму,
    // иначе «замеров» было бы впятеро больше реальных загрузок.
    entry.samples = Math.max(entry.samples, r.samples);
  }

  // Худшее сверху: сортируем по LCP — это метрика «когда ученик увидел задачу».
  return Array.from(map.values()).sort((a, b) => (b.values.LCP ?? 0) - (a.values.LCP ?? 0));
}

export function AdminWebVitals() {
  const [days, setDays] = useState(7);

  const summary = useQuery({
    queryKey: ['admin', 'web-vitals', 'summary', days],
    queryFn: () => listWebVitalsSummary(days),
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const byRoute = useQuery({
    queryKey: ['admin', 'web-vitals', 'routes', days],
    queryFn: () => listWebVitalsP75(days),
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const routeRows = useMemo(() => buildRouteRows(byRoute.data ?? []), [byRoute.data]);
  const summaryRows = summary.data ?? [];
  const isLoading = summary.isLoading || byRoute.isLoading;
  const error = (summary.error ?? byRoute.error) as Error | null;
  const isFetching = summary.isFetching || byRoute.isFetching;
  const hasData = summaryRows.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Gauge className="w-5 h-5 text-accent" aria-hidden="true" />
          Скорость (полевые замеры, p75)
        </CardTitle>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <Button
              key={r.days}
              variant={days === r.days ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void summary.refetch();
              void byRoute.refetch();
            }}
            disabled={isFetching}
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="sr-only">Обновить</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error.message}</p>
        ) : !hasData ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Замеров пока нет.</p>
            <p>
              Данные начнут поступать после деплоя фронта: браузер копит метрики
              страницы и отправляет их одним запросом, когда вкладка уходит в фон.
              Первые точки появятся в течение часа после того, как пользователи
              откроют обновлённую версию.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {METRIC_ORDER.map((metric) => (
                <MetricCard
                  key={metric}
                  metric={metric}
                  rows={summaryRows.filter((r) => r.metric === metric)}
                />
              ))}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                По маршрутам (худшее сверху, сортировка по LCP)
              </h3>
              <div className="overflow-x-auto touch-pan-x">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="sticky left-0 z-10 bg-white pb-2 pr-3 font-medium">Маршрут</th>
                      <th className="pb-2 pr-3 font-medium">Устр.</th>
                      {METRIC_ORDER.map((m) => (
                        <th key={m} className="pb-2 pr-3 text-right font-medium">
                          {m}
                        </th>
                      ))}
                      <th className="pb-2 text-right font-medium">Замеров</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeRows.map((row) => (
                      <tr key={`${row.route}|${row.device}`} className="border-t border-slate-100">
                        <td className="sticky left-0 z-10 bg-white py-2 pr-3 font-mono text-xs text-slate-700">
                          {row.route}
                        </td>
                        <td className="py-2 pr-3 text-slate-500">
                          <DeviceIcon device={row.device} />
                        </td>
                        {METRIC_ORDER.map((m) => {
                          const value = row.values[m];
                          return (
                            <td key={m} className="py-2 pr-3 text-right tabular-nums">
                              {value === undefined ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                <span className={RATING_TONE[rateVital(m, value)]}>
                                  {formatVital(m, value)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 text-right tabular-nums text-slate-400">
                          {row.samples}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Пороги — web.dev (зелёный / янтарный / красный). «Цель» в карточках —
                продуктовая, своя для мобильного и десктопа. Маршруты санитизированы:
                динамические сегменты заменены на «:id», токены доступа — на маску.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
