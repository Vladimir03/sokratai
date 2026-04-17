import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";

export interface AtRiskTutor {
  tutorId: string;
  username: string | null;
  subjects: string[];
  activeDays7d: number;
  meaningfulThreads7d: number;
  startedThreads7d: number;
  willingToPay: "yes" | "maybe" | "no" | "unknown";
  riskStatus: "healthy" | "watch" | "at_risk";
  keyPain: string | null;
}

interface Props {
  tutors: AtRiskTutor[];
  onEdit: (tutor: AtRiskTutor) => void;
}

const willingBadge = (v: AtRiskTutor["willingToPay"]) => {
  const map = {
    yes: { label: "yes", class: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    maybe: { label: "maybe", class: "bg-amber-100 text-amber-800 border-amber-200" },
    no: { label: "no", class: "bg-rose-100 text-rose-800 border-rose-200" },
    unknown: { label: "unknown", class: "bg-slate-100 text-slate-600 border-slate-200" },
  }[v];
  return <Badge variant="outline" className={map.class}>{map.label}</Badge>;
};

const riskBadge = (v: AtRiskTutor["riskStatus"]) => {
  const map = {
    healthy: { label: "healthy", class: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    watch: { label: "watch", class: "bg-amber-100 text-amber-800 border-amber-200" },
    at_risk: { label: "at risk", class: "bg-rose-100 text-rose-800 border-rose-200" },
  }[v];
  return <Badge variant="outline" className={map.class}>{map.label}</Badge>;
};

export const AtRiskTutorsTable = ({ tutors, onEdit }: Props) => {
  return (
    <Card animate={false}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Репетиторы в зоне риска</CardTitle>
        <p className="text-xs text-muted-foreground">
          &lt; 2 активных дней ИЛИ &lt; 2 значимых тредов за период ИЛИ ручной тег risk = at_risk.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {tutors.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Нет репетиторов в зоне риска. 👍
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Репетитор</th>
                  <th className="text-left px-3 py-2 font-medium">Предметы</th>
                  <th className="text-center px-3 py-2 font-medium" title="Активные дни за выбранный период">Дни</th>
                  <th className="text-center px-3 py-2 font-medium" title="Значимые треды">Знач. тредов</th>
                  <th className="text-left px-3 py-2 font-medium">Готовность платить</th>
                  <th className="text-left px-3 py-2 font-medium">Risk</th>
                  <th className="text-left px-3 py-2 font-medium">Key pain</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {tutors.map((t) => (
                  <tr key={t.tutorId} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{t.username ?? t.tutorId.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {t.subjects.length > 0 ? t.subjects.slice(0, 2).join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.activeDays7d}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.meaningfulThreads7d}</td>
                    <td className="px-3 py-2">{willingBadge(t.willingToPay)}</td>
                    <td className="px-3 py-2">{riskBadge(t.riskStatus)}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                      {t.keyPain ?? "—"}
                    </td>
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
