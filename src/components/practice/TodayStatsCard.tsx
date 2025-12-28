import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Flame, Target, Zap, TrendingUp } from "lucide-react";
import type { TodayStats } from "@/types/practice";

interface TodayStatsCardProps {
  stats: TodayStats;
}

export const TodayStatsCard = ({ stats }: TodayStatsCardProps) => {
  const goalProgress = Math.min(
    (stats.problems_solved_today / stats.daily_goal_problems) * 100, 
    100
  );
  const accuracy = stats.problems_solved_today > 0 
    ? Math.round((stats.correct_today / stats.problems_solved_today) * 100)
    : 0;

  return (
    <Card className="w-full bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-indigo-500/20">
      <CardContent className="pt-4">
        <div className="grid grid-cols-4 gap-2 text-center">
          {/* Streak */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-1">
              <Flame className="w-5 h-5 text-orange-500" />
            </div>
            <span className="text-lg font-bold">{stats.current_streak}</span>
            <span className="text-[10px] text-muted-foreground">дней</span>
          </div>

          {/* Решено сегодня */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-1">
              <Target className="w-5 h-5 text-blue-500" />
            </div>
            <span className="text-lg font-bold">{stats.problems_solved_today}</span>
            <span className="text-[10px] text-muted-foreground">решено</span>
          </div>

          {/* Точность */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-1">
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <span className="text-lg font-bold">{accuracy}%</span>
            <span className="text-[10px] text-muted-foreground">точность</span>
          </div>

          {/* XP */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-1">
              <Zap className="w-5 h-5 text-purple-500" />
            </div>
            <span className="text-lg font-bold">{stats.xp_today}</span>
            <span className="text-[10px] text-muted-foreground">XP</span>
          </div>
        </div>

        {/* Прогресс дневной цели */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Дневная цель</span>
            <span>{stats.problems_solved_today}/{stats.daily_goal_problems}</span>
          </div>
          <Progress value={goalProgress} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
};

export default TodayStatsCard;

