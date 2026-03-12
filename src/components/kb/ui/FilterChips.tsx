import { cn } from "@/lib/utils";

export interface FilterChipOption {
  key: string;
  label: string;
  activeClassName?: string;
}

export interface FilterChipsProps {
  options: FilterChipOption[];
  selected: string;
  onChange: (key: string) => void;
  className?: string;
}

export function FilterChips({
  options,
  selected,
  onChange,
  className,
}: FilterChipsProps) {
  return (
    <div
      className={cn(
        "flex rounded-xl bg-socrat-border-light p-1",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = selected === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "flex-1 rounded-[10px] px-4 py-2.5 text-sm font-medium",
              "transition-all duration-200 cursor-pointer",
              isActive
                ? cn("bg-socrat-card font-semibold shadow-sm", option.activeClassName)
                : "bg-transparent text-socrat-muted hover:text-gray-600",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
