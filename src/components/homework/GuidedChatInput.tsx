/**
 * Simple chat input for the guided homework workspace.
 * Two submit buttons: "Ответ" (final answer, checked by AI) and "Шаг" (intermediate step, AI discussion).
 */

import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, MessageCircle } from 'lucide-react';

interface GuidedChatInputProps {
  onSendAnswer: (text: string) => void;
  onSendStep: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  placeholder?: string;
}

const GuidedChatInput = memo(
  ({
    onSendAnswer,
    onSendStep,
    isLoading,
    disabled = false,
    placeholder = 'Введите ответ или шаг решения...',
  }: GuidedChatInputProps) => {
    const [message, setMessage] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const resizeTextarea = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    }, []);

    useEffect(() => {
      resizeTextarea();
    }, [message, resizeTextarea]);

    const clearAndReset = useCallback(() => {
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }, []);

    const handleSendAnswer = useCallback(() => {
      const trimmed = message.trim();
      if (!trimmed || isLoading || disabled) return;
      onSendAnswer(trimmed);
      clearAndReset();
    }, [message, isLoading, disabled, onSendAnswer, clearAndReset]);

    const handleSendStep = useCallback(() => {
      const trimmed = message.trim();
      if (!trimmed || isLoading || disabled) return;
      onSendStep(trimmed);
      clearAndReset();
    }, [message, isLoading, disabled, onSendStep, clearAndReset]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendAnswer();
        }
      },
      [handleSendAnswer],
    );

    const canSend = message.trim().length > 0 && !isLoading && !disabled;

    const spinner = (
      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
    );

    return (
      <div className="flex items-end gap-2 p-3 border-t bg-background">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading || disabled}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            fontSize: '16px', // Prevent iOS Safari auto-zoom
            touchAction: 'manipulation', // Fix iOS 300ms tap delay
            maxHeight: '150px',
          }}
        />
        <div className="flex gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendStep}
            disabled={!canSend}
            className="h-10 px-2.5 gap-1 text-xs whitespace-nowrap"
            title="Отправить как шаг решения (обсуждение с AI)"
          >
            {isLoading ? spinner : <MessageCircle className="h-3.5 w-3.5" />}
            Шаг
          </Button>
          <Button
            size="sm"
            onClick={handleSendAnswer}
            disabled={!canSend}
            className="h-10 px-2.5 gap-1 text-xs whitespace-nowrap"
            title="Отправить как итоговый ответ (проверка AI)"
          >
            {isLoading ? spinner : <CheckCircle2 className="h-3.5 w-3.5" />}
            Ответ
          </Button>
        </div>
      </div>
    );
  },
);

GuidedChatInput.displayName = 'GuidedChatInput';

export default GuidedChatInput;
