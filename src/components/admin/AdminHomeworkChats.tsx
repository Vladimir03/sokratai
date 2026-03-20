import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MathText } from "@/components/kb/ui/MathText";
import {
  Search,
  BookOpen,
  ArrowLeft,
  User,
  Bot,
  MessageSquare,
  CheckCircle2,
  Clock,
  Lightbulb,
  AlertCircle,
} from "lucide-react";

interface ThreadListItem {
  id: string;
  status: string;
  updated_at: string;
  last_student_message_at: string | null;
  student_assignment_id: string;
  studentName: string;
  studentId: string;
  assignmentTitle: string;
  assignmentSubject: string;
  messageCount: number;
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

export const AdminHomeworkChats = () => {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedThread, setSelectedThread] = useState<ThreadListItem | null>(null);

  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch all threads
      const { data: threadsData, error: threadsErr } = await supabase
        .from("homework_tutor_threads")
        .select("id, status, updated_at, last_student_message_at, student_assignment_id")
        .order("updated_at", { ascending: false });

      if (threadsErr) throw threadsErr;
      if (!threadsData?.length) {
        setThreads([]);
        return;
      }

      // 2. Get student_assignment links
      const saIds = [...new Set(threadsData.map((t) => t.student_assignment_id))];
      const { data: saData, error: saErr } = await supabase
        .from("homework_tutor_student_assignments")
        .select("id, student_id, assignment_id")
        .in("id", saIds);
      if (saErr) throw saErr;

      const saMap = new Map(saData?.map((sa) => [sa.id, sa]) || []);

      // 3. Get assignment details
      const assignmentIds = [...new Set((saData || []).map((sa) => sa.assignment_id))];
      const { data: assignmentsData } = await supabase
        .from("homework_tutor_assignments")
        .select("id, title, subject")
        .in("id", assignmentIds);

      const assignmentMap = new Map(assignmentsData?.map((a) => [a.id, a]) || []);

      // 4. Get profiles
      const studentIds = [...new Set((saData || []).map((sa) => sa.student_id))];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, telegram_username")
        .in("id", studentIds);

      const profileMap = new Map(profilesData?.map((p) => [p.id, p]) || []);

      // 5. Count messages per thread
      const threadIds = threadsData.map((t) => t.id);
      const { data: msgCounts } = await supabase
        .from("homework_tutor_thread_messages")
        .select("thread_id")
        .in("thread_id", threadIds);

      const countMap: Record<string, number> = {};
      msgCounts?.forEach((m) => {
        countMap[m.thread_id] = (countMap[m.thread_id] || 0) + 1;
      });

      // 6. Assemble
      const result: ThreadListItem[] = threadsData
        .map((t) => {
          const sa = saMap.get(t.student_assignment_id);
          if (!sa) return null;
          const assignment = assignmentMap.get(sa.assignment_id);
          const profile = profileMap.get(sa.student_id);

          const displayName = profile?.telegram_username
            ? `@${profile.telegram_username}`
            : profile?.username || "Неизвестный";

          return {
            id: t.id,
            status: t.status,
            updated_at: t.updated_at,
            last_student_message_at: t.last_student_message_at,
            student_assignment_id: t.student_assignment_id,
            studentName: displayName,
            studentId: sa.student_id,
            assignmentTitle: assignment?.title || "Без названия",
            assignmentSubject: assignment?.subject || "",
            messageCount: countMap[t.id] || 0,
          } satisfies ThreadListItem;
        })
        .filter(Boolean) as ThreadListItem[];

