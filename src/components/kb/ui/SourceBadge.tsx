import { cn } from "@/lib/utils";

export interface SourceBadgeProps {
  source: "socrat" | "my";
  className?: string;
}

const variants = {
  socrat: "bg-socrat-primary-light text-socrat-primary",
  my: "bg-socrat-accent-light text-socrat-accent",
} as const;

const labels = {
  socrat: "Каталог",
  my: "Моя",
} as const;

export function SourceBadge({ source, className }: SourceBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        variants[source],
        className,
      )}
    >
      {labels[source]}
    </span>
  );
}
