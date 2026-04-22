import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { User, Users, ChevronRight } from "lucide-react";
import {
  fetchStudentsInAssignment,
  formatRelativeTime,
  type AssignmentStudentRow,
} from "@/lib/adminHomeworkApi";

interface Props {
  assignmentId: string;
  onSelectStudent: (row: AssignmentStudentRow) => void;
  reloadKey?: number;
}

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "Активен", variant: "default" },
  completed: { label: "Завершён", variant: "secondary" },
  not_started: { label: "Не приступал", variant: "outline" },
};

export const AdminAssignmentStudentList = ({ assignmentId, onSelectStudent, reloadKey }: Props) => {
  const [items, setItems] = useState<AssignmentStudentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchStudentsInAssignment(assignmentId);
        if (!cancelled) setItems(data);
      } catch (err) {
        console.error("[AdminAssignmentStudentList] fetch error", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assignmentId, reloadKey]);

  return (
    <Card>
      <CardContent className="p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>В этом ДЗ ещё нет назначенных учеников</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((s) => {
              const st = STATUS_LABEL[s.status] || STATUS_LABEL.not_started;
              const clickable = s.threadId !== null;
              return (
                <button
                  key={s.studentAssignmentId}
                  onClick={() => clickable && onSelectStudent(s)}
                  disabled={!clickable}
                  className={`w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors border border-transparent ${
                    clickable
                      ? "hover:bg-muted/50 cursor-pointer hover:border-border"
                      : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{s.studentName}</span>
                      <Badge variant={st.variant} className="h-5 px-1.5 text-[10px]">{st.label}</Badge>
                    </div>
                    {s.lastMessagePreview && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {s.lastMessagePreview}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex flex-col items-end gap-0.5">
                    <div className="text-xs text-muted-foreground">{s.messageCount} сообщ.</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(s.lastMessageAt)}
                    </div>
                  </div>
                  {clickable && <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