      setThreads(result);
    } catch (err) {
      console.error("Error fetching homework threads:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredThreads = threads.filter((t) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.studentName.toLowerCase().includes(q) ||
      t.assignmentTitle.toLowerCase().includes(q)
    );
  });

  const activeThreads = filteredThreads.filter((t) => t.status === "active");
  const completedThreads = filteredThreads.filter((t) => t.status === "completed");

  if (selectedThread) {
    return (
      <AdminHWThreadView
        thread={selectedThread}
        onBack={() => setSelectedThread(null)}
      />
    );
  }

  const ThreadList = ({ items }: { items: ThreadListItem[] }) => (
    <ScrollArea className="h-[600px]">
      <div className="space-y-1">
        {items.map((t) => (
          <div
            key={t.id}
            onClick={() => setSelectedThread(t)}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-medium">{t.studentName}</div>
                <div className="text-sm text-muted-foreground truncate max-w-[240px]">
                  {t.assignmentTitle}
                </div>
              </div>
            </div>
            <div className="text-right flex flex-col items-end gap-1">
              <Badge
                variant={t.status === "active" ? "default" : "secondary"}
                className="text-[10px] h-4 px-1.5"
              >
                {t.status === "active" ? "Активен" : "Завершён"}
              </Badge>
              <div className="text-xs text-muted-foreground">
                {t.messageCount} сообщ. •{" "}
                {format(parseISO(t.updated_at), "d MMM, HH:mm", { locale: ru })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Переписки по ДЗ
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или названию ДЗ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Переписки по ДЗ не найдены</p>
          </div>
        ) : (
          <Tabs defaultValue="all" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="all">Все ({filteredThreads.length})</TabsTrigger>
              <TabsTrigger value="active">Активные ({activeThreads.length})</TabsTrigger>
              <TabsTrigger value="completed">Завершённые ({completedThreads.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              <ThreadList items={filteredThreads} />
            </TabsContent>
            <TabsContent value="active">
              {activeThreads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Нет активных тредов</div>
              ) : (
                <ThreadList items={activeThreads} />
              )}
            </TabsContent>
            <TabsContent value="completed">
              {completedThreads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Нет завершённых тредов</div>
              ) : (
                <ThreadList items={completedThreads} />
              )}
            </TabsContent>
          </Tabs>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Всего тредов: {filteredThreads.length}
        </div>
      </CardContent>
    </Card>
  );
};

/* ─── Detail view ─── */

function AdminHWThreadView({
  thread,
  onBack,
}: {
  thread: ThreadListItem;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [taskStates, setTaskStates] = useState<TaskState[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, [thread.id]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [msgsRes, statesRes] = await Promise.all([
        supabase
          .from("homework_tutor_thread_messages")
          .select("id, role, content, created_at, message_kind, visible_to_student, image_url, task_order, author_user_id")
          .eq("thread_id", thread.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("homework_tutor_task_states")
          .select("id, status, hint_count, wrong_answer_count, earned_score, available_score, task_id")
          .eq("thread_id", thread.id),
      ]);

      if (msgsRes.error) throw msgsRes.error;
      setMessages(msgsRes.data || []);
      setTaskStates(statesRes.data || []);
    } catch (err) {
      console.error("Error loading thread data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const completedTasks = taskStates.filter((ts) => ts.status === "completed").length;
  const totalTasks = taskStates.length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
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

        {/* Task progress */}
        {totalTasks > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Прогресс задач</span>
              <span>
                {completedTasks}/{totalTasks}
              </span>
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
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Сообщений нет</div>
        ) : (
          <ScrollArea className="h-[600px]">
            <div className="p-4 space-y-3">
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const isSystem = msg.role === "system";
                const kindInfo = msg.message_kind
                  ? MESSAGE_KIND_LABELS[msg.message_kind]
                  : null;

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                  >
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
                      {/* Badges row */}
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        {kindInfo && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${kindInfo.color}`}
                          >
                            {kindInfo.label}
                          </span>
                        )}
                        {!msg.visible_to_student && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 font-medium">
                            Скрыто
                          </span>
                        )}
                        {msg.task_order != null && (
                          <span className="text-[10px] text-muted-foreground">
                            Задача {msg.task_order}
                          </span>
                        )}
                      </div>

                      {/* Image */}
                      {msg.image_url && (
                        <div className="mb-2">
                          <img
                            src={msg.image_url}
                            alt="Вложение"
                            className="max-w-full max-h-48 rounded-md object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}

                      {/* Content */}
                      <MathText
                        text={msg.content}
                        className={`text-sm break-words whitespace-pre-wrap ${
                          isUser ? "text-primary-foreground" : ""
                        }`}
                      />

                      <div
                        className={`text-xs mt-1 ${
                          isUser ? "text-primary-foreground/70" : "text-muted-foreground"
                        }`}
                      >
                        {format(parseISO(msg.created_at), "d MMM, HH:mm", {
                          locale: ru,
                        })}
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
