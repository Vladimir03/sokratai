import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PulseStageTutorList } from "./PulseStageTutorList";
import type { PulseStage, PulseStageKey, PulseTutor } from "./pulseTypes";

const COMMERCIAL_KEYS = new Set<PulseStageKey>(["trial", "paid"]);
/** Независимые счётчики (НЕ монотонная цепочка): профиль + коммерческие. */
const INDEPENDENT_KEYS = new Set<PulseStageKey>(["profile_filled", "trial", "paid"]);

/** Подпись вторичного счётчика и заголовок раскрытия — по смыслу ступени (ревью P2 #9). */
const stuckNoun = (key: PulseStageKey): string =>
  key === "paid"
    ? "дошли"
    : key === "trial"
      ? "без оплаты"
      : key === "profile_filled"
        ? "без предметов"
        : "застряло";

const expandedTitle = (stage: PulseStage): string => {
  if (stage.key === "paid") return `Дошли до «${stage.label}»`;
  if (stage.key === "trial") return "В триале, но не оплатили";
  if (stage.key === "profile_filled") return "Профиль без предметов — кому написать";
  return `Застряли на «${stage.label}»`;
};

/**
 * Воронка активации: 6 поведенческих ступеней (монотонные, счёт «дошло ≥ k»)
 * + 2 независимые коммерческие («Триал»/«Оплата» — исторические факты, триал
 * выдаётся при регистрации автоматически и НЕ означает пройденной активации).
 * Клик по ступени раскрывает поимённый список — кандидатов на личное сообщение.
 */
export const PulseFunnel = ({
  funnel,
  onSetReferrer,
}: {
  funnel: PulseStage[];
  onSetReferrer?: (tutor: PulseTutor) => void;
}) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const total = funnel[0]?.reached ?? 0;
  const selected = funnel.find((s) => s.key === selectedKey) ?? null;

  return (
    <Card animate={false}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Воронка активации</CardTitle>
        <p className="text-sm text-muted-foreground">
          Кликни на ступень — увидишь, кто застрял именно на ней. «Профиль: предметы»,
          «Триал» и «Оплата» — независимые счётчики, не часть поведенческой цепочки.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2">
          {funnel.map((stage, idx) => {
            const share = total > 0 ? stage.reached / total : 0;
            const active = stage.key === selectedKey;
            const isCommercial = COMMERCIAL_KEYS.has(stage.key);
            const isIndependent = INDEPENDENT_KEYS.has(stage.key);
            const noun = stuckNoun(stage.key);
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
                    : isIndependent
                      ? "border-dashed border-slate-300 bg-slate-50/50 hover:bg-socrat-surface"
                      : "border-slate-200 bg-white hover:bg-socrat-surface",
                )}
                style={{ touchAction: "manipulation" }}
              >
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight">
                  {isCommercial ? "₽ " : isIndependent ? "" : `${idx + 1}. `}
                  {stage.label}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums">{stage.reached}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", isCommercial ? "bg-emerald-500" : "bg-accent")}
                    style={{ width: `${Math.max(share * 100, stage.reached > 0 ? 4 : 0)}%` }}
                  />
                </div>
                {stage.stuck.length > 0 && (
                  <div
                    className={cn(
                      "mt-1.5 text-[11px] tabular-nums",
                      stage.key === "paid" ? "text-emerald-700" : "text-amber-700",
                    )}
                  >
                    {noun}: {stage.stuck.length}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-sm font-semibold text-slate-900 mb-1">
              {expandedTitle(selected)} · {selected.stuck.length}
            </h4>
            <PulseStageTutorList
              tutors={selected.stuck}
              emptyText="Никто не застрял на этой ступени — все прошли дальше."
              onSetReferrer={onSetReferrer}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
