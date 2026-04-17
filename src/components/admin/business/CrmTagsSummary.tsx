import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "lucide-react";

interface Props {
  willingToPay: { yes: number; maybe: number; no: number; unknown: number };
  riskStatus: { healthy: number; watch: number; at_risk: number };
}

const Pill = ({ label, count, tone }: { label: string; count: number; tone: "good" | "warn" | "bad" | "neutral" }) => {
  const cls = {
    good: "bg-emerald-50 border-emerald-200 text-emerald-800",
    warn: "bg-amber-50 border-amber-200 text-amber-800",
    bad: "bg-rose-50 border-rose-200 text-rose-800",
    neutral: "bg-slate-50 border-slate-200 text-slate-700",
  }[tone];
  return (
    <div className={`flex items-baseline justify-between border rounded-md px-3 py-2 ${cls}`}>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-xl font-bold tabular-nums">{count}</span>
    </div>
  );
};

export const CrmTagsSummary = ({ willingToPay, riskStatus }: Props) => {
  return (
    <Card animate={false} className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="w-4 h-4 text-muted-foreground" />
          Ручные CEO-теги
          <span className="ml-auto text-[10px] uppercase tracking-wide font-normal text-muted-foreground border border-dashed border-muted-foreground/40 rounded px-1.5 py-0.5">
            manual
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Заполняются вручную в диалоге редактирования. Это НЕ системные метрики.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Готовность платить
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Pill label="Yes" count={willingToPay.yes} tone="good" />
            <Pill label="Maybe" count={willingToPay.maybe} tone="warn" />
            <Pill label="No" count={willingToPay.no} tone="bad" />
            <Pill label="Unknown" count={willingToPay.unknown} tone="neutral" />
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Risk status
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Pill label="Healthy" count={riskStatus.healthy} tone="good" />
            <Pill label="Watch" count={riskStatus.watch} tone="warn" />
            <Pill label="At risk" count={riskStatus.at_risk} tone="bad" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
