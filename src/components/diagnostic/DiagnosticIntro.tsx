import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, Clock, BarChart3, Lightbulb, ArrowRight, RotateCcw } from 'lucide-react';
import { DIAGNOSTIC_TOTAL_QUESTIONS, DIAGNOSTIC_COOLDOWN_DAYS } from '@/types/diagnostic';

interface DiagnosticIntroProps {
  onStart: () => void;
  onContinue?: () => void;
  onViewResults?: () => void;
  hasExistingSession?: boolean;
  hasLastResult?: boolean;
  remainingQuestions?: number;
  isLoading?: boolean;
  canRetake?: boolean;
  daysUntilRetake?: number;
}

export function DiagnosticIntro({
  onStart,
  onContinue,
  onViewResults,
  hasExistingSession = false,
  hasLastResult = false,
  remainingQuestions = 0,
  isLoading = false,
  canRetake = true,
  daysUntilRetake = 0,
}: DiagnosticIntroProps) {
  const features = [
    {
      icon: Target,
      title: `${DIAGNOSTIC_TOTAL_QUESTIONS} заданий`,
      description: 'По всем темам первой части ЕГЭ',
    },
    {
      icon: Clock,
      title: '15-20 минут',
      description: 'Без ограничения по времени',
    },
    {
      icon: BarChart3,
      title: 'Прогноз балла',
      description: 'Узнай свой текущий уровень',
    },
    {
      icon: Lightbulb,
      title: 'Рекомендации',
      description: 'Поймёшь с чего начать подготовку',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Target className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl md:text-3xl font-bold">
            Узнай свой уровень
          </CardTitle>
          <p className="text-muted-foreground mt-2">
            Пройди диагностику и получи персональные рекомендации
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Features grid */}
          <div className="grid grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
              >
                <div className="p-2 rounded-md bg-primary/10">
                  <feature.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium text-sm">{feature.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {feature.description}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            {hasExistingSession && onContinue ? (
              <>
                <Button
                  onClick={onContinue}
                  size="lg"
                  className="w-full gap-2"
                  disabled={isLoading}
                >
                  <RotateCcw className="w-4 h-4" />
                  Продолжить ({remainingQuestions} осталось)
                </Button>
                <Button
                  onClick={onStart}
                  variant="outline"
                  size="lg"
                  className="w-full gap-2"
                  disabled={isLoading}
                >
                  Начать заново
                </Button>
              </>
            ) : canRetake ? (
              <Button
                onClick={onStart}
                size="lg"
                className="w-full gap-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  'Загрузка...'
                ) : (
                  <>
                    Начать диагностику
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            ) : (
              <div className="text-center p-4 rounded-lg bg-muted">
                <p className="text-muted-foreground">
                  Пересдача доступна через{' '}
                  <span className="font-bold text-foreground">
                    {daysUntilRetake} {daysUntilRetake === 1 ? 'день' : daysUntilRetake < 5 ? 'дня' : 'дней'}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Можно пересдавать раз в {DIAGNOSTIC_COOLDOWN_DAYS} дней
                </p>
              </div>
            )}

            {hasLastResult && onViewResults && !hasExistingSession && (
              <Button
                onClick={onViewResults}
                variant="ghost"
                className="w-full text-primary hover:text-primary hover:bg-primary/5"
              >
                Посмотреть прошлый результат
              </Button>
            )}
          </div>

          {/* Note */}
          <p className="text-center text-xs text-muted-foreground">
            Можно прерваться и продолжить позже
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

