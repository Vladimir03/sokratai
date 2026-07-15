import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PulseStageTutorList } from "./PulseStageTutorList";
import type { PulseStage } from "./pulseTypes";

/**
 * Воронка активации 1..8. Счётчик ступени = «дошло ≥ k» (монотонно убывает);
 * клик по ступени раскрывает список «застрявших ровно здесь» — кандидатов
 * на личное сообщение.
 */
export const PulseFunnel = ({ funnel }: { funnel: PulseStage[] }) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const total = funnel[0]?.reached ?? 0;
  const selected = funnel.find((s) => s.key === selectedKey) ?? null;
  const isLastStage = selected != null && funnel[funnel.length - 1]?.key === selected.key;

  return (
    <Card animate={false}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Воронка активации</CardTitle>
        <p className="text-sm text-muted-foreground">
          Кликни на ступень — увидишь, кто застрял именно на ней.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {funnel.map((stage, idx) => {
            const share = total > 0 ? stage.reached / total : 0;
            const active = stage.key === selectedKey;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => setSelectedKey(active ? null : stage.key)}
                aria-pressed={active}
                className={cn(
                  "text-left rounded-lg border p-3 min-h-[44px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  active
                    ? "border-accent bg-accent/5"
                    : "border-slate-200 bg-white hover:bg-socrat-surface",
                )}
                style={{ touchAction: "manipulation" }}
              >
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                  {idx + 1}. {stage.label}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums">{stage.reached}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(share * 100, stage.reached > 0 ? 4 : 0)}%` }}
                  />
                </div>
                {stage.stuck.length > 0 && (
                  <div className="mt-1.5 text-[11px] text-amber-700 tabular-nums">
                    застряло: {stage.stuck.length}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-sm font-semibold text-slate-900 mb-1">
              {isLastStage ? `Дошли до «${selected.label}»` : `Застряли на «${selected.label}»`} · {selected.stuck.length}
            </h4>
            <PulseStageTutorList
              tutors={selected.stuck}
              emptyText="Никто не застрял на этой ступени — все прошли дальше."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
