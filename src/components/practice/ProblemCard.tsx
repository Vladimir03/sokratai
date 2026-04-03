import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { EgeProblem } from "@/types/practice";
import { EGE_NUMBERS, DIFFICULTY_LABELS } from "@/types/practice";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import { Fragment } from 'react';

interface ProblemCardProps {
  problem: EgeProblem;
}

// Функция для парсинга LaTeX в тексте
const parseLatex = (text: string) => {
  if (!text) return null;
  
  // Разбиваем текст на части: обычный текст и LaTeX
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]+\$)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith('$$') && part.endsWith('$$')) {
      // Block math
      const latex = part.slice(2, -2).trim();
      return <BlockMath key={index} math={latex} />;
    } else if (part.startsWith('$') && part.endsWith('$')) {
      // Inline math
      const latex = part.slice(1, -1);
      return <InlineMath key={index} math={latex} />;
    } else {
      return <Fragment key={index}>{part}</Fragment>;
    }
  });
};

export const ProblemCard = ({ problem }: ProblemCardProps) => {
  const egeInfo = EGE_NUMBERS[problem.ege_number];
  const difficultyLabel = DIFFICULTY_LABELS[problem.difficulty];

  const difficultyColor = {
    1: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    2: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    3: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }[problem.difficulty];

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm font-semibold">
              №{problem.ege_number}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {egeInfo.name}
            </span>
          </div>
          <Badge className={difficultyColor}>
            {difficultyLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <div className="text-base leading-relaxed">
            {parseLatex(problem.condition_text)}
          </div>
        </div>
        
        {problem.condition_image_url && (
          <div className="mt-4">
            <img 
              src={problem.condition_image_url} 
              alt="Условие задачи" 
              className="max-w-full h-auto rounded-lg border"
              loading="lazy"
            />
          </div>
        )}

        {problem.topic && (
          <div className="mt-4 flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-xs">
              {problem.topic}
            </Badge>
            {problem.subtopic && (
              <Badge variant="secondary" className="text-xs">
                {problem.subtopic}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProblemCard;

