import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Bot, ArrowRight, BookOpen } from "lucide-react";
import type { CheckAnswerResult } from "@/types/practice";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import { Fragment } from 'react';

interface ResultCardProps {
  result: CheckAnswerResult;
  userAnswer: string;
  onNext: () => void;
  onAskSocrat: () => void;
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

export const ResultCard = ({ result, userAnswer, onNext, onAskSocrat }: ResultCardProps) => {
  return (
    <Card className={`w-full border-2 ${
      result.is_correct 
        ? 'border-green-500 bg-green-50 dark:bg-green-950/30' 
        : 'border-red-500 bg-red-50 dark:bg-red-950/30'
    }`}>
      <CardHeader className="pb-3">
        {result.is_correct ? (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <CardTitle className="text-green-700 dark:text-green-400 text-xl">
                Правильно! 🎉
              </CardTitle>
              <p className="text-sm text-green-600 dark:text-green-500">
                +10 XP
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center">
              <XCircle className="w-7 h-7 text-white" />
            </div>
            <div>
              <CardTitle className="text-red-700 dark:text-red-400 text-xl">
                Неправильно
              </CardTitle>
              <p className="text-sm text-red-600 dark:text-red-500">
                Не сдавайся, разберём вместе!
              </p>
            </div>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Ваш ответ vs правильный */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-white/50 dark:bg-black/20">
            <p className="text-xs text-muted-foreground mb-1">Ваш ответ</p>
            <p className={`font-mono text-lg ${
              result.is_correct ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
            }`}>
              {userAnswer}
            </p>
          </div>
          {!result.is_correct && (
            <div className="p-3 rounded-lg bg-white/50 dark:bg-black/20">
              <p className="text-xs text-muted-foreground mb-1">Правильный ответ</p>
              <p className="font-mono text-lg text-green-700 dark:text-green-400">
                {result.correct_answer}
              </p>
            </div>
          )}
        </div>

        {/* Решение */}
        {result.solution_text && (
          <div className="p-4 rounded-lg bg-white/70 dark:bg-black/30 border">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-sm">Решение</h4>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {parseLatex(result.solution_text)}
            </div>
          </div>
        )}

        {/* Кнопки действий */}
        <div className="flex flex-col gap-2 pt-2">
          {!result.is_correct && (
            <Button 
              onClick={onAskSocrat}
              variant="default"
              className="w-full bg-socrat-primary hover:bg-socrat-primary-dark"
            >
              <Bot className="w-4 h-4 mr-2" />
              Не понял? Спроси Сократ AI
            </Button>
          )}
          <Button 
            onClick={onNext}
            variant={result.is_correct ? "default" : "outline"}
            className="w-full"
          >
            Следующая задача
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ResultCard;

