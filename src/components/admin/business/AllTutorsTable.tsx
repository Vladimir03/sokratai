import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, X, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TutorRow {
  tutorId: string;
  username: string | null;
  subjects: string[];
  activeDays7d: number;
  meaningfulThreads7d: number;
  startedThreads7d: number;
  studentsReached7d: number;
  willingToPay: "yes" | "maybe" | "no" | "unknown";
  riskStatus: "healthy" | "watch" | "at_risk";
  keyPain: string | null;
  flags: {
    repeatValue: boolean;
    willingYes: boolean;
    atRisk: boolean;
    revisit: boolean;
  };
}

export type MetricFilter = "repeatValue" | "willingYes" | "atRisk" | "revisit" | null;

interface Props {
  tutors: TutorRow[];
  filter: MetricFilter;
  onClearFilter: () => void;
  onEdit: (tutor: TutorRow) => void;
}

const FILTER_LABEL: Record<Exclude<MetricFilter, null>, string> = {
  repeatValue: "Repeat Value Tutors",
  willingYes: "Готовы платить (yes)",
  atRisk: "В зоне риска",
  revisit: "Revisit ≥ 2 дней",
};

const willingBadge = (v: TutorRow["willingToPay"]) => {
  const map = {
    yes: { label: "yes", class: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    maybe: { label: "maybe", class: "bg-amber-100 text-amber-800 border-amber-200" },
    no: { label: "no", class: "bg-rose-100 text-rose-800 border-rose-200" },
    unknown: { label: "—", class: "bg-slate-100 text-slate-600 border-slate-200" },
  }[v];
  return <Badge variant="outline" className={cn("text-xs", map.class)}>{map.label}</Badge>;
};

const riskBadge = (v: TutorRow["riskStatus"]) => {
  const map = {
    healthy: { label: "healthy", class: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    watch: { label: "watch", class: "bg-amber-100 text-amber-800 border-amber-200" },
    at_risk: { label: "at_risk", class: "bg-rose-100 text-rose-800 border-rose-200" },
  }[v];
  return <Badge variant="outline" className={cn("text-xs", map.class)}>{map.label}</Badge>;
};

const flagIcon = (on: boolean) =>
  on ? (
    <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
  ) : (
    <XCircle className="w-4 h-4 text-slate-300 mx-auto" />
  );

export const AllTutorsTable = ({ tutors, filter, onClearFilter, onEdit }: Props) => {
  const filtered = filter ? tutors.filter((t) => t.flags[filter]) : tutors;

  return (
    <Card animate={false}>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">
            Все репетиторы когорты {filter ? `· ${FILTER_LABEL[filter]}` : ""}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {filter
              ? `Показаны только репетиторы из агрегата «${FILTER_LABEL[filter]}» (${filtered.length} из ${tutors.length}). Нажмите × чтобы сбросить.`
              : `Кликните на одну из 4 карточек выше — увидите только репетиторов из этого агрегата.`}
          </p>
        </div>
        {filter && (
          <Button variant="outline" size="sm" className="h-8" onClick={onClearFilter}>
            <X className="w-3.5 h-3.5 mr-1" /> Сбросить
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            {filter ? "Нет репетиторов в этом агрегате." : "Когорта пуста."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Репетитор</th>
                  <th className="text-left px-3 py-2 font-medium">Предметы</th>
                  <th className="text-center px-2 py-2 font-medium" title="Активные дни за выбранный период">Дни</th>
                  <th className="text-center px-2 py-2 font-medium" title="Started threads">Started</th>
                  <th className="text-center px-2 py-2 font-medium" title="Meaningful threads">Знач.</th>
                  <th className="text-center px-2 py-2 font-medium" title="Учеников затронуто">Учен.</th>
                  <th
                    className={cn(
                      "text-center px-2 py-2 font-medium",
                      filter === "repeatValue" && "bg-primary/10 text-primary",
                    )}
                    title="Repeat Value: ≥2 дня и ≥3 знач. треда"
                  >
                    RV
                  </th>
                  <th
                    className={cn(
                      "text-center px-2 py-2 font-medium",
                      filter === "willingYes" && "bg-primary/10 text-primary",
                    )}
                    title="Willing to pay = yes"
                  >
                    Pay
                  </th>
                  <th
                    className={cn(
                      "text-center px-2 py-2 font-medium",
                      filter === "atRisk" && "bg-primary/10 text-primary",
                    )}
                    title="В зоне риска"
                  >
                    Risk
                  </th>
                  <th
                    className={cn(
                      "text-center px-2 py-2 font-medium",
                      filter === "revisit" && "bg-primary/10 text-primary",
                    )}
                    title="Revisit: ≥2 дня"
                  >
                    Rev
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Pay tag</th>
                  <th className="text-left px-3 py-2 font-medium">Risk tag</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.tutorId} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{t.username ?? t.tutorId.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {t.subjects.length > 0 ? t.subjects.slice(0, 2).join(", ") : "—"}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">{t.activeDays7d}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{t.startedThreads7d}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{t.meaningfulThreads7d}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{t.studentsReached7d}</td>
                    <td className={cn("px-2 py-2", filter === "repeatValue" && "bg-primary/5")}>
                      {flagIcon(t.flags.repeatValue)}
                    </td>
                    <td className={cn("px-2 py-2", filter === "willingYes" && "bg-primary/5")}>
                      {flagIcon(t.flags.willingYes)}
                    </td>
                    <td className={cn("px-2 py-2", filter === "atRisk" && "bg-primary/5")}>
                      {flagIcon(t.flags.atRisk)}
                    </td>
                    <td className={cn("px-2 py-2", filter === "revisit" && "bg-primary/5")}>
                      {flagIcon(t.flags.revisit)}
                    </td>
                    <td className="px-3 py-2">{willingBadge(t.willingToPay)}</td>
                    <td className="px-3 py-2">{riskBadge(t.riskStatus)}</td>
                    <td className="px-2 py-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(t)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
