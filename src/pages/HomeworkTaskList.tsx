import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, AlertTriangle, Calendar, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import AddTaskDialog from "@/components/AddTaskDialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { HomeworkSet, HomeworkTask, PRIORITY_CONFIG } from "@/types/homework";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

const HomeworkTaskList = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  const { data: homework } = useQuery({
    queryKey: ["homework-set", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_sets")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as HomeworkSet;
    },
  });

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["homework-tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_tasks")
        .select("*")
        .eq("homework_set_id", id)
        .order("task_number");

      if (error) throw error;
      return data as HomeworkTask[];
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from("homework_tasks")
        .delete()
        .eq("id", taskId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homework-tasks", id] });
      toast.success("Задача успешно удалена");
      setTaskToDelete(null);
    },
    onError: (error) => {
      console.error("Error deleting task:", error);
      toast.error("Не удалось удалить задачу");
    },
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      not_started: { label: "Не начато", variant: "secondary" as const, emoji: "⚪" },
      in_progress: { label: "В процессе", variant: "default" as const, emoji: "🟡" },
      completed: { label: "Выполнено", variant: "outline" as const, emoji: "🟢" },
    };
    return statusConfig[status as keyof typeof statusConfig] || statusConfig.not_started;
  };

  const completedCount = tasks?.filter(task => task.status === 'completed').length || 0;
  const totalCount = tasks?.length || 0;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="container mx-auto px-4 pt-20 pb-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <Card>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate("/homework")}
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                        {homework?.subject}
                      </h1>
                      {homework && (
                        <Badge variant="secondary">
                          {PRIORITY_CONFIG[homework.priority].emoji}{" "}
                          {PRIORITY_CONFIG[homework.priority].label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground">{homework?.topic}</p>
                    {homework?.deadline && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                        <Calendar className="w-4 h-4" />
                        <span>
                          Сдать до:{" "}
                          {format(new Date(homework.deadline), "d MMMM yyyy", {
                            locale: ru,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Task List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Задачи:</h2>
                <div className="flex items-center gap-2">
                  {totalCount > 0 && (
                    <Badge variant="outline" className="text-sm">
                      Прогресс: {completedCount}/{totalCount}
                    </Badge>
                  )}
                  <Button 
                    onClick={() => setIsAddTaskOpen(true)}
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Добавить задачу
                  </Button>
                </div>
              </div>

              <div className="grid gap-4">
                {isLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Загрузка...
                  </div>
                ) : tasks?.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <h3 className="text-xl font-semibold mb-2">
                        Нет задач
                      </h3>
                      <p className="text-muted-foreground mb-6">
                        Добавьте первую задачу к этому домашнему заданию
                      </p>
                      <Button onClick={() => setIsAddTaskOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Добавить задачу
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  tasks?.map((task) => {
                    const statusBadge = getStatusBadge(task.status);
                    const needsCondition = !task.condition_text && !task.condition_photo_url;
                    
                    return (
                      <Card
                        key={task.id}
                        className="hover:shadow-elegant transition-all"
                      >
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-3">
                              <div className="flex items-center gap-2">
                                <h3 className="text-xl font-semibold">
                                  Задача {task.task_number}
                                </h3>
                                <Badge variant={statusBadge.variant}>
                                  {statusBadge.emoji} {statusBadge.label}
                                </Badge>
                              </div>
                              
                              {task.condition_text && (
                                <p className="text-muted-foreground line-clamp-2">
                                  {task.condition_text}
                                </p>
                              )}
                              
                              {needsCondition && (
                                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                                  <AlertTriangle className="w-4 h-4" />
                                  <span>Нужно условие</span>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <Button
                                onClick={() => setTaskToDelete(task.id)}
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                              <Button
                                onClick={() => navigate(`/homework/${id}/task/${task.id}`)}
                                variant="default"
                              >
                                Начать решать →
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </main>
        
        <AddTaskDialog 
          open={isAddTaskOpen}
          onOpenChange={setIsAddTaskOpen}
          homeworkSetId={id!}
        />

        <AlertDialog open={!!taskToDelete} onOpenChange={() => setTaskToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
              <AlertDialogDescription>
                Это действие нельзя отменить. Задача и все связанные с ней данные будут удалены навсегда.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => taskToDelete && deleteTaskMutation.mutate(taskToDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AuthGuard>
  );
};

export default HomeworkTaskList;
