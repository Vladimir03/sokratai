import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeworkSet, HomeworkTask } from "@/types/homework";

const HomeworkTaskList = () => {
  const { id } = useParams();
  const navigate = useNavigate();

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

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      not_started: { label: "Не начато", variant: "secondary" as const },
      in_progress: { label: "В процессе", variant: "default" as const },
      completed: { label: "Выполнено", variant: "outline" as const },
    };
    return statusConfig[status as keyof typeof statusConfig] || statusConfig.not_started;
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="container mx-auto px-4 pt-20 pb-24 md:pb-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/homework")}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1">
                <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  {homework?.subject}
                </h1>
                <p className="text-muted-foreground mt-1">{homework?.topic}</p>
              </div>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Добавить задачу
              </Button>
            </div>

            {/* Task List */}
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
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Добавить задачу
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                tasks?.map((task) => {
                  const statusBadge = getStatusBadge(task.status);
                  return (
                    <Card
                      key={task.id}
                      className="hover:shadow-elegant transition-all cursor-pointer"
                      onClick={() =>
                        navigate(`/homework/${id}/task/${task.id}`)
                      }
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <CardTitle className="text-xl">
                                Задача {task.task_number}
                              </CardTitle>
                              <Badge variant={statusBadge.variant}>
                                {statusBadge.label}
                              </Badge>
                            </div>
                            {task.condition_text && (
                              <p className="text-muted-foreground line-clamp-2">
                                {task.condition_text}
                              </p>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
};

export default HomeworkTaskList;
