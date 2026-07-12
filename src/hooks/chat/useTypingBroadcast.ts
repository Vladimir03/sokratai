import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ChatPerspective } from '@/types/tutorStudentChat';

const SEND_THROTTLE_MS = 4_000;
const DEFAULT_EXPIRY_MS = 6_000;

interface TypingState {
  partner: boolean;
  assistant: boolean;
}

/**
 * Индикатор «печатает…» через Supabase Realtime broadcast (без БД) — канал
 * `tsc-typing-<conversationId>`. Telegram-модель: отправитель шлёт максимум
 * раз в 4с пока печатает, «stop»-события нет — приёмник сам гасит по expiry.
 * Degrade-safe: не дошло → просто нет индикатора.
 */
export function useTypingBroadcast(
  conversationId: string | null,
  selfRole: ChatPerspective,
  enabled: boolean,
) {
  const [typing, setTyping] = useState<TypingState>({ partner: false, assistant: false });
  const timersRef = useRef<{ partner?: number; assistant?: number }>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!enabled || !conversationId) return;

    const setKind = (kind: keyof TypingState, expiresInMs: number) => {
      setTyping((t) => (t[kind] ? t : { ...t, [kind]: true }));
      if (timersRef.current[kind]) window.clearTimeout(timersRef.current[kind]);
      timersRef.current[kind] = window.setTimeout(() => {
        setTyping((t) => ({ ...t, [kind]: false }));
      }, expiresInMs);
    };

    const channel = supabase
      .channel(`tsc-typing-${conversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const role = typeof payload?.role === 'string' ? payload.role : null;
        if (!role || role === selfRole) return;
        const kind: keyof TypingState = role === 'assistant' ? 'assistant' : 'partner';
        const expiresAtMs = Date.parse(String(payload?.expires_at ?? '')) || 0;
        const expiresIn = expiresAtMs > Date.now()
          ? expiresAtMs - Date.now()
          : DEFAULT_EXPIRY_MS;
        setKind(kind, expiresIn);
      })
      .subscribe();
    channelRef.current = channel;

    const timers = timersRef.current;
    return () => {
      channelRef.current = null;
      if (timers.partner) window.clearTimeout(timers.partner);
      if (timers.assistant) window.clearTimeout(timers.assistant);
      setTyping({ partner: false, assistant: false });
      void channel.unsubscribe();
    };
  }, [conversationId, selfRole, enabled]);

  /** Дёргать на каждый keystroke — троттлинг внутри. */
  const notifyTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const now = Date.now();
    if (now - lastSentRef.current < SEND_THROTTLE_MS) return;
    lastSentRef.current = now;
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        role: selfRole,
        expires_at: new Date(now + DEFAULT_EXPIRY_MS).toISOString(),
      },
    });
  }, [selfRole]);

  /** Локальный мгновенный «СократAI печатает…» сразу после отправки упоминания. */
  const previewAssistantTyping = useCallback((durationMs = 40_000) => {
    setTyping((t) => ({ ...t, assistant: true }));
    if (timersRef.current.assistant) window.clearTimeout(timersRef.current.assistant);
    timersRef.current.assistant = window.setTimeout(() => {
      setTyping((t) => ({ ...t, assistant: false }));
    }, durationMs);
  }, []);

  /** Погасить «СократAI печатает…» когда ответ пришёл. */
  const clearAssistantTyping = useCallback(() => {
    if (timersRef.current.assistant) window.clearTimeout(timersRef.current.assistant);
    setTyping((t) => (t.assistant ? { ...t, assistant: false } : t));
  }, []);

  return {
    partnerTyping: typing.partner,
    assistantTyping: typing.assistant,
    notifyTyping,
    previewAssistantTyping,
    clearAssistantTyping,
  };
}
