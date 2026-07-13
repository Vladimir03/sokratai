import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getMyUserId } from '@/lib/tutorStudentChatApi';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ChatPerspective } from '@/types/tutorStudentChat';

const SEND_THROTTLE_MS = 4_000;
const DEFAULT_EXPIRY_MS = 6_000;

interface TypingState {
  partner: boolean;
  /** Имя печатающего (группы: «Вася печатает…»); null в 1:1 / без имени. */
  partnerName: string | null;
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
  /** Имя себя для групповых получателей («Вася печатает…»); 1:1 может не передавать. */
  selfDisplayName: string | null = null,
) {
  const [typing, setTyping] = useState<TypingState>({
    partner: false,
    partnerName: null,
    assistant: false,
  });
  const timersRef = useRef<{ partner?: number; assistant?: number }>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);
  const myUserIdRef = useRef<string | null>(null);
  const selfNameRef = useRef<string | null>(selfDisplayName);
  selfNameRef.current = selfDisplayName;

  useEffect(() => {
    void getMyUserId().then((uid) => {
      myUserIdRef.current = uid;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !conversationId) return;

    const setKind = (kind: 'partner' | 'assistant', expiresInMs: number, name: string | null) => {
      setTyping((t) =>
        kind === 'partner' ? { ...t, partner: true, partnerName: name } : { ...t, assistant: true },
      );
      if (timersRef.current[kind]) window.clearTimeout(timersRef.current[kind]);
      timersRef.current[kind] = window.setTimeout(() => {
        setTyping((t) =>
          kind === 'partner' ? { ...t, partner: false, partnerName: null } : { ...t, assistant: false },
        );
      }, expiresInMs);
    };

    const channel = supabase
      .channel(`tsc-typing-${conversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const role = typeof payload?.role === 'string' ? payload.role : null;
        if (!role) return;
        const senderUid = typeof payload?.user_id === 'string' ? payload.user_id : null;
        // Свои события: по uid (группы — у двух учеников одна роль);
        // fallback по роли для payload'ов без uid (deploy-skew 1:1).
        if (senderUid && myUserIdRef.current && senderUid === myUserIdRef.current) return;
        if (!senderUid && role === selfRole) return;
        const kind = role === 'assistant' ? ('assistant' as const) : ('partner' as const);
        const name = typeof payload?.display_name === 'string' && payload.display_name.trim()
          ? payload.display_name.trim()
          : null;
        const expiresAtMs = Date.parse(String(payload?.expires_at ?? '')) || 0;
        const expiresIn = expiresAtMs > Date.now()
          ? expiresAtMs - Date.now()
          : DEFAULT_EXPIRY_MS;
        setKind(kind, expiresIn, kind === 'partner' ? name : null);
      })
      .subscribe();
    channelRef.current = channel;

    const timers = timersRef.current;
    return () => {
      channelRef.current = null;
      if (timers.partner) window.clearTimeout(timers.partner);
      if (timers.assistant) window.clearTimeout(timers.assistant);
      setTyping({ partner: false, partnerName: null, assistant: false });
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
        user_id: myUserIdRef.current,
        display_name: selfNameRef.current,
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
    partnerTypingName: typing.partnerName,
    assistantTyping: typing.assistant,
    notifyTyping,
    previewAssistantTyping,
    clearAssistantTyping,
  };
}
