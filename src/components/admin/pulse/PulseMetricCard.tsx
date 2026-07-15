import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Generic-карточка метрики Пульса — перенос business/BusinessMetricCard.tsx
 * (вкладка «Бизнес» удалена; компонент живёт здесь).
 */
interface Props {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  tooltip: string;
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
  active?: boolean;
}

export const PulseMetricCard = ({ title, value, sub, tooltip, tone = "default", onClick, active }: Props) => {
  const toneClass = {
    default: "",
    good: "border-emerald-200 bg-emerald-50/50",
    warn: "border-amber-200 bg-amber-50/50",
    bad: "border-rose-200 bg-rose-50/50",
  }[tone];

  const clickable = typeof onClick === "function";

  return (
    <Card
      className={cn(
        "h-full transition-shadow",
        toneClass,
        clickable && "cursor-pointer hover:shadow-md",
        active && "ring-2 ring-primary ring-offset-2",
      )}
      animate={false}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <CardContent className="p-4 flex flex-col h-full">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-2">
          <span className="font-medium uppercase tracking-wide">{title}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Как считается метрика"
                  className="opacity-60 hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="text-3xl font-bold leading-tight tabular-nums">{value}</div>
        {sub && <div className="text-sm text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
};
