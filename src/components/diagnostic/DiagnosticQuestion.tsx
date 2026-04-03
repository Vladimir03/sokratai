import { useState, useEffect, useRef, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Send, Clock } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import type { EgeProblem } from '@/types/practice';
import { EGE_NUMBERS } from '@/types/practice';

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

interface DiagnosticQuestionProps {
  problem: EgeProblem;
  questionNumber: number;
  totalQuestions: number;
  onSubmit: (answer: string) => void;
  onBack: () => void;
  isSubmitting?: boolean;
}

export function DiagnosticQuestion({
  problem,
  questionNumber,
  totalQuestions,
  onSubmit,
  onBack,
  isSubmitting = false,
}: DiagnosticQuestionProps) {
  const [answer, setAnswer] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<Date>(new Date());

  // Таймер
  useEffect(() => {
    startTimeRef.current = new Date();
    setElapsedTime(0);
    setAnswer('');

    const timer = setInterval(() => {
      setElapsedTime(Math.floor((new Date().getTime() - startTimeRef.current.getTime()) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [problem.id]);

  // Фокус на инпут
  useEffect(() => {
    inputRef.current?.focus();
  }, [problem.id]);

  const handleSubmit = () => {
    if (answer.trim() && !isSubmitting) {
      onSubmit(answer.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && answer.trim() && !isSubmitting) {
      handleSubmit();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = (questionNumber / totalQuestions) * 100;
  const topicName = EGE_NUMBERS[problem.ege_number]?.name || `Задание ${problem.ege_number}`;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Выход
        </Button>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          {formatTime(elapsedTime)}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            Вопрос {questionNumber} из {totalQuestions}
          </span>
          <span className="text-sm text-muted-foreground">
            {Math.round(progressPercent)}%
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Question card */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded-md">
              №{problem.ege_number}
            </span>
            <span className="text-sm text-muted-foreground">
              {topicName}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Question text */}
          <div className="text-base leading-relaxed prose prose-sm dark:prose-invert max-w-none">
            {parseLatex(problem.condition_text)}
          </div>

          {/* Question image if exists */}
          {problem.condition_image_url && (
            <div className="flex justify-center">
              <img
                src={problem.condition_image_url}
                alt="Изображение к задаче"
                className="max-w-full max-h-64 rounded-lg border"
                loading="lazy"
              />
            </div>
          )}

          {/* Answer input */}
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                type="text"
                placeholder="Введите ответ"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                className="text-lg h-12"
              />
              <Button
                onClick={handleSubmit}
                disabled={!answer.trim() || isSubmitting}
                size="lg"
                className="px-6 h-12"
              >
                {isSubmitting ? (
                  'Проверка...'
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Ответить
                  </>
                )}
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Ответы сохраняются без показа результата до конца диагностики
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

