/**
 * Lightweight chat message renderer with Markdown + LaTeX support.
 * Based on ChatMessage.tsx patterns but without GraphRenderer/Pyodide.
 */

import { memo, lazy, Suspense, useEffect, useState, useMemo } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AlertTriangle, EyeOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/common/UserAvatar';
import { getStudentTaskImageSignedUrl } from '@/lib/studentHomeworkApi';
import type { GuidedMessageKind, MessageDeliveryStatus } from '@/types/homework';
import { preprocessLatex } from '@/components/kb/ui/preprocessLatex';
import { ThreadAttachments } from './ThreadAttachments';

const ReactMarkdown = lazy(() => import('react-markdown'));

export interface GuidedMessageData {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tutor';
  content: string;
  image_url?: string | null;
  created_at?: string;
  message_kind?: GuidedMessageKind;
  message_delivery_status?: MessageDeliveryStatus;
}

interface GuidedChatMessageProps {
  message: GuidedMessageData;
  isStreaming?: boolean;
  onRetry?: (messageId: string) => void;
  // Tutor identity (resolved at thread level, see TASK-7/8). Optional —
  // legacy callsites without these props render the old "Репетитор" label
  // without an avatar (see isTutor branch fallback).
  tutorDisplayName?: string;
  tutorAvatarUrl?: string | null;
  tutorGender?: 'male' | 'female' | null;
  /**
   * Whose viewpoint this message is rendered from.
   * - 'student' (default): student-side workspace. tutor=left with identity,
   *   user=right (own messages, no identity), assistant=left muted.
   * - 'tutor': tutor-side viewer. tutor=right with identity (own messages),
   *   user=left with student identity (avatar+name), assistant=left muted.
   */
  perspective?: 'student' | 'tutor';
  /**
   * Student identity props — only consumed when `perspective='tutor'`. The
   * student's profile picture isn't part of the schema yet, so the typical
   * value is `studentAvatarUrl=null, studentGender=null` and `UserAvatar`
   * falls back to initials extracted from `studentDisplayName`.
   */
  studentDisplayName?: string;
  studentAvatarUrl?: string | null;
  studentGender?: 'male' | 'female' | null;
  /**
   * Optional small "Задача N" label shown above the bubble. Used by the
   * tutor viewer when the task filter is "all" so it's clear which task a
   * given message belongs to. Pass null/undefined to hide.
   */
  taskMarker?: string | null;
  /**
   * If true, render an "Скрыто от ученика" amber pill alongside the
   * timestamp. Tutor-only; student perspective ignores this prop.
   */
  hiddenFromStudent?: boolean;
  /**
   * Custom resolver for `image_url` storage refs. Defaults to the student-
   * scoped resolver (works for student-side workspace and for student-
   * uploaded images). Tutor viewer passes a tutor-scoped resolver because
   * tutor uploads land in a different bucket (`homework-images`).
   */
  imageResolver?: (ref: string) => Promise<string | null>;
  /**
   * If true, message timestamps render as full `DD.MM.YYYY, HH:MM:SS`
   * (date + time). Default — time only (`HH:MM`). Used by the tutor viewer
   * because messages can be days/weeks old; student workspace shows
   * time-only since the student is in the live conversation.
   */
  showDateInTimestamp?: boolean;
}

function formatTime(isoString?: string, showDate?: boolean): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (showDate) {
    return date.toLocaleString('ru-RU');
  }
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatMessageKind(kind: GuidedMessageKind | undefined): string | null {
  if (!kind) return null;
  if (kind === 'system') return 'Введение';
  if (kind === 'hint_request') return 'Подсказка';
  if (kind === 'question') return 'Шаг решения';
  if (kind === 'answer') return 'Ответ';
  return null;
}

