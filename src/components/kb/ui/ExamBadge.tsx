import { cn } from "@/lib/utils";
import type { ExamType, TopicKind } from "@/types/kb";

export interface ExamBadgeProps {
  /** NULL для олимпиадных тем (kind='olympiad'). */
  exam: ExamType | null;
  /** Если 'olympiad' — рисуем бейдж «Олимпиада» вместо ЕГЭ/ОГЭ. */
  kind?: TopicKind;
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

// Олимпиада — фиолетовый folder-токен (отличается от зелёного ЕГЭ / синего ОГЭ).
const OLYMPIAD_CLASS = "bg-socrat-folder-bg text-socrat-folder";

export function ExamBadge({ exam, kind, className }: ExamBadgeProps) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide";

  if (kind === "olympiad") {
    return <span className={cn(base, OLYMPIAD_CLASS, className)}>Олимпиада</span>;
  }

  if (!exam) return null;

  return <span className={cn(base, variants[exam], className)}>{labels[exam]}</span>;
}
