import { cn } from "@/lib/utils";

export interface StatCounterProps {
  value: number;
  label: string;
  className?: string;
}

export function StatCounter({ value, label, className }: StatCounterProps) {
  return (
    <div className={cn("text-center", className)}>
      <div className="text-[22px] font-bold text-socrat-primary">{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}
