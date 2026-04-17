import { useState, useEffect, useCallback } from "react";
import { format, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarIcon, RefreshCw, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { VerdictCard } from "./VerdictCard";
import { BusinessMetricCard } from "./BusinessMetricCard";
import { AtRiskTutorsTable, type AtRiskTutor } from "./AtRiskTutorsTable";
import { AllTutorsTable, type TutorRow, type MetricFilter } from "./AllTutorsTable";
import { CrmTagsSummary } from "./CrmTagsSummary";
import { EditTutorTagsDialog, type TutorTagsValues } from "./EditTutorTagsDialog";

interface BusinessData {
  cohort: "pilot" | "all";
  pilotTutorCount: number;
  totalTutorCount: number;
  empty: boolean;
  window: { startDate: string; endDate: string };
  metrics: {
    cohortSize: number;
    repeatValueTutors: { count: number; share: number };
    willingToPay: { yes: number; maybe: number; no: number; unknown: number; yesShare: number; yesMaybeShare: number };
    atRiskTutors: { count: number; share: number };
    tutorRevisitRate: number;
    meaningfulThreadsPerTutor: { median: number; avg: number };
    workflowCompletionRate: number;
    autonomousProgressRate: number;
    studentsReached: number;
    totals: { startedThreads: number; meaningfulThreads: number };
  } | null;
  atRiskTutors: AtRiskTutor[];
  allTutors: TutorRow[];
  crmSummary: {
    willingToPay: { yes: number; maybe: number; no: number; unknown: number };
    riskStatus: { healthy: number; watch: number; at_risk: number };
  };
  verdict: { level: "high" | "mixed" | "low"; reason: string };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => v.toLocaleString("ru-RU");

export const BusinessDashboard = () => {
  const [data, setData] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cohort, setCohort] = useState<"pilot" | "all">("pilot");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const [editTarget, setEditTarget] = useState<TutorTagsValues | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startDate = dateRange.from.toISOString().split("T")[0];
      const endDate = dateRange.to.toISOString().split("T")[0];
      const { data: resp, error: invokeErr } = await supabase.functions.invoke("admin-business-dashboard", {
        body: { startDate, endDate, cohort },
      });
      if (invokeErr) throw new Error(invokeErr.message);
      if (resp?.error) throw new Error(resp.error);
      setData(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [dateRange, cohort]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openEdit = (t: AtRiskTutor) => {
    setEditTarget({
      tutorId: t.tutorId,
      username: t.username,
      isPilot: cohort === "pilot",
      willingToPay: t.willingToPay,
      riskStatus: t.riskStatus,
      keyPain: t.keyPain,
    });
  };

  const m = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Бизнес-дашборд</h2>
          <p className="text-sm text-muted-foreground">
            Сигналы конверсии бесплатного пилота в готовность платить.
            <span className="ml-1 text-xs">Включая ручные CRM-теги, где они проставлены.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs value={cohort} onValueChange={(v) => setCohort(v as "pilot" | "all")}>
            <TabsList className="h-9">
              <TabsTrigger value="pilot" className="text-xs px-3">
                Пилот {data?.pilotTutorCount != null && `(${data.pilotTutorCount})`}
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs px-3">
                Все {data?.totalTutorCount != null && `(${data.totalTutorCount})`}
              </TabsTrigger>
            </TabsList>
          </Tabs>
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

      {/* Pilot empty state */}
      {data && cohort === "pilot" && data.pilotTutorCount === 0 && (
        <div className="border-2 border-dashed rounded-lg p-6 text-center">
          <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">В пилотной когорте пока никого нет</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Отметьте репетиторов как «пилот» через диалог редактирования. Пока — посмотрите всех.
          </p>
          <Button variant="outline" size="sm" onClick={() => setCohort("all")}>
            Показать всех репетиторов
          </Button>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      ) : data && m ? (
        <>
          {/* Verdict */}
          <VerdictCard level={data.verdict.level} reason={data.verdict.reason} />

          {/* Row 1: headline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <BusinessMetricCard
              title="Repeat Value Tutors (NSM)"
              value={num(m.repeatValueTutors.count)}
              sub={`${pct(m.repeatValueTutors.share)} от когорты (${m.cohortSize})`}
              tone={m.repeatValueTutors.share >= 0.5 ? "good" : m.repeatValueTutors.share >= 0.25 ? "warn" : "bad"}
              tooltip="Главная NSM. Репетитор считается Repeat Value, если за период был активен ≥ 2 разных дня И имеет ≥ 3 значимых тредов учеников. Прямая метрика."
            />
            <BusinessMetricCard
              title="Готовы платить"
              value={`${num(m.willingToPay.yes)}`}
              sub={`yes: ${pct(m.willingToPay.yesShare)} · yes+maybe: ${pct(m.willingToPay.yesMaybeShare)}`}
              tone={m.willingToPay.yesShare >= 0.2 ? "good" : "warn"}
              tooltip="Доля репетиторов с ручным тегом willing_to_pay = yes (и yes+maybe). Заполняется вручную через диалог редактирования. Manual CRM tag."
            />
            <BusinessMetricCard
              title="В зоне риска"
              value={num(m.atRiskTutors.count)}
              sub={`${pct(m.atRiskTutors.share)} от когорты`}
              tone={m.atRiskTutors.share >= 0.5 ? "bad" : m.atRiskTutors.share >= 0.25 ? "warn" : "good"}
              tooltip="Репетитор в риске если: < 2 активных дней ИЛИ < 2 значимых тредов за период ИЛИ ручной тег risk_status = at_risk."
            />
            <BusinessMetricCard
              title="Tutor Revisit Rate"
              value={pct(m.tutorRevisitRate)}
              sub="≥ 2 активных дней / все"
              tone={m.tutorRevisitRate >= 0.5 ? "good" : m.tutorRevisitRate >= 0.3 ? "warn" : "bad"}
              tooltip="Доля репетиторов когорты, у которых был активен хотя бы 1 ученик минимум в 2 разных дня за период. Прямая метрика."
            />
          </div>

          {/* Row 2: usage quality */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <BusinessMetricCard
              title="Знач. тредов / репетитор"
              value={m.meaningfulThreadsPerTutor.median.toFixed(1)}
              sub={`медиана · avg ${m.meaningfulThreadsPerTutor.avg.toFixed(1)}`}
              tone={m.meaningfulThreadsPerTutor.median >= 3 ? "good" : m.meaningfulThreadsPerTutor.median >= 1 ? "warn" : "bad"}
              tooltip="Медиана значимых тредов на одного репетитора в когорте. Значимый тред = у ученика был хотя бы один реальный шаг (ответ, hint, попытка), не просто открытие."
            />
            <BusinessMetricCard
              title="Workflow Completion"
              value={pct(m.workflowCompletionRate)}
              sub={`${num(m.totals.meaningfulThreads)} / ${num(m.totals.startedThreads)} тредов`}
              tone={m.workflowCompletionRate >= 0.6 ? "good" : m.workflowCompletionRate >= 0.3 ? "warn" : "bad"}
              tooltip="Доля начатых тредов, дошедших до значимого прогресса (completed либо явный progress по task_states). Прямая метрика."
            />
            <BusinessMetricCard
              title="Autonomous Progress"
              value={pct(m.autonomousProgressRate)}
              sub="без вмешательства репетитора"
              isProxy
              tone={m.autonomousProgressRate >= 0.6 ? "good" : "warn"}
              tooltip="Доля значимых тредов, где НЕТ ни одного видимого ученику сообщения от репетитора. Proxy: основан на visible tutor messages — точных данных по offline-вмешательству нет."
            />
            <BusinessMetricCard
              title="Учеников затронуто"
              value={num(m.studentsReached)}
              sub="distinct students"
              tooltip="Количество уникальных учеников, у которых был хотя бы 1 started thread за период. Прямая метрика."
            />
          </div>

          {/* At-risk table */}
          <AtRiskTutorsTable tutors={data.atRiskTutors} onEdit={openEdit} />

          {/* CRM summary */}
          <CrmTagsSummary willingToPay={data.crmSummary.willingToPay} riskStatus={data.crmSummary.riskStatus} />
        </>
      ) : null}

      <EditTutorTagsDialog
        open={editTarget !== null}
        onOpenChange={(v) => !v && setEditTarget(null)}
        initial={editTarget}
        onSaved={fetchData}
      />
    </div>
  );
};
