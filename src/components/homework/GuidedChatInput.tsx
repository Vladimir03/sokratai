/**
 * Simple chat input for the guided homework workspace.
 * Intentionally lighter than ChatInput.tsx (no voice, haptics, sheets).
 */

import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';

interface GuidedChatInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  placeholder?: string;
}

const GuidedChatInput = memo(
  ({
    onSend,
    isLoading,
    disabled = false,
    placeholder = 'Напишите ответ...',
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

    const handleSend = useCallback(() => {
      const trimmed = message.trim();
      if (!trimmed || isLoading || disabled) return;
      onSend(trimmed);
      setMessage('');
      // Reset textarea height after clearing
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }, [message, isLoading, disabled, onSend]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend],
    );

    const canSend = message.trim().length > 0 && !isLoading && !disabled;

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
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 h-10 w-10"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    );
  },
);

GuidedChatInput.displayName = 'GuidedChatInput';

export default GuidedChatInput;
