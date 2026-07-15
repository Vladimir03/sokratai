import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { AlertTriangle, MonitorX, MessageSquareWarning, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { listAdminClientErrors, type AdminClientErrorRow } from '@/lib/adminClientErrorsApi';

/**
 * /admin → «Ошибки»: краши клиента (ErrorBoundary 'screen' + деградации
 * MarkdownErrorBoundary 'markdown_bubble') из analytics_events('client_error').
 * Группировка по (message, route): счётчик, последнее время, пример браузера.
 */

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
            Крашей не зафиксировано. Сюда попадают белые экраны (ErrorBoundary) и
            деградации рендера сообщений (MarkdownErrorBoundary) с prod/preview.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {g.source === 'markdown_bubble' ? (
                      <MessageSquareWarning className="w-4 h-4 shrink-0 text-amber-500" aria-hidden="true" />
                    ) : (
                      <MonitorX className="w-4 h-4 shrink-0 text-red-500" aria-hidden="true" />
                    )}
                    <span className="text-xs font-medium text-slate-500">
                      {g.source === 'markdown_bubble' ? 'Пузырь (fallback)' : 'Белый экран'}
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
