import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Star, Lock } from "lucide-react";
import { EGE_NUMBERS, type EGENumber, type UserEgeProgress } from "@/types/practice";

interface EgeNumberGridProps {
  userProgress: Record<number, UserEgeProgress>;
  problemCounts: Record<number, number>;
  onSelect: (egeNumber: EGENumber) => void;
  recommendedNumber?: EGENumber;
  enabledNumbers?: EGENumber[];
}

export const EgeNumberGrid = ({
  userProgress,
  problemCounts,
  onSelect,
  recommendedNumber,
  enabledNumbers = [1, 2, 3, 4, 5, 6], // По умолчанию только 1-6 для MVP
}: EgeNumberGridProps) => {

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-bold mb-1">Выбери номер ЕГЭ</h2>
        <p className="text-sm text-muted-foreground">
          Начни с любого номера или следуй рекомендации
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {Object.entries(EGE_NUMBERS).map(([num, data]) => {
          const egeNum = parseInt(num) as EGENumber;
          const progress = userProgress[egeNum];
          const count = problemCounts[egeNum] || 0;
          const isEnabled = enabledNumbers.includes(egeNum);
          const isMastered = progress && progress.accuracy >= 80 && progress.total_attempts >= 5;
          const isRecommended = recommendedNumber === egeNum;
          const accuracy = progress?.accuracy || 0;

          return (
            <button
              key={egeNum}
              onClick={() => isEnabled && onSelect(egeNum)}
              disabled={!isEnabled}
              className={`
                relative flex flex-col items-center justify-center p-4 rounded-xl border-2 
                transition-all duration-200 
                ${isEnabled 
                  ? 'hover:scale-105 hover:shadow-lg cursor-pointer' 
                  : 'opacity-50 cursor-not-allowed'}
                ${isRecommended 
                  ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 ring-2 ring-yellow-400/50' 
                  : isMastered 
                    ? 'border-green-400 bg-green-50 dark:bg-green-950/30' 
                    : 'border-border bg-card hover:border-primary/50'}
              `}
            >
              {/* Иконки статуса */}
              {isMastered && (
                <CheckCircle2 className="absolute top-1 right-1 w-4 h-4 text-green-500" />
              )}
              {isRecommended && (
                <Star className="absolute top-1 left-1 w-4 h-4 text-yellow-500 fill-yellow-500" />
              )}
              {!isEnabled && (
                <Lock className="absolute top-1 right-1 w-4 h-4 text-muted-foreground" />
              )}

              {/* Номер */}
              <span className="text-2xl font-bold mb-1">{egeNum}</span>
              
              {/* Название (сокращённо) */}
              <span className="text-[10px] text-muted-foreground text-center leading-tight mb-2 line-clamp-1">
                {data.name}
              </span>

              {/* Прогресс бар */}
              <Progress 
                value={accuracy} 
                className="h-1.5 w-full"
              />
              
              {/* Статистика */}
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs font-medium">
                  {accuracy}%
                </span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    ({count})
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
          <span>Рекомендуется</span>
        </div>
        <div className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          <span>Освоено (80%+)</span>
        </div>
        <div className="flex items-center gap-1">
          <Lock className="w-3 h-3" />
          <span>Скоро</span>
        </div>
      </div>
    </div>
  );
};

export default EgeNumberGrid;

