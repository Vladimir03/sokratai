import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanBadge } from "./PulseBadges";
import type { PulseAtRiskTutor, PulseRiskStatus, PulseWillingToPay } from "./pulseTypes";

const RISK_LABEL: Record<PulseRiskStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
};

const WILLING_LABEL: Record<PulseWillingToPay, string> = {
  yes: "Готов платить",
  maybe: "Рассматривает",
  no: "Не готов",
  unknown: "Не выяснено",
};

const RiskBadge = ({ status }: { status: PulseRiskStatus }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
      status === "healthy" && "border-emerald-200 bg-emerald-50 text-emerald-900",
      status === "watch" && "border-amber-200 bg-amber-50 text-amber-900",
      status === "at_risk" && "border-rose-200 bg-rose-50 text-rose-900",
    )}
  >
    {RISK_LABEL[status]}
  </span>
);

const AtRiskRow = memo(
  ({ tutor, onEdit }: { tutor: PulseAtRiskTutor; onEdit: (t: PulseAtRiskTutor) => void }) => (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-900">{tutor.name}</span>
          <PlanBadge isPaying={tutor.isPaying} isTrial={tutor.isTrial} />
        </div>
      </td>
      <td className="py-2 pr-3 text-sm text-slate-600 whitespace-nowrap tabular-nums">
        {tutor.daysSinceValue == null ? (
          <span className="text-rose-700">сдач не было</span>
        ) : (
          `${tutor.daysSinceValue} дн без сдач`
        )}
      </td>
      <td className="py-2 pr-3">
        <RiskBadge status={tutor.riskStatus} />
      </td>
      <td className="py-2 pr-3 text-sm text-slate-600 whitespace-nowrap">
        {WILLING_LABEL[tutor.willingToPay]}
      </td>
      <td className="py-2 pr-3 text-sm text-slate-500 max-w-[220px] truncate" title={tutor.keyPain ?? undefined}>
        {tutor.keyPain ?? "—"}
      </td>
      <td className="py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Теги: ${tutor.name}`}
          title="Ручные CEO-теги"
          onClick={() => onEdit(tutor)}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </td>
    </tr>
  ),
);
AtRiskRow.displayName = "PulseAtRiskRow";

/**
 * Платящие/триальные без свежей «ценности» (сдач учеников) или с ручной
 * меткой риска — их терять дороже всего, писать им первыми.
 */
export const PulseAtRisk = ({
  tutors,
  onEdit,
}: {
  tutors: PulseAtRiskTutor[];
  onEdit: (t: PulseAtRiskTutor) => void;
}) => (
  <Card animate={false}>
    <CardHeader className="pb-3">
      <CardTitle className="text-base">В зоне риска</CardTitle>
      <p className="text-sm text-muted-foreground">
        Платящие и триальные, у чьих учеников давно не было сдач ДЗ.
      </p>
    </CardHeader>
    <CardContent>
      {tutors.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Пусто — у всех платящих и триальных ученики сдавали ДЗ на этой неделе.
        </p>
      ) : (
        <div className="overflow-x-auto touch-pan-x">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">Репетитор</th>
                <th className="py-2 pr-3 font-medium">Ценность</th>
                <th className="py-2 pr-3 font-medium">Риск</th>
                <th className="py-2 pr-3 font-medium">Платить</th>
                <th className="py-2 pr-3 font-medium">Key pain</th>
                <th className="py-2 font-medium"><span className="sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              {tutors.map((t) => (
                <AtRiskRow key={t.tutorId} tutor={t} onEdit={onEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardContent>
  </Card>
);
