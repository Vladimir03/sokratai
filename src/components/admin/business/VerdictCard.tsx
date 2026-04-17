import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  level: "high" | "mixed" | "low";
  reason: string;
}

export const VerdictCard = ({ level, reason }: Props) => {
  const config = {
    high: {
      label: "Высокий шанс конверсии",
      sub: "Сигналы пилота сильные — есть основания идти в платный этап",
      icon: CheckCircle2,
      classes: "border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-900",
      iconClass: "text-emerald-600",
    },
    mixed: {
      label: "Смешанный сигнал",
      sub: "Usage есть, но платёжный сигнал неоднозначный — нужна работа с готовностью платить",
      icon: AlertTriangle,
      classes: "border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100 text-amber-900",
      iconClass: "text-amber-600",
    },
    low: {
      label: "Низкий шанс конверсии",
      sub: "Слабый usage и/или почти нет yes-меток по готовности платить",
      icon: XCircle,
      classes: "border-rose-300 bg-gradient-to-br from-rose-50 to-rose-100 text-rose-900",
      iconClass: "text-rose-600",
    },
  }[level];

  const Icon = config.icon;

  return (
    <Card className={cn("border-2", config.classes)} animate={false}>
      <CardContent className="p-6 flex items-start gap-4">
        <Icon className={cn("w-10 h-10 shrink-0 mt-1", config.iconClass)} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">
            CEO-вердикт
          </div>
          <div className="text-2xl font-bold leading-tight">{config.label}</div>
          <div className="text-sm mt-2 opacity-80">{config.sub}</div>
          <div className="text-xs mt-3 italic opacity-70">
            Основание: {reason}
          </div>
          <div className="text-[10px] mt-2 opacity-60">
            Эвристика: usage-метрики + ручные теги willing_to_pay. Не замена клиентских интервью.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
