import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AuthGuard from "@/components/AuthGuard";
import { TrendingUp, Target, Award, Flame } from "lucide-react";
import { PageContent } from "@/components/PageContent";
import { useUserProgress, useTodayStats } from "@/hooks/usePractice";
import { EGE_NUMBERS } from "@/types/practice";

const Progress = () => {
  const { data: userProgress = {}, isLoading: isLoadingPractice } = useUserProgress();
  const { data: todayStats, isLoading: isLoadingStats } = useTodayStats();

  // Агрегированные данные из тренажёра
  const practiceArray = Object.values(userProgress);
  const totalSolved = practiceArray.reduce((acc, curr) => acc + curr.total_attempts, 0);
  const totalCorrect = practiceArray.reduce((acc, curr) => acc + curr.correct_attempts, 0);
  const totalAccuracy = totalSolved > 0 ? Math.round((totalCorrect / totalSolved) * 100) : 0;

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6">
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-2">Ваш прогресс</h1>
            <p className="text-muted-foreground">Отслеживайте свои достижения в тренажёре</p>
          </div>

          {(isLoadingPractice || isLoadingStats) ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Main Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                <Card className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/20 dark:to-background border-indigo-100 dark:border-indigo-900/50">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
                      Всего задач
                    </CardTitle>
                    <Target className="w-4 h-4 text-indigo-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl md:text-3xl font-bold">{totalSolved}</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-orange-50 to-white dark:from-orange-950/20 dark:to-background border-orange-100 dark:border-orange-900/50">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
                      Streak
                    </CardTitle>
                    <Flame className="w-4 h-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl md:text-3xl font-bold">{todayStats?.current_streak || 0} дн.</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-background border-green-100 dark:border-green-900/50">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
                      Точность
                    </CardTitle>
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl md:text-3xl font-bold">{totalAccuracy}%</div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-background border-amber-100 dark:border-amber-900/50">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
                      Прогноз ЕГЭ
                    </CardTitle>
                    <Award className="w-4 h-4 text-amber-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl md:text-3xl font-bold">
                      {Math.round(totalAccuracy * 0.8 + Math.min(totalSolved / 10, 20))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Practice Progress */}
              <Card className="shadow-elegant overflow-hidden">
                <CardHeader className="bg-muted/30">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="w-5 h-5 text-primary" />
                    Прогресс по номерам ЕГЭ
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  {practiceArray.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      Начните тренировку в тренажёре, чтобы увидеть статистику
                    </p>
                  ) : (
                    <div className="grid gap-6">
                      {practiceArray.map((item) => {
                        const egeInfo = EGE_NUMBERS[item.ege_number];
                        return (
                          <div key={item.ege_number} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary">
                                  {item.ege_number}
                                </div>
                                <div>
                                  <span className="font-semibold">{egeInfo.name}</span>
                                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                    {item.total_attempts} попыток • {item.current_difficulty === 1 ? 'Лёгкий' : item.current_difficulty === 2 ? 'Средний' : 'Сложный'}
                                  </p>
                                </div>
                              </div>
                              <span className="text-sm font-bold">{item.accuracy}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className="bg-primary h-2 rounded-full transition-all duration-1000"
                                style={{ width: `${item.accuracy}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Achievements */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: "🔥", label: "Первые шаги", desc: "1 задача", active: totalSolved >= 1 },
                  { icon: "🎯", label: "Стрелок", desc: "10 задач", active: totalSolved >= 10 },
                  { icon: "🧠", label: "Знаток", desc: "80% точность", active: totalAccuracy >= 80 && totalSolved >= 5 },
                  { icon: "🏆", label: "Легенда", desc: "100 задач", active: totalSolved >= 100 },
                ].map((ach, i) => (
                  <Card key={i} className={`text-center p-4 transition-all duration-500 ${ach.active ? 'bg-primary/5 border-primary/20 scale-100' : 'opacity-40 grayscale scale-95'}`}>
                    <div className="text-3xl mb-2">{ach.icon}</div>
                    <div className="text-sm font-bold">{ach.label}</div>
                    <div className="text-xs text-muted-foreground uppercase">{ach.desc}</div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </PageContent>
    </AuthGuard>
  );
};

export default Progress;
