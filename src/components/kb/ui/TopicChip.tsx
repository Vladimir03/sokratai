import { cn } from "@/lib/utils";

export interface TopicChipProps {
  label: string;
  className?: string;
}

export function TopicChip({ label, className }: TopicChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg bg-socrat-border-light",
        "px-2.5 py-0.5 text-xs font-medium text-gray-500",
        className,
      )}
    >
      {label}
    </span>
  );
}
