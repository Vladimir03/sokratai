import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Flame, Target, Zap, TrendingUp } from "lucide-react";
import type { TodayStats } from "@/types/practice";
import { motion, AnimatePresence } from "framer-motion";
import { ConfettiBurst } from "@/components/ConfettiBurst";
import { haptics } from "@/utils/haptics";

interface TodayStatsCardProps {
  stats: TodayStats;
}

export const TodayStatsCard = ({ stats }: TodayStatsCardProps) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const [displayedStreak, setDisplayedStreak] = useState(stats.current_streak);
  const prevStreakRef = useRef(stats.current_streak);

  const goalProgress = Math.min(
    (stats.problems_solved_today / stats.daily_goal_problems) * 100, 
    100
  );
  
  const accuracy = stats.problems_solved_today > 0 
    ? Math.round((stats.correct_today / stats.problems_solved_today) * 100)
    : 0;

  // Эффект при увеличении стрейка
  useEffect(() => {
    if (stats.current_streak > prevStreakRef.current) {
      haptics.success();
      setShowConfetti(true);
      
      // Небольшая задержка перед обновлением числа для эффекта
      setTimeout(() => {
        setDisplayedStreak(stats.current_streak);
      }, 500);
    } else {
      setDisplayedStreak(stats.current_streak);
    }
    prevStreakRef.current = stats.current_streak;
  }, [stats.current_streak]);

  return (
    <Card className="w-full bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border-emerald-500/20 overflow-hidden relative">
      <ConfettiBurst active={showConfetti} onComplete={() => setShowConfetti(false)} />
      
      <CardContent className="pt-4">
        <div className="grid grid-cols-4 gap-2 text-center">
          {/* Streak */}
          <div className="flex flex-col items-center relative">
            <motion.div 
              animate={displayedStreak > 0 ? {
                scale: [1, 1.2, 1],
                filter: ["drop-shadow(0 0 0px #ffaa00)", "drop-shadow(0 0 10px #ffaa00)", "drop-shadow(0 0 0px #ffaa00)"]
              } : {}}
              transition={{ repeat: Infinity, duration: 2 }}
              className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 ${
                displayedStreak > 0 ? 'bg-orange-500 shadow-lg shadow-orange-500/50' : 'bg-orange-100 dark:bg-orange-900/30'
              }`}
            >
              <Flame className={`w-5 h-5 ${displayedStreak > 0 ? 'text-white' : 'text-orange-500'}`} />
            </motion.div>
            
            <AnimatePresence mode="wait">
              <motion.span
                key={displayedStreak}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                className={`text-lg font-bold ${displayedStreak > 0 ? 'text-orange-600' : ''}`}
              >
                {displayedStreak}
              </motion.span>
            </AnimatePresence>
            <span className="text-xs text-muted-foreground font-medium">дней</span>
          </div>

          {/* Решено сегодня */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-1 text-blue-500">
              <Target className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold">{stats.problems_solved_today}</span>
            <span className="text-xs text-muted-foreground font-medium">решено</span>
          </div>

          {/* Точность */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-1 text-green-500">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold">{accuracy}%</span>
            <span className="text-xs text-muted-foreground font-medium">точность</span>
          </div>

          {/* XP */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-1 text-amber-500">
              <Zap className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold">{stats.xp_today}</span>
            <span className="text-xs text-muted-foreground font-medium">XP</span>
          </div>
        </div>

        {/* Прогресс дневной цели */}
        <div className="mt-4 px-1">
          <div className="flex justify-between text-xs uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
            <span>Дневная цель</span>
            <span className={stats.problems_solved_today >= stats.daily_goal_problems ? 'text-green-600' : ''}>
              {stats.problems_solved_today}/{stats.daily_goal_problems}
            </span>
          </div>
          <div className="relative h-2.5 w-full bg-secondary rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${goalProgress}%` }}
              className={`h-full transition-all ${
                goalProgress >= 100 
                  ? 'bg-gradient-to-r from-orange-400 to-yellow-400' 
                  : 'bg-primary'
              }`}
            />
            {goalProgress >= 100 && (
              <motion.div
                animate={{ x: ['-100%', '200%'] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className="absolute inset-0 bg-white/30 skew-x-12"
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TodayStatsCard;