const GuidedChatMessage = memo(({
  message,
  isStreaming,
  onRetry,
  tutorDisplayName,
  tutorAvatarUrl,
  tutorGender,
  perspective = 'student',
  studentDisplayName,
  studentAvatarUrl = null,
  studentGender = null,
  taskMarker,
  hiddenFromStudent,
  imageResolver,
  showDateInTimestamp,
}: GuidedChatMessageProps) => {
  const resolveImageRef = imageResolver ?? getStudentTaskImageSignedUrl;
  const [katexLoaded, setKatexLoaded] = useState(false);
  const hasMath = message.content.includes('$') || message.content.includes('\\(') || message.content.includes('\\[');

  useEffect(() => {
    if (hasMath && !katexLoaded) {
      import('katex/dist/katex.min.css').then(() => {
        setKatexLoaded(true);
      });
    }
  }, [hasMath, katexLoaded]);

  const displayContent =
    message.role === 'assistant' || message.role === 'tutor'
      ? preprocessLatex(message.content)
      : message.content;

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isTutor = message.role === 'tutor';
  const isTutorPerspective = perspective === 'tutor';
  const kindLabel = formatMessageKind(message.message_kind);
  const isFailed = message.message_delivery_status === 'failed';
  const isSending = message.message_delivery_status === 'sending';

  const markdownComponents = useMemo(
    () => ({
      // For user-role bubbles, the inverted text colors only apply on the
      // student perspective (own messages = primary bg). On tutor perspective
      // user bubbles are muted, so plain text colors fit.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p: ({ node, ...props }: any) => (
        <p
          className={`mb-3 leading-relaxed last:mb-0 break-words whitespace-pre-wrap ${
            isUser && !isTutorPerspective ? 'text-primary-foreground' : ''
          }`}
          {...props}
        />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      strong: ({ node, ...props }: any) => (
        <strong
          className={`font-bold ${isUser && !isTutorPerspective ? 'text-primary-foreground' : 'text-primary'}`}
          {...props}
        />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ul: ({ node, ...props }: any) => (
        <ul className="list-disc ml-4 mb-3 space-y-1" {...props} />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ol: ({ node, ...props }: any) => (
        <ol className="list-decimal ml-4 mb-3 space-y-2" {...props} />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      li: ({ node, ...props }: any) => (
        <li
          className={`ml-2 break-words ${isUser && !isTutorPerspective ? 'text-primary-foreground' : ''}`}
          {...props}
        />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      h3: ({ node, ...props }: any) => (
        <h3
          className={`font-bold text-lg mt-4 mb-2 break-words ${
            isUser && !isTutorPerspective ? 'text-primary-foreground' : ''
          }`}
          {...props}
        />
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pre: ({ node, children, ...props }: any) => (
        <pre
          className={`p-3 rounded-lg overflow-x-auto my-3 ${
            isUser && !isTutorPerspective ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted'
          }`}
          {...props}
        >
          {children}
        </pre>
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      code: ({ node, inline, className, children, ...props }: any) => {
        if (inline) {
          return (
            <code
              className={`px-1.5 py-0.5 rounded text-sm break-words ${
                isUser && !isTutorPerspective ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted'
              }`}
              {...props}
            >
              {children}
            </code>
          );
        }
        return (
          <code className={`text-sm ${className || ''}`} {...props}>
            {children}
          </code>
        );
      },
    }),
    [isUser, isTutorPerspective],
  );

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full max-w-[85%] text-center">
          {message.content}
        </div>
      </div>
    );
  }

  // ─── Tutor message (role='tutor') ───────────────────────────────────────
  // perspective='student': aligned-left with avatar+name above bubble (Telegram-
  //   style) when tutor identity is provided. Legacy fallback otherwise.
  // perspective='tutor':   aligned-right with avatar+name above bubble (Telegram-
  //   "you" style). Same emerald palette for visual continuity with the student
  //   side, since the message is from the tutor either way.
  if (isTutor) {
    const hasTutorIdentity =
      tutorDisplayName !== undefined || tutorAvatarUrl !== undefined;

    const bubbleBody = (
      <div className="text-sm">
        <Suspense fallback={<p className="whitespace-pre-wrap break-words">{displayContent}</p>}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={hasMath && katexLoaded ? [rehypeKatex] : []}
            components={markdownComponents}
          >
            {displayContent}
          </ReactMarkdown>
        </Suspense>
        {message.image_url && (
          <ThreadAttachments
            attachmentValue={message.image_url}
            resolveSignedUrl={resolveImageRef}
          />
        )}
      </div>
    );

    const timestampRow = message.created_at || hiddenFromStudent ? (
      <div className="flex items-center gap-2 mt-1 text-[10px] text-emerald-600/60 dark:text-emerald-400/60">
        {message.created_at ? <span>{formatTime(message.created_at, showDateInTimestamp)}</span> : null}
        {hiddenFromStudent ? (
          <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <EyeOff className="h-3 w-3" />
            Скрыто
          </span>
        ) : null}
      </div>
    ) : null;

    if (!hasTutorIdentity) {
      // Legacy callsite — preserve the original presentation exactly.
      return (
        <div className={`flex ${isTutorPerspective ? 'justify-end' : 'justify-start'} mb-3`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 ${
            isTutorPerspective ? 'rounded-br-md' : 'rounded-bl-md'
          }`}>
            {taskMarker ? (
              <p className="text-[10px] mb-1 uppercase tracking-wide text-emerald-700/70 dark:text-emerald-400/70 font-medium">
                {taskMarker}
              </p>
            ) : null}
            <p className="text-[10px] mb-1 uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-medium">
              Репетитор
            </p>
            {bubbleBody}
            {timestampRow}
          </div>
        </div>
      );
    }

    const tutorLabel = tutorDisplayName?.trim() || 'Репетитор';

    return (
      <div className={`flex items-start gap-2 ${isTutorPerspective ? 'flex-row-reverse justify-start' : 'justify-start'} mb-3`}>
        <UserAvatar
          size="sm"
          avatarUrl={tutorAvatarUrl}
          gender={tutorGender}
          name={tutorDisplayName}
        />
        <div className="flex flex-col max-w-[85%] min-w-0">
          <div className={`text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[200px] ${
            isTutorPerspective ? 'self-end' : ''
          }`}>
            {tutorLabel}
          </div>
          {taskMarker ? (
            <div className={`text-[10px] mt-0.5 text-muted-foreground ${isTutorPerspective ? 'self-end' : ''}`}>
              {taskMarker}
            </div>
          ) : null}
          <div className={`mt-1 rounded-2xl px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 ${
            isTutorPerspective ? 'rounded-br-md' : 'rounded-bl-md'
          }`}>
            {bubbleBody}
            {timestampRow}
          </div>
        </div>
      </div>
    );
  }

  // ─── User message (role='user', the student) ────────────────────────────
  // perspective='student' (default): aligned-right, primary bg, no identity
  //   (it's "you" — the user looking at their own messages).
  // perspective='tutor': aligned-left with student avatar+name above bubble
  //   (Telegram-style — tutor is reading the student's messages).
  if (isUser && isTutorPerspective) {
    const studentLabel = studentDisplayName?.trim() || 'Ученик';
    const userBubbleBody = (
      <div className="text-sm">
        {kindLabel && (
          <p className="text-[10px] mb-1 uppercase tracking-wide text-muted-foreground">
            {kindLabel}
          </p>
        )}
        <Suspense
          fallback={<p className="whitespace-pre-wrap break-words">{displayContent}</p>}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={hasMath && katexLoaded ? [rehypeKatex] : []}
            components={markdownComponents}
          >
            {displayContent}
          </ReactMarkdown>
        </Suspense>
        {message.image_url && (
          <ThreadAttachments
            attachmentValue={message.image_url}
            resolveSignedUrl={resolveImageRef}
          />
        )}
      </div>
    );

    return (
      <div className="flex items-start gap-2 justify-start mb-3">
        <UserAvatar
          size="sm"
          avatarUrl={studentAvatarUrl}
          gender={studentGender}
          name={studentDisplayName}
        />
        <div className="flex flex-col max-w-[85%] min-w-0">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
            {studentLabel}
          </div>
          {taskMarker ? (
            <div className="text-[10px] mt-0.5 text-muted-foreground">
              {taskMarker}
            </div>
          ) : null}
          <div className="mt-1 rounded-2xl px-4 py-2.5 bg-muted rounded-bl-md">
            {userBubbleBody}
            {message.created_at && (
              <div className="text-[10px] mt-1 text-muted-foreground">
                {formatTime(message.created_at, showDateInTimestamp)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Default branch: assistant (AI) OR user-on-student-perspective ──────
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        }`}
      >
        {taskMarker ? (
          <p className={`text-[10px] mb-1 uppercase tracking-wide ${
            isUser ? 'text-primary-foreground/80' : 'text-muted-foreground'
          }`}>
            {taskMarker}
          </p>
        ) : null}
        <div className="text-sm">
          {kindLabel && (
            <p
              className={`text-[10px] mb-1 uppercase tracking-wide ${
                isUser ? 'text-primary-foreground/80' : 'text-muted-foreground'
              }`}
            >
              {kindLabel}
            </p>
          )}
          <Suspense
            fallback={
              <p className="whitespace-pre-wrap break-words">{displayContent}</p>
            }
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={hasMath && katexLoaded ? [rehypeKatex] : []}
              components={markdownComponents}
            >
              {displayContent}
            </ReactMarkdown>
          </Suspense>
          {message.image_url && (
            <ThreadAttachments
              attachmentValue={message.image_url}
              resolveSignedUrl={resolveImageRef}
            />
          )}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
        {message.created_at && (
          <div
            className={`text-[10px] mt-1 ${
              isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'
            }`}
          >
            {formatTime(message.created_at, showDateInTimestamp)}
          </div>
        )}
        {isSending && (
          <div className="text-[10px] mt-1 text-muted-foreground">
            Отправка...
          </div>
        )}
        {isFailed && (
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3" />
              Не отправлено
            </span>
            {message.id && onRetry && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => onRetry(message.id!)}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Повторить
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

GuidedChatMessage.displayName = 'GuidedChatMessage';

export default GuidedChatMessage;
