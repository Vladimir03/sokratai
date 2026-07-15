import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, QrCode } from "lucide-react";
import type { PulsePreFunnel as PreFunnelData } from "./pulseTypes";

const num = (v: number) => v.toLocaleString("ru-RU");

const delta = (v: number) => {
  if (v > 0) return <span className="text-emerald-700 text-xs tabular-nums">+{num(v)}</span>;
  if (v < 0) return <span className="text-rose-700 text-xs tabular-nums">{num(v)}</span>;
  return <span className="text-slate-400 text-xs">—</span>;
};

const Step = ({ label, value, deltaValue }: { label: string; value: number; deltaValue: number }) => (
  <div className="flex flex-col items-center px-3 py-2 min-w-[110px]">
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground text-center leading-tight">
      {label}
    </span>
    <span className="text-2xl font-bold tabular-nums mt-0.5">{num(value)}</span>
    {delta(deltaValue)}
  </div>
);

/**
 * Пре-воронка «до регистрации» — агрегаты Яндекс.Метрики за 7 дней (имён до
 * регистрации не бывает). newTutors7d прокидывается из шапки — замыкает
 * цепочку на первую поимённую ступень.
 */
export const PulsePreFunnel = ({
  data,
  newTutors7d,
}: {
  data: PreFunnelData;
  newTutors7d: number;
}) => {
  if (!data.available) {
    return (
      <Card animate={false} className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Пре-воронка «до регистрации» не подключена: добавь секрет{" "}
          <code className="text-xs bg-slate-100 rounded px-1">METRIKA_API_TOKEN</code> в Supabase
          (OAuth-токен Яндекса с правом чтения Метрики) — данные уже собираются, включая историю.
        </CardContent>
      </Card>
    );
  }

  const conversion =
    data.landingVisitors7d > 0 ? Math.round((newTutors7d / data.landingVisitors7d) * 100) : null;

  return (
    <Card animate={false}>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">До регистрации · 7 дней</CardTitle>
        <p className="text-sm text-muted-foreground">
          Агрегаты Яндекс.Метрики (лендинг репетитора). Поимённая воронка начинается ниже — с
          регистрации.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center flex-wrap gap-1 overflow-x-auto touch-pan-x">
          <Step label="Визит лендинга" value={data.landingVisitors7d} deltaValue={data.deltas.landingVisitors} />
          <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
          <Step label="Клик CTA" value={data.ctaClicks7d} deltaValue={data.deltas.ctaClicks} />
          <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
          <Step label="Открыл форму" value={data.signupFormOpens7d} deltaValue={data.deltas.signupFormOpens} />
          <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
          <Step label="Регистрация" value={newTutors7d} deltaValue={0} />
          {conversion != null && (
            <div className="ml-2 text-sm text-muted-foreground whitespace-nowrap">
              визит → регистрация: <span className="font-semibold tabular-nums">{conversion}%</span>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-4 flex-wrap text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <QrCode className="w-4 h-4 text-amber-600" aria-hidden="true" />
            QR Егора (/egor): <span className="font-semibold tabular-nums">{num(data.qrVisits7d)}</span>{" "}
            {delta(data.deltas.qrVisits)}
          </span>
          {data.missingGoals.length > 0 && (
            <span className="text-amber-700 text-xs">
              ⚠ {data.missingGoals.length} цел{data.missingGoals.length === 1 ? "ь" : "и/ей"} не
              заведено в Метрике — клики CTA занижены (создать: Цели → JavaScript-событие:{" "}
              {data.missingGoals.slice(0, 3).join(", ")}
              {data.missingGoals.length > 3 ? "…" : ""})
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
