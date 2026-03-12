import { cn } from "@/lib/utils";

export interface ExamBadgeProps {
  exam: "ege" | "oge";
  className?: string;
}

const variants = {
  ege: "bg-socrat-ege-bg text-socrat-ege",
  oge: "bg-socrat-oge-bg text-socrat-oge",
} as const;

const labels = {
  ege: "ЕГЭ",
  oge: "ОГЭ",
} as const;

export function ExamBadge({ exam, className }: ExamBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        variants[exam],
        className,
      )}
    >
      {labels[exam]}
    </span>
  );
}
