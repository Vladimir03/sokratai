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
          const count = problemCounts[egeNum] || 10;
          const isEnabled = enabledNumbers.includes(egeNum);
          const isMastered = progress && progress.accuracy >= 100;
          const isRecommended = recommendedNumber === egeNum;
          const accuracy = progress?.accuracy || 0;
          
          // Статусы для точек (путь Duolingo)
          const problemStatuses = Object.values(progress?.problem_statuses || {});
          const steps = Array.from({ length: count }).map((_, i) => {
            return problemStatuses[i] || 'none';
          });

          return (
            <button
              key={egeNum}
              onClick={() => isEnabled && onSelect(egeNum)}
              disabled={!isEnabled}
              className={`
                relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 
                transition-all duration-200 
                ${isEnabled 
                  ? 'hover:scale-105 hover:shadow-xl cursor-pointer' 
                  : 'opacity-50 cursor-not-allowed'}
                ${isRecommended 
                  ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 ring-2 ring-yellow-400/50 shadow-lg shadow-yellow-200/50' 
                  : isMastered 
                    ? 'border-green-400 bg-green-50 dark:bg-green-950/30' 
                    : 'border-border bg-card hover:border-primary/50'}
              `}
            >
              {/* Иконки статуса */}
              {isMastered && (
                <CheckCircle2 className="absolute top-2 right-2 w-5 h-5 text-green-500" />
              )}
              {isRecommended && (
                <Star className="absolute top-2 left-2 w-5 h-5 text-yellow-500 fill-yellow-500 animate-pulse" />
              )}
              {!isEnabled && (
                <Lock className="absolute top-2 right-2 w-4 h-4 text-muted-foreground" />
              )}

              {/* Номер и Название */}
              <span className="text-3xl font-black mb-1">{egeNum}</span>
              <span className="text-[11px] text-muted-foreground text-center font-medium leading-tight mb-3 line-clamp-1">
                {data.name}
              </span>

              {/* Путь в стиле Duolingo (точки) */}
              <div className="flex flex-wrap justify-center gap-1.5 mb-3 max-w-[100px] bg-slate-50 dark:bg-slate-900/50 p-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                {steps.map((status, i) => (
                  <div 
                    key={i}
                    className={`w-3 h-3 rounded-full border shadow-sm transition-all duration-500 hover:scale-125 ${
                      status === 'correct' ? 'bg-green-500 border-green-600 shadow-green-200' :
                      status === 'incorrect' ? 'bg-red-500 border-red-600 shadow-red-200' :
                      'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-600'
                    }`}
                    title={status === 'correct' ? 'Решено верно' : status === 'incorrect' ? 'Ошибка' : 'Еще не решено'}
                  />
                ))}
              </div>
              
              {/* Процент прогресса */}
              <div className="flex flex-col items-center">
                <span className={`text-sm font-bold ${accuracy >= 100 ? 'text-green-600' : 'text-primary'}`}>
                  {accuracy}%
                </span>
                <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">
                  пройдено
                </span>
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

