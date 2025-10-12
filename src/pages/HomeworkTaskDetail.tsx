import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeworkTask, TaskStatus } from "@/types/homework";
import { toast } from "sonner";

const HomeworkTaskDetail = () => {
  const { homeworkId, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: task } = useQuery({
    queryKey: ["homework-task", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_tasks")
        .select("*")
        .eq("id", taskId)
        .single();

      if (error) throw error;
      return data as HomeworkTask;
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: TaskStatus) => {
      const { error } = await supabase
        .from("homework_tasks")
        .update({ status: newStatus })
        .eq("id", taskId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homework-task", taskId] });
      toast.success("Статус обновлен");
    },
    onError: () => {
      toast.error("Ошибка при обновлении статуса");
    },
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      not_started: { label: "Не начато", variant: "secondary" as const },
      in_progress: { label: "В процессе", variant: "default" as const },
      completed: { label: "Выполнено", variant: "outline" as const },
    };
    return statusConfig[status as keyof typeof statusConfig] || statusConfig.not_started;
  };

  if (!task) return null;

  const statusBadge = getStatusBadge(task.status);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="container mx-auto px-4 pt-20 pb-24 md:pb-8">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/homework/${homeworkId}`)}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1">
                <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  Задача {task.task_number}
                </h1>
              </div>
            </div>

            {/* Task Details */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Детали задачи</CardTitle>
                  <Badge variant={statusBadge.variant}>
                    {statusBadge.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {task.condition_text && (
                  <div>
                    <h3 className="font-semibold mb-2">Условие:</h3>
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {task.condition_text}
                    </p>
                  </div>
                )}

                {task.condition_photo_url && (
                  <div>
                    <h3 className="font-semibold mb-2">Фото условия:</h3>
                    <img
                      src={task.condition_photo_url}
                      alt="Условие задачи"
                      className="rounded-lg max-w-full"
                    />
                  </div>
                )}

                <div>
                  <h3 className="font-semibold mb-2">Статус выполнения:</h3>
                  <Select
                    value={task.status}
                    onValueChange={(value) => updateStatusMutation.mutate(value as TaskStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Не начато</SelectItem>
                      <SelectItem value="in_progress">В процессе</SelectItem>
                      <SelectItem value="completed">Выполнено</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button className="w-full gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Обсудить с ИИ-репетитором
                </Button>
              </CardContent>
            </Card>

            {/* AI Analysis */}
            {task.ai_analysis && (
              <Card>
                <CardHeader>
                  <CardTitle>Анализ задачи</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="font-semibold mb-1">Сложность:</h3>
                    <p className="text-muted-foreground">
                      {task.ai_analysis.difficulty}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Тип задачи:</h3>
                    <p className="text-muted-foreground">
                      {task.ai_analysis.type}
                    </p>
                  </div>
                  {task.ai_analysis.hints && task.ai_analysis.hints.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">Подсказки:</h3>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        {task.ai_analysis.hints.map((hint, idx) => (
                          <li key={idx}>{hint}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
};

export default HomeworkTaskDetail;
