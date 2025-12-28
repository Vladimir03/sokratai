import { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';
import { Fragment } from 'react';

interface HintsDisplayProps {
  hints: string[];
  revealedCount: number;
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

export const HintsDisplay = ({ hints, revealedCount }: HintsDisplayProps) => {
  if (revealedCount === 0 || hints.length === 0) {
    return null;
  }

  const revealedHints = hints.slice(0, revealedCount);

  return (
    <Card className="w-full bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-amber-500" />
          <h4 className="font-semibold text-amber-700 dark:text-amber-400">
            Подсказки ({revealedCount}/{hints.length})
          </h4>
        </div>
        <div className="space-y-2">
          {revealedHints.map((hint, index) => (
            <div 
              key={index}
              className="p-3 rounded-lg bg-white/70 dark:bg-black/20 border border-amber-200 dark:border-amber-800"
            >
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <span className="font-semibold mr-2">{index + 1}.</span>
                {parseLatex(hint)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default HintsDisplay;

