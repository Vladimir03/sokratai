import { MoreVertical, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  trigger?: React.ReactNode;
  className?: string;
}

export function ContextMenu({ items, trigger, className }: ContextMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              "flex items-center justify-center rounded-lg border border-socrat-border",
              "bg-transparent p-1.5 cursor-pointer",
              "hover:bg-socrat-surface transition-colors duration-200",
              className,
            )}
          >
            <MoreVertical size={14} className="text-socrat-muted" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.key}
              onSelect={item.onSelect}
              className={cn(
                "flex items-center gap-2 cursor-pointer text-[13px]",
                item.destructive && "text-red-600 focus:text-red-600",
              )}
            >
              {Icon && (
                <Icon
                  size={14}
                  className={cn(
                    "shrink-0",
                    item.destructive
                      ? "text-red-600"
                      : "text-socrat-muted",
                  )}
                />
              )}
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
