import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertTriangle,
  Database,
  MessageSquareWarning,
  MonitorX,
  PackageX,
  RefreshCw,
  Upload,
  WifiOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { listAdminClientErrors, type AdminClientErrorRow } from '@/lib/adminClientErrorsApi';

/**
 * /admin → «Ошибки»: краши клиента из analytics_events('client_error').
 * Группировка по (source, route, message): счётчик, последнее время, пример
 * браузера.
 *
 * Источники (см. src/lib/clientErrorReport.ts::ClientErrorKind): 'screen' /
 * 'markdown_bubble' (React-бандари), 'chunk' (сбой lazy-чанка), 'window' /
 * 'promise' (глобальные uncaught), 'query' / 'mutation' (React Query),
 * 'net' (сетевой класс, лимитирован на клиенте).
 */

/** Подпись + иконка по источнику. Неизвестный source → нейтральный дефолт. */
const SOURCE_META: Record<string, { label: string; Icon: typeof MonitorX; tone: string }> = {
  screen: { label: 'Белый экран', Icon: MonitorX, tone: 'text-red-500' },
  markdown_bubble: { label: 'Пузырь (fallback)', Icon: MessageSquareWarning, tone: 'text-amber-500' },
  chunk: { label: 'Чанк не загрузился', Icon: PackageX, tone: 'text-orange-500' },
  window: { label: 'Uncaught (window)', Icon: AlertTriangle, tone: 'text-red-500' },
  promise: { label: 'Uncaught (promise)', Icon: AlertTriangle, tone: 'text-red-400' },
  query: { label: 'Запрос не удался', Icon: Database, tone: 'text-amber-600' },
  mutation: { label: 'Мутация не удалась', Icon: Upload, tone: 'text-amber-600' },
  net: { label: 'Сеть (DPI/обрыв)', Icon: WifiOff, tone: 'text-slate-500' },
};

function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source || 'Ошибка', Icon: MonitorX, tone: 'text-red-500' };
}

interface ErrorGroup {
  key: string;
  message: string;
  route: string;
  source: string;
  count: number;
  lastAt: string;
  uaSample: string;
}

function groupErrors(rows: AdminClientErrorRow[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const row of rows) {
    const message = row.meta?.message ?? '(без текста)';
    const route = row.meta?.route ?? '?';
    const key = `${row.source ?? 'screen'}|${route}|${message}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      // rows приходят occurred_at DESC — первый увиденный = самый свежий.
    } else {
      groups.set(key, {
        key,
        message,
        route,
        source: row.source ?? 'screen',
        count: 1,
        lastAt: row.occurred_at,
        uaSample: row.meta?.ua ?? '',
      });
    }
  }
  return [...groups.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

function shortUa(ua: string): string {
  if (!ua) return '';
  if (/iPhone|iPad/.test(ua)) {
    const os = ua.match(/OS (\d+[._]\d+)/)?.[1]?.replace('_', '.');
    const inApp = !/Safari\//.test(ua) ? ' · in-app браузер' : '';
    return `iOS ${os ?? '?'}${inApp}`;
  }
  if (/Android/.test(ua)) {
    const wv = /; wv\)/.test(ua) ? ' · webview' : '';
    return `Android${wv}`;
  }
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'macOS';
  return ua.slice(0, 40);
}

export function AdminClientErrors() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'client-errors'],
    queryFn: () => listAdminClientErrors(300),
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const groups = useMemo(() => groupErrors(data ?? []), [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="w-5 h-5 text-amber-500" aria-hidden="true" />
          Ошибки клиента (последние 300 событий)
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Обновить
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{(error as Error).message}</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Крашей не зафиксировано. Сюда попадают белые экраны, сбои загрузки
            чанков, глобальные uncaught-ошибки и упавшие запросы/мутации
            с prod/preview.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const { label, Icon, tone } = sourceMeta(g.source);
              return (
              <div key={g.key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${tone}`} aria-hidden="true" />
                    <span className="text-xs font-medium text-slate-500">
                      {label}
                      {' · '}
                      <span className="font-mono">{g.route}</span>
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums">
                    ×{g.count}
                  </span>
                </div>
                <p className="mt-1.5 text-sm break-words">{g.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Последний раз: {format(parseISO(g.lastAt), 'd MMMM HH:mm', { locale: ru })}
                  {g.uaSample ? ` · ${shortUa(g.uaSample)}` : ''}
                </p>
              </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
