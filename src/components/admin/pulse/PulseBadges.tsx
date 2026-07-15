import { cn } from "@/lib/utils";
import type { PulseChannelInfo } from "./pulseTypes";

/** Бейдж канала привлечения (общий для воронки и списков). */
export const ChannelBadge = ({ channel }: { channel: PulseChannelInfo }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
      channel.kind === "egor" && "border-amber-200 bg-amber-50 text-amber-900",
      channel.kind === "ref" && "border-sky-200 bg-sky-50 text-sky-900",
      channel.kind === "web" && "border-slate-200 bg-slate-50 text-slate-600",
    )}
  >
    {channel.label}
  </span>
);

/** Бейдж платёжного статуса репетитора. */
export const PlanBadge = ({ isPaying, isTrial }: { isPaying: boolean; isTrial: boolean }) => {
  if (isPaying) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900 whitespace-nowrap">
        Платит
      </span>
    );
  }
  if (isTrial) {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-900 whitespace-nowrap">
        Триал
      </span>
    );
  }
  return null;
};
