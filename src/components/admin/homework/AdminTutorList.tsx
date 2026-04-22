import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, GraduationCap, ChevronRight, Users, BookOpen } from "lucide-react";
import {
  fetchTutorsOverview,
  formatRelativeTime,
  type TutorOverview,
} from "@/lib/adminHomeworkApi";

interface Props {
  onSelectTutor: (tutor: TutorOverview) => void;
  reloadKey?: number;
}

export const AdminTutorList = ({ onSelectTutor, reloadKey }: Props) => {
  const [tutors, setTutors] = useState<TutorOverview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchTutorsOverview();
        if (!cancelled) setTutors(data);
      } catch (err) {
        console.error("[AdminTutorList] fetch error", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? tutors.filter((t) =>
        t.tutorName.toLowerCase().includes(q) ||
        (t.telegramUsername || "").toLowerCase().includes(q),
      )
    : tutors;

  return (
    <Card>
      <CardContent className="p-4 md:p-6">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или @username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <GraduationCap className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>{q ? "Ничего не найдено" : "Пока нет репетиторов с домашками"}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((t) => (
              <button
                key={t.tutorId}
                onClick={() => onSelectTutor(t)}
                className="w-full text-left flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{t.tutorName}</span>
                    {t.telegramUsername && (
                      <span className="text-xs text-muted-foreground">@{t.telegramUsername}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                    <Badge variant="outline" className="h-5 px-1.5 gap-1">
                      <BookOpen className="w-3 h-3" />
                      ДЗ: {t.totalAssignments} · <span className="text-emerald-700">{t.activeAssignments}</span> акт. · <span className="text-muted-foreground">{t.completedAssignments}</span> зав.
                    </Badge>
                    <Badge variant="outline" className="h-5 px-1.5 gap-1">
                      <Users className="w-3 h-3" />
                      {t.totalStudents} учеников · <span className="text-emerald-700">{t.activeStudents7d}</span> за 7д
                    </Badge>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end gap-0.5 min-w-0 max-w-[200px]">
                  {t.lastActivityAt ? (
                    <>
                      <div className="text-xs font-medium truncate w-full">
                        {t.lastActivityStudentName || "—"}
                      </div>
                      {t.lastActivityPreview && (
                        <div className="text-[11px] text-muted-foreground truncate w-full">
                          {t.lastActivityPreview}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(t.lastActivityAt)}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">Нет активности</div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
