import { useNavigate } from "react-router-dom";
import { Plus, Calendar, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeworkSet, PRIORITY_CONFIG } from "@/types/homework";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const Homework = () => {
  const navigate = useNavigate();

  const { data: homeworkSets, isLoading } = useQuery({
    queryKey: ["homework-sets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_sets")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as HomeworkSet[];
    },
  });

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
                  return (
                    <Card
                      key={homework.id}
                      className="hover:shadow-elegant transition-all cursor-pointer"
                      onClick={() => navigate(`/homework/${homework.id}`)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <CardTitle className="text-xl">
                                {homework.subject}
                              </CardTitle>
                              <Badge variant="secondary">
                                {priorityConfig.emoji} {priorityConfig.label}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground">
                              {homework.topic}
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      {homework.deadline && (
                        <CardContent>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="w-4 h-4" />
                            <span>
                              Сдать до:{" "}
                              {format(new Date(homework.deadline), "d MMMM yyyy", {
                                locale: ru,
                              })}
                            </span>
                          </div>
                        </CardContent>
                      )}
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
