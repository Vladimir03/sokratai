import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  GraduationCap,
  ChevronRight,
  Users,
  BookOpen,
  CalendarDays,
  Wallet,
  Repeat,
  ClipboardCheck,
  TrendingUp,
} from "lucide-react";
import {
  fetchTutorsOverview,
  fetchTutorExtras,
  formatRelativeTime,
  type TutorOverview,
  type TutorExtras,
} from "@/lib/adminHomeworkApi";

interface Props {
  onSelectTutor: (tutor: TutorOverview) => void;
  reloadKey?: number;
  /** ISO date strings (inclusive start, exclusive end) for date-range scoped per-tutor metrics. */
  startDate?: string;
  endDate?: string;
}

type SortKey = "activity" | "gmv" | "lessons" | "dz";

const formatMoney = (rub: number): string =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(rub);

export const AdminTutorList = ({ onSelectTutor, reloadKey, startDate, endDate }: Props) => {
  const [tutors, setTutors] = useState<TutorOverview[]>([]);
  const [extras, setExtras] = useState<Record<string, TutorExtras>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("activity");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const tutorsData = await fetchTutorsOverview();
        if (cancelled) return;
        setTutors(tutorsData);
        if (startDate && endDate) {
          try {
            const extrasData = await fetchTutorExtras(startDate, endDate);
            if (!cancelled) setExtras(extrasData);
          } catch (extErr) {
            console.warn("[AdminTutorList] extras fetch error", extErr);
            if (!cancelled) setExtras({});
          }
        }
      } catch (err) {
        console.error("[AdminTutorList] fetch error", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, startDate, endDate]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? tutors.filter((t) =>
        t.tutorName.toLowerCase().includes(q) ||
        (t.telegramUsername || "").toLowerCase().includes(q),
      )
    : tutors;

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "gmv") return (extras[b.tutorId]?.gmv_paid ?? 0) - (extras[a.tutorId]?.gmv_paid ?? 0);
    if (sortKey === "lessons") return (extras[b.tutorId]?.lessons_total ?? 0) - (extras[a.tutorId]?.lessons_total ?? 0);
    if (sortKey === "dz") return b.totalAssignments - a.totalAssignments;
    // activity = default (already pre-sorted by lastActivityAt from backend)
    return 0;
  });

  // KPI bar derive
  const totalTutors = tutors.length;
  const tutorsWithSchedule = tutors.filter((t) => (extras[t.tutorId]?.lessons_total ?? 0) > 0).length;
  const tutorsWithPayments = tutors.filter((t) => (extras[t.tutorId]?.payments_count ?? 0) > 0).length;
  const tutorsWithBoth = tutors.filter(
    (t) => (extras[t.tutorId]?.lessons_total ?? 0) > 0 && (extras[t.tutorId]?.payments_count ?? 0) > 0,
  ).length;
  const totalGmv = tutors.reduce((sum, t) => sum + (extras[t.tutorId]?.gmv_paid ?? 0), 0);

  const topByGmv = [...tutors]
    .filter((t) => (extras[t.tutorId]?.gmv_paid ?? 0) > 0)
    .sort((a, b) => (extras[b.tutorId]?.gmv_paid ?? 0) - (extras[a.tutorId]?.gmv_paid ?? 0))
    .slice(0, 5);
  const topByLessons = [...tutors]
    .filter((t) => (extras[t.tutorId]?.lessons_total ?? 0) > 0)
    .sort((a, b) => (extras[b.tutorId]?.lessons_total ?? 0) - (extras[a.tutorId]?.lessons_total ?? 0))
    .slice(0, 5);

  const hasExtras = Object.keys(extras).length > 0 && !!startDate && !!endDate;
  const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : 0);

  return (
    <div className="space-y-4">
      {hasExtras && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={<CalendarDays className="w-4 h-4 text-blue-600" />}
            label="Ведут расписание"
            value={`${tutorsWithSchedule}/${totalTutors}`}
            sub={`${pct(tutorsWithSchedule, totalTutors)}%`}
          />
          <KpiCard
            icon={<Wallet className="w-4 h-4 text-emerald-600" />}
            label="Ведут оплаты"
            value={`${tutorsWithPayments}/${totalTutors}`}
            sub={`${pct(tutorsWithPayments, totalTutors)}%`}
          />
          <KpiCard
            icon={<TrendingUp className="w-4 h-4 text-violet-600" />}
            label="Расписание + оплаты"
            value={`${tutorsWithBoth}/${totalTutors}`}
            sub={`${pct(tutorsWithBoth, totalTutors)}%`}
            tooltip="Использует обе фичи за выбранный период"
          />
          <KpiCard
            icon={<Wallet className="w-4 h-4 text-emerald-700" />}
            label="Общий GMV"
            value={formatMoney(totalGmv)}
            sub={`за период`}
          />
        </div>
      )}

    <Card>
      <CardContent className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени или @username..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity">По активности</SelectItem>
                <SelectItem value="gmv">По GMV</SelectItem>
                <SelectItem value="lessons">По урокам</SelectItem>
                <SelectItem value="dz">По числу ДЗ</SelectItem>
              </SelectContent>
            </Select>
          </div>

        {isLoading ? (
          <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          ) : sorted.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <GraduationCap className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>{q ? "Ничего не найдено" : "Пока нет репетиторов с домашками"}</p>
          </div>
        ) : (
          <div className="space-y-1">
              {sorted.map((t) => {
                const ex = extras[t.tutorId];
                return (
              <button
                key={t.tutorId}
                onClick={() => onSelectTutor(t)}
                className="w-full text-left flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{t.tutorName}</span>
                    {t.telegramUsername && (
                      <span className="text-xs text-muted-foreground">@{t.telegramUsername}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                    <Badge variant="outline" className="h-5 px-1.5 gap-1">
                      <BookOpen className="w-3 h-3" />
                      ДЗ: {t.totalAssignments} · <span className="text-emerald-700">{t.activeAssignments}</span> акт. · <span className="text-muted-foreground">{t.completedAssignments}</span> зав.
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 gap-1">
                      <Users className="w-3 h-3" />
                      {t.totalStudents} учеников · <span className="text-emerald-700">{t.activeStudents7d}</span> за 7д
                    </Badge>
                  </div>
                    {hasExtras && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                        {(ex?.lessons_total ?? 0) > 0 ? (
                          <Badge variant="outline" className="h-5 px-1.5 gap-1 border-blue-200 bg-blue-50/40">
                            <CalendarDays className="w-3 h-3 text-blue-600" />
                            {ex!.lessons_total} ур.
                            {ex!.lessons_done > 0 && <span className="text-emerald-700"> · {ex!.lessons_done} done</span>}
                            {ex!.lessons_cancelled > 0 && <span className="text-rose-600"> · {ex!.lessons_cancelled} cncl</span>}
                            {ex!.lessons_recurring > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-violet-700">
                                · <Repeat className="w-2.5 h-2.5" />{ex!.lessons_recurring}
                              </span>
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 px-1.5 gap-1 text-muted-foreground/60">
                            <CalendarDays className="w-3 h-3" /> нет расп.
                          </Badge>
                        )}
                        {(ex?.payments_count ?? 0) > 0 ? (
                          <Badge variant="outline" className="h-5 px-1.5 gap-1 border-emerald-200 bg-emerald-50/40">
                            <Wallet className="w-3 h-3 text-emerald-700" />
                            {formatMoney(ex?.gmv_paid ?? 0)}
                            {(ex?.gmv_pending ?? 0) > 0 && (
                              <span className="text-amber-700"> · pend {formatMoney(ex!.gmv_pending)}</span>
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-5 px-1.5 gap-1 text-muted-foreground/60">
                            <Wallet className="w-3 h-3" /> нет оплат
                          </Badge>
                        )}
                        {(ex?.mock_exams_count ?? 0) > 0 && (
                          <Badge variant="outline" className="h-5 px-1.5 gap-1 border-indigo-200 bg-indigo-50/40 text-indigo-700">
                            <ClipboardCheck className="w-3 h-3" />
                            пробников {ex!.mock_exams_count}
                          </Badge>
                        )}
                      </div>
                    )}
                </div>
                <div className="text-right flex flex-col items-end gap-0.5 min-w-0 max-w-[200px]">
                  {t.lastActivityAt ? (
                    <>
                      <div className="text-xs font-medium truncate w-full">
                        {t.lastActivityStudentName || "—"}
                      </div>
                      {t.lastActivityPreview && (
                        <div className="text-[11px] text-muted-foreground truncate w-full">
                          {t.lastActivityPreview}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(t.lastActivityAt)}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">Нет активности</div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
                );
              })}
          </div>
        )}
      </CardContent>
    </Card>

      {hasExtras && (topByGmv.length > 0 || topByLessons.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TopList
            title="Топ-5 по GMV"
            icon={<Wallet className="w-4 h-4 text-emerald-700" />}
            items={topByGmv.map((t) => ({
              tutorId: t.tutorId,
              name: t.tutorName,
              value: formatMoney(extras[t.tutorId]?.gmv_paid ?? 0),
            }))}
          />
          <TopList
            title="Топ-5 по урокам"
            icon={<CalendarDays className="w-4 h-4 text-blue-600" />}
            items={topByLessons.map((t) => ({
              tutorId: t.tutorId,
              name: t.tutorName,
              value: `${extras[t.tutorId]?.lessons_total ?? 0} ур.`,
            }))}
          />
        </div>
      )}
    </div>
  );
};

function KpiCard({
  icon,
  label,
  value,
  sub,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tooltip?: string;
}) {
  return (
    <Card title={tooltip}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function TopList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ tutorId: string; name: string; value: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium mb-2">
          {icon}
          {title}
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground">Нет данных за период</div>
        ) : (
          <div className="space-y-1.5">
            {items.map((it, idx) => (
              <div key={it.tutorId} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground tabular-nums w-4">{idx + 1}.</span>
                  <span className="truncate">{it.name}</span>
                </div>
                <span className="text-xs font-medium tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
