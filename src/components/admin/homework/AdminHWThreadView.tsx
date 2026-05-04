import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { fetchThreadDetails } from "@/lib/adminHomeworkApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MathText } from "@/components/kb/ui/MathText";
import {
  User,
  Bot,
  MessageSquare,
  CheckCircle2,
  Clock,
  Lightbulb,
  AlertCircle,
} from "lucide-react";

export interface AdminThreadHeader {
  id: string;
  status: string;
  studentName: string;
  assignmentTitle: string;
  assignmentSubject: string;
}

interface ThreadMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  message_kind: string | null;
  visible_to_student: boolean;
  image_url: string | null;
  task_order: number | null;
  author_user_id: string | null;
}

interface TaskState {
  id: string;
  status: string;
  hint_count: number;
  wrong_answer_count: number;
  earned_score: number | null;
  available_score: number | null;
  task_id: string;
}

const MESSAGE_KIND_LABELS: Record<string, { label: string; color: string }> = {
  system: { label: "Введение", color: "bg-blue-100 text-blue-700" },
  hint_request: { label: "Подсказка", color: "bg-amber-100 text-amber-700" },
  check_result: { label: "Проверка", color: "bg-emerald-100 text-emerald-700" },
  question: { label: "Вопрос", color: "bg-purple-100 text-purple-700" },
  tutor_note: { label: "Заметка", color: "bg-rose-100 text-rose-700" },
};

export function AdminHWThreadView({ thread }: { thread: AdminThreadHeader }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [taskStates, setTaskStates] = useState<TaskState[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const { messages: msgs, taskStates: states } = await fetchThreadDetails(thread.id);
        if (!cancelled) {
          setMessages(msgs || []);
          setTaskStates(states || []);
        }
      } catch (err) {
        console.error("Error loading thread data:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [thread.id]);

  const completedTasks = taskStates.filter((ts) => ts.status === "completed").length;
  const totalTasks = taskStates.length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg">{thread.studentName}</CardTitle>
            <p className="text-sm text-muted-foreground truncate">
              {thread.assignmentTitle} • {thread.assignmentSubject}
            </p>
          </div>
          <Badge variant={thread.status === "active" ? "default" : "secondary"}>
            {thread.status === "active" ? "Активен" : "Завершён"}
          </Badge>
        </div>

        {totalTasks > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Прогресс задач</span>
              <span>{completedTasks}/{totalTasks}</span>
            </div>
            <Progress value={progressPct} className="h-2" />
            <div className="flex gap-2 flex-wrap mt-1">
              {taskStates.map((ts, i) => (
                <Badge
                  key={ts.id}
                  variant="outline"
                  className={`text-[10px] h-5 ${
                    ts.status === "completed"
                      ? "border-emerald-400 text-emerald-700"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {ts.status === "completed" ? (
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                  ) : (
                    <Clock className="w-3 h-3 mr-0.5" />
                  )}
                  №{i + 1}
                  {ts.hint_count > 0 && (
                    <span className="ml-1 flex items-center">
                      <Lightbulb className="w-2.5 h-2.5" />
                      {ts.hint_count}
                    </span>
                  )}
                  {ts.wrong_answer_count > 0 && (
                    <span className="ml-1 flex items-center">
                      <AlertCircle className="w-2.5 h-2.5" />
                      {ts.wrong_answer_count}
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Сообщений нет</div>
        ) : (
          <ScrollArea className="h-[400px] md:h-[600px]">
            <div className="p-4 space-y-3">
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const isSystem = msg.role === "system";
                const kindInfo = msg.message_kind ? MESSAGE_KIND_LABELS[msg.message_kind] : null;
                return (
                  <div key={msg.id} className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                    {!isUser && (
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                        {isSystem ? (
                          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <Bot className="w-3.5 h-3.5 text-primary" />
                        )}
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : isSystem
                          ? "bg-muted/50 border border-dashed border-muted-foreground/20"
                          : "bg-muted"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        {kindInfo && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${kindInfo.color}`}>
                            {kindInfo.label}
                          </span>
                        )}
                        {!msg.visible_to_student && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 font-medium">
                            Скрыто
                          </span>
                        )}
                        {msg.task_order != null && (
                          <span className="text-[10px] text-muted-foreground">Задача {msg.task_order}</span>
                        )}
                      </div>
                      {msg.image_url && (
                        <div className="mb-2">
                          <img
                            src={msg.image_url}
                            alt="Вложение"
                            className="max-w-full max-h-48 rounded-md object-contain"
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}
                      <MathText
                        text={msg.content}
                        className={`text-sm break-words whitespace-pre-wrap ${isUser ? "text-primary-foreground" : ""}`}
                      />
                      <div className={`text-xs mt-1 ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {format(parseISO(msg.created_at), "d MMM, HH:mm", { locale: ru })}
                      </div>
                    </div>
                    {isUser && (
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
