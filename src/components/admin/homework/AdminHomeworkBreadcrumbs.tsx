import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
}

interface Props {
  segments: BreadcrumbSegment[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const AdminHomeworkBreadcrumbs = ({ segments, onRefresh, isRefreshing }: Props) => {
  return (
    <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
      <nav className="flex items-center gap-1 text-sm flex-wrap min-w-0">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <div key={i} className="flex items-center gap-1 min-w-0">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
              {isLast || !seg.onClick ? (
                <span className="font-semibold truncate max-w-[220px]" title={seg.label}>
                  {seg.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={seg.onClick}
                  className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]"
                  title={seg.label}
                >
                  {seg.label}
                </button>
              )}
            </div>
          );
        })}
      </nav>
      {onRefresh && (
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      )}
    </div>
  );
};
