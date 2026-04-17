import { useState, useEffect, useCallback } from "react";
import { format, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, RefreshCw, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiscoveryMetricCard } from "./DiscoveryMetricCard";
import { PatternBuckets, type Bucket } from "./PatternBuckets";
import { MorningReviewQueue, type MorningReviewItem } from "./MorningReviewQueue";

interface DiscoveryData {
  window: { startDate: string; endDate: string };
  empty: boolean;
  metrics: {
    meaningfulProgressRate: number;
    startedThreadRate: number;
    completionRate: number;
    partialRate: number;
    autonomousRate: number;
    interventionRate: number;
    needsAttentionRate: number;
    ttmMedianSec: number;
    ttmMedianLabel: string;
    totals: {
      allThreads: number;
      startedThreads: number;
      meaningfulThreads: number;
      completedThreads: number;
      partialThreads: number;
      interventionThreads: number;
      needsAttentionThreads: number;
    };
  };
  successBuckets: Bucket[];
  failureBuckets: Bucket[];
  morningReview: MorningReviewItem[];
  tutorOptions: { tutorId: string; username: string }[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => v.toLocaleString("ru-RU");

export const ProductDiscoveryDashboard = () => {
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutorId, setTutorId] = useState<string>("all");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startDate = dateRange.from.toISOString().split("T")[0];
      const endDate = dateRange.to.toISOString().split("T")[0];
      const body: { startDate: string; endDate: string; tutorId?: string } = { startDate, endDate };
      if (tutorId && tutorId !== "all") body.tutorId = tutorId;
      const { data: resp, error: invokeErr } = await supabase.functions.invoke("admin-product-discovery", { body });
      if (invokeErr) throw new Error(invokeErr.message);
      if (resp?.error) throw new Error(resp.error);
      setData(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [dateRange, tutorId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const m = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Compass className="w-5 h-5 text-primary" />
            Product Discovery
          </h2>
          <p className="text-sm text-muted-foreground">
            Где продукт создаёт прогресс, а где требует доработки.
          </p>
          <p className="text-xs text-muted-foreground italic">
            Основано только на системных данных guided/homework flows. Без ручных тегов.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={tutorId} onValueChange={setTutorId}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="Все репетиторы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все репетиторы</SelectItem>
              {(data?.tutorOptions ?? []).map((t) => (
                <SelectItem key={t.tutorId} value={t.tutorId}>
                  {t.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                {format(dateRange.from, "d MMM", { locale: ru })} — {format(dateRange.to, "d MMM", { locale: ru })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                defaultMonth={dateRange.from}
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(range) => {
                  if (range?.from && range?.to) setDateRange({ from: range.from, to: range.to });
                  else if (range?.from) setDateRange({ from: range.from, to: range.from });
                }}
                numberOfMonths={2}
                disabled={(date) => date > new Date()}
                className={cn("p-3 pointer-events-auto")}
                locale={ru}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" className="h-9" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      ) : data && m ? (
        <>
          {data.empty || m.totals.allThreads === 0 ? (
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Compass className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">Нет данных за период</h3>
              <p className="text-sm text-muted-foreground">
                За выбранный период не было активных тредов{tutorId !== "all" && " у этого репетитора"}.
              </p>
            </div>
          ) : (
            <>
              {/* Row 1: NSM + headline rates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <DiscoveryMetricCard
                  title="Meaningful Progress Rate · NSM"
                  value={pct(m.meaningfulProgressRate)}
                  sub={`${num(m.totals.meaningfulThreads)} / ${num(m.totals.startedThreads)} начатых`}
                  emphasize
                  tone={m.meaningfulProgressRate >= 0.6 ? "good" : m.meaningfulProgressRate >= 0.3 ? "warn" : "bad"}
                  tooltip="Главная метрика. Доля начатых тредов, дошедших до значимого прогресса (completed task ИЛИ хотя бы попытка/подсказка). Показывает, двигает ли продукт ученика вперёд. Прямая метрика."
                />
                <DiscoveryMetricCard
                  title="Started Thread Rate"
                  value={pct(m.startedThreadRate)}
                  sub={`${num(m.totals.startedThreads)} / ${num(m.totals.allThreads)} тредов`}
                  tone={m.startedThreadRate >= 0.6 ? "good" : m.startedThreadRate >= 0.3 ? "warn" : "bad"}
                  tooltip="Доля автоматически созданных тредов, в которых ученик реально начал работать (отправил answer/hint/question). Не путать с фактом существования треда. Прямая метрика."
                />
                <DiscoveryMetricCard
                  title="Thread Completion Rate"
                  value={pct(m.completionRate)}
                  sub={`${num(m.totals.completedThreads)} завершено`}
                  tone={m.completionRate >= 0.5 ? "good" : m.completionRate >= 0.25 ? "warn" : "bad"}
                  tooltip="Доля начатых тредов, дошедших до полного завершения (status=completed). Прямая метрика."
                />
                <DiscoveryMetricCard
                  title="Needs Attention Rate"
                  value={pct(m.needsAttentionRate)}
                  sub={`${num(m.totals.needsAttentionThreads)} тредов в риске`}
                  tone={m.needsAttentionRate >= 0.4 ? "bad" : m.needsAttentionRate >= 0.2 ? "warn" : "good"}
                  tooltip="Доля начатых тредов, требующих внимания: (a) > 24ч без прогресса, (b) ≥ 3 подсказок без завершения, (c) ≥ 5 попыток без завершения, (d) уже было видимое вмешательство. Прямая метрика."
                />
              </div>

              {/* Row 2: quality + proxies */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <DiscoveryMetricCard
                  title="Partial Useful Progress"
                  value={pct(m.partialRate)}
                  sub={`${num(m.totals.partialThreads)} тредов`}
                  tone="default"
                  tooltip="Доля начатых тредов с полезным прогрессом, но без полного completion. Показывает, что продукт даёт ценность даже без финиша. Прямая метрика."
                />
                <DiscoveryMetricCard
                  title="Autonomous Progress"
                  value={pct(m.autonomousRate)}
                  sub="без видимого вмешательства"
                  isProxy
                  tone={m.autonomousRate >= 0.6 ? "good" : "warn"}
                  tooltip="Доля значимых тредов, где НЕТ ни одного видимого ученику сообщения от репетитора. Proxy: оффлайн-помощь не видна системе."
                />
                <DiscoveryMetricCard
                  title="Tutor Intervention Rate"
                  value={pct(m.interventionRate)}
                  sub={`${num(m.totals.interventionThreads)} тредов с вмешательством`}
                  isProxy
                  tone={m.interventionRate <= 0.3 ? "good" : m.interventionRate <= 0.5 ? "warn" : "bad"}
                  tooltip="Доля начатых тредов с ≥ 1 видимым ученику сообщением от репетитора. Proxy: основан только на сообщениях в продукте."
                />
                <DiscoveryMetricCard
                  title="Median Time to Meaningful"
                  value={m.ttmMedianLabel}
                  sub="от первого действия до прогресса"
                  tooltip="Медианное время от первого student action до первого момента значимого прогресса (по task_state.updated_at). Показывает, насколько быстро продукт даёт первую ценность."
                />
              </div>

              {/* Row 3: Operational */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <DiscoveryMetricCard
                  title="Morning Review Queue"
                  value={num(m.totals.needsAttentionThreads)}
                  sub="тредов требуют внимания"
                  tone={m.totals.needsAttentionThreads === 0 ? "good" : m.totals.needsAttentionThreads >= 10 ? "bad" : "warn"}
                  tooltip="Сколько тредов сейчас стоит просмотреть репетитору. Оперативная метрика — основа утреннего ревью."
                />
                <DiscoveryMetricCard
                  title="Всего тредов"
                  value={num(m.totals.allThreads)}
                  sub={`${num(m.totals.startedThreads)} начатых`}
                  tooltip="Общее число тредов в окне (созданных или активных). Показатель масштаба для контекста."
                />
                <DiscoveryMetricCard
                  title="Завершено"
                  value={num(m.totals.completedThreads)}
                  sub={`из ${num(m.totals.startedThreads)} начатых`}
                  tooltip="Абсолютное число завершённых тредов в окне."
                />
              </div>

              {/* Pattern buckets */}
              <PatternBuckets
                successBuckets={data.successBuckets}
                failureBuckets={data.failureBuckets}
              />

              {/* Morning review table */}
              <MorningReviewQueue items={data.morningReview} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
};
