import { useNavigate } from "react-router-dom";
import { Plus, BookOpen, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeworkSet, PRIORITY_CONFIG, SUBJECTS, HomeworkTask } from "@/types/homework";
import { format, isToday, isTomorrow } from "date-fns";
import { ru } from "date-fns/locale";

type HomeworkSetWithTasks = HomeworkSet & {
  homework_tasks: HomeworkTask[];
};

const Homework = () => {
  const navigate = useNavigate();

  const { data: homeworkSets, isLoading } = useQuery({
    queryKey: ["homework-sets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_sets")
        .select(`
          *,
          homework_tasks (*)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as HomeworkSetWithTasks[];
    },
  });

  const getSubjectEmoji = (subject: string) => {
    const subjectItem = SUBJECTS.find(
      (s) => s.name.toLowerCase() === subject.toLowerCase()
    );
    return subjectItem?.emoji || "📝";
  };

  const formatDeadline = (deadline: string) => {
    const date = new Date(deadline);
    if (isToday(date)) return "Сегодня";
    if (isTomorrow(date)) return "Завтра";
    return format(date, "d MMMM", { locale: ru });
  };

  const pluralizeTasks = (count: number) => {
    if (count === 1) return "задача";
    if (count >= 2 && count <= 4) return "задачи";
    return "задач";
  };

  const hasTasksWithoutConditions = (tasks: HomeworkTask[]) => {
    return tasks.some(
      (task) => !task.condition_text && !task.condition_photo_url
    );
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="container mx-auto px-4 pt-20 pb-24 md:pb-8">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  Домашние задания
                </h1>
                <p className="text-muted-foreground mt-1">
                  Управляйте своими домашними заданиями
                </p>
              </div>
              <Button
                onClick={() => navigate("/homework/add")}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </Button>
            </div>

            {/* Homework List */}
            <div className="grid gap-4">
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Загрузка...
                </div>
              ) : homeworkSets?.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                    <BookOpen className="w-16 h-16 text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold mb-2">
                      Нет домашних заданий
                    </h3>
                    <p className="text-muted-foreground mb-6">
                      Добавьте первое домашнее задание
                    </p>
                    <Button onClick={() => navigate("/homework/add")}>
                      <Plus className="w-4 h-4 mr-2" />
                      Добавить задание
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                homeworkSets?.map((homework) => {
                  const priorityConfig = PRIORITY_CONFIG[homework.priority];
                  const taskCount = homework.homework_tasks?.length || 0;
                  const needsConditions = hasTasksWithoutConditions(
                    homework.homework_tasks || []
                  );
                  const subjectEmoji = getSubjectEmoji(homework.subject);

                  return (
                    <Card
                      key={homework.id}
                      className="hover:shadow-elegant transition-all cursor-pointer group"
                      onClick={() => navigate(`/homework/${homework.id}`)}
                    >
                      <CardHeader className="pb-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{subjectEmoji}</span>
                            <CardTitle className="text-xl">
                              {homework.subject}
                            </CardTitle>
                          </div>
                          <Badge variant="secondary">
                            {priorityConfig.emoji} {priorityConfig.label}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-2">
                          {homework.topic}
                        </p>
                        
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-3">
                          {taskCount > 0 && (
                            <span>
                              {taskCount} {pluralizeTasks(taskCount)}
                            </span>
                          )}
                          {homework.deadline && (
                            <>
                              {taskCount > 0 && <span>•</span>}
                              <span>{formatDeadline(homework.deadline)}</span>
                            </>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="pt-0 space-y-3">
                        {needsConditions && taskCount > 0 && (
                          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                            <AlertTriangle className="w-4 h-4" />
                            <span>Задачи нужны условия</span>
                          </div>
                        )}
                        
                        <Button
                          className="w-full group-hover:bg-primary/90 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/homework/${homework.id}`);
                          }}
                        >
                          Начать
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </CardContent>
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

export default Homework;
