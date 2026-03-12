import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KBSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function KBSearchInput({
  value,
  onChange,
  placeholder = "Поиск...",
  className,
}: KBSearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search
        size={18}
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-socrat-muted pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-xl border-[1.5px] border-socrat-border bg-socrat-card",
          "py-2.5 pl-[42px] pr-4 text-sm font-body",
          "text-[16px] sm:text-sm",
          "placeholder:text-socrat-muted",
          "transition-colors duration-200",
          "focus:border-socrat-primary focus:outline-none",
        )}
      />
    </div>
  );
}
