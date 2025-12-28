import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Send, Lightbulb, SkipForward, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AnswerType } from "@/types/practice";

interface AnswerInputProps {
  answerType: AnswerType;
  onSubmit: (answer: string) => void;
  onHint: () => void;
  onSkip: () => void;
  hintsAvailable: number;
  hintsUsed: number;
  isChecking: boolean;
  disabled?: boolean;
}

// Цифровая клавиатура для мобильных
const NumericKeyboard = ({ 
  onKeyPress, 
  onBackspace, 
  onDecimal, 
  onNegative,
  onFraction 
}: { 
  onKeyPress: (key: string) => void;
  onBackspace: () => void;
  onDecimal: () => void;
  onNegative: () => void;
  onFraction: () => void;
}) => {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      {keys.slice(0, 3).map(key => (
        <Button 
          key={key} 
          variant="outline" 
          className="h-12 text-lg font-semibold"
          onClick={() => onKeyPress(key)}
        >
          {key}
        </Button>
      ))}
      <Button 
        variant="outline" 
        className="h-12 text-lg font-semibold"
        onClick={onBackspace}
      >
        ⌫
      </Button>
      
      {keys.slice(3, 6).map(key => (
        <Button 
          key={key} 
          variant="outline" 
          className="h-12 text-lg font-semibold"
          onClick={() => onKeyPress(key)}
        >
          {key}
        </Button>
      ))}
      <Button 
        variant="outline" 
        className="h-12 text-lg font-semibold"
        onClick={onNegative}
      >
        −
      </Button>
      
      {keys.slice(6, 9).map(key => (
        <Button 
          key={key} 
          variant="outline" 
          className="h-12 text-lg font-semibold"
          onClick={() => onKeyPress(key)}
        >
          {key}
        </Button>
      ))}
      <Button 
        variant="outline" 
        className="h-12 text-lg font-semibold"
        onClick={onDecimal}
      >
        ,
      </Button>
      
      <Button 
        variant="outline" 
        className="h-12 text-lg font-semibold col-span-2"
        onClick={() => onKeyPress('0')}
      >
        0
      </Button>
      <Button 
        variant="outline" 
        className="h-12 text-lg font-semibold col-span-2"
        onClick={onFraction}
      >
        /
      </Button>
    </div>
  );
};

export const AnswerInput = ({
  answerType,
  onSubmit,
  onHint,
  onSkip,
  hintsAvailable,
  hintsUsed,
  isChecking,
  disabled = false,
}: AnswerInputProps) => {
  const [answer, setAnswer] = useState('');
  const isMobile = useIsMobile();

  const isNumericInput = ['integer', 'decimal', 'fraction'].includes(answerType);

  const handleSubmit = () => {
    if (answer.trim()) {
      onSubmit(answer.trim());
      setAnswer('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleKeyPress = (key: string) => {
    setAnswer(prev => prev + key);
  };

  const handleBackspace = () => {
    setAnswer(prev => prev.slice(0, -1));
  };

  const handleDecimal = () => {
    if (!answer.includes(',') && !answer.includes('.')) {
      setAnswer(prev => prev + ',');
    }
  };

  const handleNegative = () => {
    if (answer.startsWith('-')) {
      setAnswer(prev => prev.slice(1));
    } else {
      setAnswer(prev => '-' + prev);
    }
  };

  const handleFraction = () => {
    if (!answer.includes('/')) {
      setAnswer(prev => prev + '/');
    }
  };

  return (
    <Card className="w-full">
      <CardContent className="pt-4">
        <div className="space-y-4">
          {/* Поле ввода ответа */}
          <div className="flex gap-2">
            <Input
              type={isNumericInput && !isMobile ? "text" : "text"}
              inputMode={isNumericInput ? "decimal" : "text"}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Введите ответ"
              className="text-center text-lg h-12 font-mono"
              disabled={isChecking || disabled}
              autoFocus
            />
            <Button 
              onClick={handleSubmit}
              disabled={!answer.trim() || isChecking || disabled}
              className="h-12 px-6"
            >
              {isChecking ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </Button>
          </div>

          {/* Мобильная клавиатура */}
          {isMobile && isNumericInput && !disabled && (
            <NumericKeyboard
              onKeyPress={handleKeyPress}
              onBackspace={handleBackspace}
              onDecimal={handleDecimal}
              onNegative={handleNegative}
              onFraction={handleFraction}
            />
          )}

          {/* Кнопки подсказки и пропуска */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onHint}
              disabled={hintsUsed >= hintsAvailable || isChecking || disabled}
              className="flex-1"
            >
              <Lightbulb className="w-4 h-4 mr-2" />
              Подсказка ({hintsUsed}/{hintsAvailable})
            </Button>
            <Button
              variant="ghost"
              onClick={onSkip}
              disabled={isChecking || disabled}
              className="flex-1"
            >
              <SkipForward className="w-4 h-4 mr-2" />
              Пропустить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AnswerInput;

