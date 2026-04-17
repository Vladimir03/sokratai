import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { Sunrise } from "lucide-react";

export interface MorningReviewItem {
  threadId: string;
  tutorName: string;
  studentName: string;
  assignmentTitle: string;
  status: string;
  lastStudentActivity: string | null;
  totalHints: number;
  totalAttempts: number;
  tutorIntervened: boolean;
  attentionReasons: string[];
}

interface Props {
  items: MorningReviewItem[];
}

const formatLast = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ru });
  } catch {
    return "—";
  }
};

export const MorningReviewQueue = ({ items }: Props) => {
  return (
    <Card animate={false}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sunrise className="w-4 h-4 text-amber-600" />
          Очередь утреннего просмотра
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          До 30 тредов, требующих внимания репетитора. Сортировка: severity × свежесть. Оперативная метрика.
        </p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Нет тредов, требующих внимания. 🎉
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Репетитор</TableHead>
                  <TableHead className="text-xs">Ученик</TableHead>
                  <TableHead className="text-xs">ДЗ</TableHead>
                  <TableHead className="text-xs">Статус</TableHead>
                  <TableHead className="text-xs">Активность</TableHead>
                  <TableHead className="text-xs text-right">Подск.</TableHead>
                  <TableHead className="text-xs text-right">Попыт.</TableHead>
                  <TableHead className="text-xs">Вмеш.</TableHead>
                  <TableHead className="text-xs">Причина</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.threadId}>
                    <TableCell className="text-sm font-medium">{it.tutorName}</TableCell>
                    <TableCell className="text-sm">{it.studentName}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{it.assignmentTitle}</TableCell>
                    <TableCell>
                      <Badge variant={it.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                        {it.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatLast(it.lastStudentActivity)}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">{it.totalHints}</TableCell>
                    <TableCell className="text-sm text-right tabular-nums">{it.totalAttempts}</TableCell>
                    <TableCell>
                      {it.tutorIntervened ? (
                        <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">да</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {it.attentionReasons.map((r, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] font-normal">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
