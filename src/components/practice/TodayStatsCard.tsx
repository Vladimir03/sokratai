import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Flame, Zap, Check, X, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const incorrectToday = stats.problems_solved_today - stats.correct_today;

  return (
    <Card className="w-full bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-indigo-500/20">
      <CardContent className="pt-4">
        <TooltipProvider>
          <div className="grid grid-cols-4 gap-2 text-center">
            {/* Streak */}
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-1">
                <Flame className="w-5 h-5 text-orange-500" />
              </div>
              <span className="text-lg font-bold">{stats.current_streak}</span>
              <span className="text-[10px] text-muted-foreground">дней</span>
            </div>

            {/* Верно */}
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-1">
                <Check className="w-5 h-5 text-green-500" />
              </div>
              <span className="text-lg font-bold text-green-600 dark:text-green-400">{stats.correct_today}</span>
              <span className="text-[10px] text-muted-foreground">верно</span>
            </div>

            {/* Неверно */}
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-1">
                <X className="w-5 h-5 text-red-500" />
              </div>
              <span className="text-lg font-bold text-red-600 dark:text-red-400">{incorrectToday}</span>
              <span className="text-[10px] text-muted-foreground">неверно</span>
            </div>

            {/* Точность с tooltip */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center cursor-help">
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-1 relative">
                    <Zap className="w-5 h-5 text-purple-500" />
                    <Info className="w-3 h-3 text-muted-foreground absolute -top-0.5 -right-0.5" />
                  </div>
                  <span className="text-lg font-bold">{accuracy}%</span>
                  <span className="text-[10px] text-muted-foreground">точность</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[200px] text-center">
                <p className="text-xs">
                  <strong>Точность</strong> — процент верных ответов от всех попыток за сегодня.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.correct_today} верных ÷ {stats.problems_solved_today} попыток = {accuracy}%
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

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

