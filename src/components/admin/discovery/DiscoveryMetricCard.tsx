import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  tooltip: string;
  isProxy?: boolean;
  emphasize?: boolean;
  tone?: "default" | "good" | "warn" | "bad";
}

export const DiscoveryMetricCard = ({ title, value, sub, tooltip, isProxy, emphasize, tone = "default" }: Props) => {
  const toneClass = {
    default: "",
    good: "border-emerald-200 bg-emerald-50/50",
    warn: "border-amber-200 bg-amber-50/50",
    bad: "border-rose-200 bg-rose-50/50",
  }[tone];

  return (
    <Card
      className={cn(
        "h-full transition-all",
        toneClass,
        emphasize && "ring-1 ring-primary/30",
      )}
      animate={false}
    >
      <CardContent className="p-4 flex flex-col h-full">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-2">
          <span className="font-medium uppercase tracking-wide">{title}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="opacity-60 hover:opacity-100">
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className={cn("font-bold leading-tight", emphasize ? "text-4xl" : "text-3xl")}>{value}</div>
        {sub && <div className="text-sm text-muted-foreground mt-1">{sub}</div>}
        {isProxy && (
          <div className="mt-2 inline-flex items-center text-[10px] uppercase tracking-wide text-muted-foreground border border-dashed border-muted-foreground/40 rounded px-1.5 py-0.5 self-start">
            proxy
          </div>
        )}
      </CardContent>
    </Card>
  );
};
