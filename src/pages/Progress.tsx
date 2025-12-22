import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { TrendingUp, CheckCircle, Target, Award } from "lucide-react";
import { PageContent } from "@/components/PageContent";

interface Stats {
  totalSolved: number;
  correctCount: number;
  accuracy: number;
  categoriesStats: Record<string, { solved: number; correct: number }>;
}

const Progress = () => {
  const [stats, setStats] = useState<Stats>({
    totalSolved: 0,
    correctCount: 0,
    accuracy: 0,
    categoriesStats: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user solutions
      const { data: solutions, error: solutionsError } = await supabase
        .from("user_solutions")
        .select("*")
        .eq("user_id", user.id);

      if (solutionsError) throw solutionsError;

      // Get problems data from public view
      const { data: problems, error: problemsError } = await supabase
        .from("problems_public")
        .select("id, topic");

      if (problemsError) throw problemsError;

      const totalSolved = solutions?.length || 0;
      const correctCount = solutions?.filter(s => s.is_correct).length || 0;
      const accuracy = totalSolved > 0 ? Math.round((correctCount / totalSolved) * 100) : 0;

      // Create a map of problem_id to topic
      const problemTopicMap = new Map(problems?.map(p => [p.id, p.topic]) || []);

      const categoriesStats: Record<string, { solved: number; correct: number }> = {};
      
      solutions?.forEach(sol => {
        const topic = problemTopicMap.get(sol.problem_id) || "Прочее";
        if (!categoriesStats[topic]) {
          categoriesStats[topic] = { solved: 0, correct: 0 };
        }
        categoriesStats[topic].solved += 1;
        if (sol.is_correct) categoriesStats[topic].correct += 1;
      });

      setStats({ totalSolved, correctCount, accuracy, categoriesStats });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Ваш прогресс</h1>
          <p className="text-muted-foreground">Отслеживайте свои достижения</p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Main Stats */}
            <div className="grid md:grid-cols-4 gap-6">
              <Card className="bg-gradient-card shadow-elegant">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Решено задач
                  </CardTitle>
                  <CheckCircle className="w-4 h-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.totalSolved}</div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-card shadow-elegant">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Процент правильных
                  </CardTitle>
                  <TrendingUp className="w-4 h-4 text-accent" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.accuracy}%</div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-card shadow-elegant">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Правильных ответов
                  </CardTitle>
                  <Target className="w-4 h-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.correctCount}</div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-card shadow-elegant">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Прогноз балла ЕГЭ
                  </CardTitle>
                  <Award className="w-4 h-4 text-accent" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {stats.totalSolved > 0 
                      ? Math.round((stats.correctCount / stats.totalSolved) * 100 * 0.6)
                      : 0}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Categories Stats */}
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-primary" />
                  Детальная статистика по темам
                </CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(stats.categoriesStats).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    Решите первую задачу, чтобы увидеть статистику
                  </p>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(stats.categoriesStats).map(([category, data]) => {
                      const categoryAccuracy = Math.round((data.correct / data.solved) * 100);
                      return (
                        <div key={category} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{category}</span>
                            <span className="text-sm text-muted-foreground">
                              {data.correct}/{data.solved} ({categoryAccuracy}%)
                            </span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full transition-all duration-500"
                              style={{ width: `${categoryAccuracy}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Achievements Placeholder */}
            <Card className="shadow-elegant">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-accent" />
                  Достижения
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-4xl mb-2">🔥</div>
                    <div className="text-sm font-medium">Первые шаги</div>
                    <div className="text-xs text-muted-foreground">Решите 1 задачу</div>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                    <div className="text-4xl mb-2">⭐</div>
                    <div className="text-sm font-medium">Мастер</div>
                    <div className="text-xs text-muted-foreground">Решите 10 задач</div>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                    <div className="text-4xl mb-2">💎</div>
                    <div className="text-sm font-medium">Эксперт</div>
                    <div className="text-xs text-muted-foreground">90% точности</div>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                    <div className="text-4xl mb-2">🏆</div>
                    <div className="text-sm font-medium">Легенда</div>
                    <div className="text-xs text-muted-foreground">100 задач</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      </PageContent>
    </AuthGuard>
  );
};

export default Progress;
