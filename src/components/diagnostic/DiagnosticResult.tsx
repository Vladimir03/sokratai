import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  Target, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  ArrowRight,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import type { DiagnosticResult as DiagnosticResultType } from '@/hooks/useDiagnostic';
import { DIAGNOSTIC_COOLDOWN_DAYS } from '@/types/diagnostic';
import { cn } from '@/lib/utils';
import { Fragment } from 'react';
import { InlineMath, BlockMath } from 'react-katex';

interface DiagnosticResultProps {
  result: DiagnosticResultType;
  onStartPractice: (egeNumber?: number) => void;
  onRetake?: () => void;
  canRetake?: boolean;
  daysUntilRetake?: number;
}

// Функция для парсинга LaTeX в тексте
const parseLatex = (text: string) => {
  if (!text) return null;
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]+\$)/g);
  return parts.map((part, index) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      const latex = part.slice(2, -2).trim();
      return <BlockMath key={index} math={latex} />;
    } else if (part.startsWith('$') && part.endsWith('$')) {
      const latex = part.slice(1, -1);
      return <InlineMath key={index} math={latex} />;
    } else {
      return <Fragment key={index}>{part}</Fragment>;
    }
  });
};

function getScoreMessage(testScore: number): { emoji: string; message: string } {
  if (testScore >= 55) return { emoji: '🎉', message: 'Отличный результат! Ты на верном пути к высокому баллу.' };
  if (testScore >= 40) return { emoji: '👍', message: 'Хороший уровень! Есть над чем поработать для роста.' };
  if (testScore >= 25) return { emoji: '💪', message: 'Есть база! Регулярные тренировки дадут результат.' };
  return { emoji: '🚀', message: 'Начало положено! Системная подготовка — ключ к успеху.' };
}

export function DiagnosticResult({
  result,
  onStartPractice,
  onRetake,
  canRetake = false,
  daysUntilRetake = DIAGNOSTIC_COOLDOWN_DAYS,
}: DiagnosticResultProps) {
  const { emoji, message } = getScoreMessage(result.testScore);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      {/* Main score card */}
      <Card className="border-2 border-primary/20 bg-primary/5 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        
        <CardHeader className="text-center relative">
          <div className="text-5xl mb-2">{emoji}</div>
          <CardTitle className="text-3xl md:text-4xl font-bold">
            {result.testScore} баллов
          </CardTitle>
          <p className="text-muted-foreground">
            Прогноз за первую часть ЕГЭ
          </p>
        </CardHeader>

        <CardContent className="relative">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <Target className="w-4 h-4 text-primary mx-auto mb-1" />
              <div className="text-xl font-bold">{result.correctAnswers}/{result.totalQuestions}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-tighter">Верно</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <TrendingUp className="w-4 h-4 text-primary mx-auto mb-1" />
              <div className="text-xl font-bold">{result.primaryScore}/12</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-tighter">Первичных</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <Clock className="w-4 h-4 text-primary mx-auto mb-1" />
              <div className="text-xl font-bold">{result.timeSpentMinutes}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-tighter">Минут</div>
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>

      {/* Recommendation block */}
      {result.recommendedTopic && (
        <Card className="border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg shrink-0">
                <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">Рекомендация</h3>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Начни с задания <strong>№{result.recommendedTopic.ege_number}</strong> «{result.recommendedTopic.topic_name}». 
                  Это даст максимальный прирост балла.
                </p>
              </div>
            </div>
            
            <Button 
              onClick={() => onStartPractice(result.recommendedTopic!.ege_number)}
              className="w-full mt-4 gap-2"
              size="lg"
            >
              Начать тренировку №{result.recommendedTopic.ege_number}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Detailed breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Детальный разбор
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.answersBreakdown?.map((item, index) => (
            <div 
              key={index}
              className={cn(
                "p-4 rounded-xl border flex flex-col gap-2 transition-all",
                item.isCorrect ? "bg-green-50/50 border-green-100" : "bg-red-50/50 border-red-100"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                    item.isCorrect ? "bg-green-500 text-white" : "bg-red-500 text-white"
                  )}>
                    {index + 1}
                  </div>
                  <span className="font-bold text-sm">№{item.problem.ege_number}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">{item.problem.topic}</span>
                </div>
                {item.isCorrect ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
              </div>
              
              <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none italic text-muted-foreground">
                {parseLatex(item.problem.condition_text)}
              </div>

              <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-dashed border-muted-foreground/20">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block mb-0.5">Твой ответ</span>
                  <span className={cn("font-medium", item.isCorrect ? "text-green-700" : "text-red-700")}>
                    {item.userAnswer || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold block mb-0.5">Верно</span>
                  <span className="text-green-700 font-medium">{item.problem.correct_answer}</span>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button onClick={() => onStartPractice()} className="w-full gap-2" size="lg">
          Начать подготовку
          <ArrowRight className="w-4 h-4" />
        </Button>

        {canRetake && onRetake ? (
          <Button onClick={onRetake} variant="outline" className="w-full gap-2">
            <RotateCcw className="w-4 h-4" />
            Пройти заново
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-muted text-xs text-muted-foreground">
            <AlertCircle className="w-3 h-3" />
            Пересдача через {daysUntilRetake} {pluralize(daysUntilRetake || 0, ['день', 'дня', 'дней'])}
          </div>
        )}
      </div>
    </div>
  );
}

function pluralize(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
