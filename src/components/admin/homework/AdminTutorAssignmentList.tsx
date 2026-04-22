import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Search, BookOpen, ChevronRight } from "lucide-react";
import {
  fetchAssignmentsByTutor,
  formatRelativeTime,
  type AssignmentOverview,
} from "@/lib/adminHomeworkApi";

interface Props {
  tutorId: string;
  onSelectAssignment: (assignment: AssignmentOverview) => void;
  reloadKey?: number;
}

export const AdminTutorAssignmentList = ({ tutorId, onSelectAssignment, reloadKey }: Props) => {
  const [items, setItems] = useState<AssignmentOverview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchAssignmentsByTutor(tutorId);
        if (!cancelled) setItems(data);
      } catch (err) {
        console.error("[AdminTutorAssignmentList] fetch error", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tutorId, reloadKey]);

  const q = search.trim().toLowerCase();
  const filtered = q ? items.filter((a) => a.title.toLowerCase().includes(q)) : items;

  return (
    <Card>
      <CardContent className="p-4 md:p-6">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию ДЗ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>{q ? "Ничего не найдено" : "У этого репетитора нет ДЗ"}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((a) => {
              const pct = a.totalStudents > 0 ? Math.round((a.completedStudents / a.totalStudents) * 100) : 0;
              return (
                <button
                  key={a.assignmentId}
                  onClick={() => onSelectAssignment(a)}
                  className="w-full text-left flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <BookOpen className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{a.title}</span>
                      {a.subject && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{a.subject}</Badge>}
                      {a.examType && <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">{a.examType}</Badge>}
                      <Badge variant={a.status === "active" ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">
                        {a.status === "active" ? "Активно" : a.status === "draft" ? "Черновик" : "Завершено"}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{a.completedStudents}/{a.totalStudents} учеников сдали</span>
                        <span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                      <div className="flex gap-3 text-[11px] text-muted-foreground">
                        <span>
                          <span className="text-emerald-700 font-medium">{a.completedStudents}</span> сдали
                        </span>
                        <span>
                          <span className="text-amber-700 font-medium">{a.inProgressStudents}</span> в процессе
                        </span>
                        <span>
                          <span className="text-muted-foreground font-medium">{a.notStartedStudents}</span> не приступали
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-0.5 min-w-0 max-w-[180px]">
                    {a.lastMessageAt ? (
                      <>
                        <div className="text-xs font-medium truncate w-full">
                          {a.lastMessageStudentName || "—"}
                        </div>
                        {a.lastMessagePreview && (
                          <div className="text-[11px] text-muted-foreground truncate w-full">
                            {a.lastMessagePreview}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(a.lastMessageAt)}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">Нет сообщений</div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-3" />
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
