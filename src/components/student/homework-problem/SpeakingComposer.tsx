/**
 * SpeakingComposer — устный монолог (voice-speaking-mvp TASK-9 Part B, 2026-05-29).
 *
 * Composer для task_kind='speaking'. Self-contained: владеет СОБСТВЕННЫМ
 * useVoiceRecorder (не пересекается с discussion-mic в HomeworkProblem — они
 * рендерятся для разных task_kind, одновременно не записывают).
 *
 * Flow (Spec §6): запись → [P0] прослушать ДО отправки + перезаписать → отправка.
 * Один primary CTA на каждом шаге. Отправка вслепую запрещена — «Отправить»
 * активна только после записи + прослушивания.
 *
 * Guardrails (.claude/rules/80-cross-browser.md):
 *   - Только useVoiceRecorder (iOS Safari m4a/webm уже решён) — без новых
 *     MediaRecorder-обёрток.
 *   - URL.revokeObjectURL на unmount И на re-record (memory leak).
 *   - touch-action: manipulation на всех контролах.
 *   - [P1] hard-cap 7 мин + warning на ~6:00 (порог в компоненте, не в хуке).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, RotateCcw, Send, Square } from 'lucide-react';
import { useVoiceRecorder, type VoiceRecordingResult } from '@/hooks/useVoiceRecorder';

// [P1] Хард-кап длительности и порог предупреждения (Spec §8 — DELF B1 монолог
// 5-7 мин). Совпадает с MAX_STUDENT_VOICE_BYTES size-cap на upload.
const MAX_DURATION_SEC = 7 * 60; // 420 — хард-стоп
const WARN_AT_SEC = 6 * 60; // 360 — «осталась минута»

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface SpeakingComposerProps {
  /** Parent submit (upload voice → submitSolution) in flight. */
  isSubmitting: boolean;
  /** Task already graded/closed (first-completed-wins). */
  isCompleted: boolean;
  /** Closed manually by tutor (vs AI verdict). */
  isTutorClosed?: boolean;
  hasNextTask: boolean;
  onNavigateNext: () => void;
  /** Called when the student commits a recording. Parent owns upload + submit. */
  onSubmit: (result: VoiceRecordingResult) => void;
}

export function SpeakingComposer({
  isSubmitting,
  isCompleted,
  isTutorClosed = false,
  hasNextTask,
  onNavigateNext,
  onSubmit,
}: SpeakingComposerProps) {
  const recorder = useVoiceRecorder();
  const [recorded, setRecorded] = useState<VoiceRecordingResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const autoStoppedRef = useRef(false);

  const revokeAudio = useCallback(() => {
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  // Revoke the object URL on unmount (memory leak guard).
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleStop = useCallback(async () => {
    const result = await recorder.stopRecording();
    if (result) {
      setRecorded(result);
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(result.blob);
      });
    }
  }, [recorder]);

  // [P1] Hard-stop at 7:00. Guard with a ref so the effect fires the stop once.
  useEffect(() => {
    if (recorder.isRecording && recorder.recordingDurationSeconds >= MAX_DURATION_SEC && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      void handleStop();
    }
  }, [recorder.isRecording, recorder.recordingDurationSeconds, handleStop]);

  const handleStart = useCallback(async () => {
    autoStoppedRef.current = false;
    revokeAudio();
    setRecorded(null);
    await recorder.startRecording();
  }, [recorder, revokeAudio]);

  const handleReRecord = useCallback(() => {
    revokeAudio();
    setRecorded(null);
    autoStoppedRef.current = false;
  }, [revokeAudio]);

  const handleSubmit = useCallback(() => {
    if (recorded && !isSubmitting) onSubmit(recorded);
  }, [recorded, isSubmitting, onSubmit]);

  const wrapperClass =
    'flex flex-col gap-2.5 bg-white border-t border-socrat-border-light px-3 pt-3 pb-3.5 shrink-0';

  // ─── Completed (graded/closed) — mirror SubmitCtaBar completed state ────────
  if (isCompleted) {
    return (
      <div className={wrapperClass}>
        <button
          type="button"
          onClick={onNavigateNext}
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] font-bold text-sm transition-colors touch-manipulation"
          style={{ touchAction: 'manipulation' }}
        >
          {hasNextTask ? 'Следующая задача' : 'Назад к ДЗ'}
        </button>
        <p className="text-[11px] text-center text-socrat-muted">
          {isTutorClosed ? 'Закрыто репетитором' : 'Ответ принят'}
        </p>
      </div>
    );
  }

  // ─── Recorder not supported ─────────────────────────────────────────────────
  if (!recorder.isSupported) {
    return (
      <div className={wrapperClass}>
        <p className="text-sm text-center text-socrat-muted">
          Запись голоса не поддерживается в этом браузере. Открой задачу в Safari (iPhone) или Chrome.
        </p>
      </div>
    );
  }

  const nearCap = recorder.recordingDurationSeconds >= WARN_AT_SEC;
  const secondsLeft = Math.max(0, MAX_DURATION_SEC - recorder.recordingDurationSeconds);

  // ─── Recording in progress ──────────────────────────────────────────────────
  if (recorder.isRecording) {
    return (
      <div className={wrapperClass}>
        <div className="flex items-center justify-center gap-2 text-sm font-semibold text-rose-600">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" aria-hidden="true" />
          <span className="tabular-nums" aria-live="polite">
            Запись: {formatDuration(recorder.recordingDurationSeconds)}
          </span>
        </div>
        {nearCap ? (
          <p className="text-[11px] text-center text-amber-600 font-medium" aria-live="polite">
            Осталась минута — запись остановится на 7:00 ({formatDuration(secondsLeft)})
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleStop()}
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-[14px] font-bold text-sm transition-colors touch-manipulation"
          style={{ touchAction: 'manipulation' }}
        >
          <Square className="h-[18px] w-[18px] fill-current" aria-hidden="true" />
          Остановить
        </button>
      </div>
    );
  }

  // ─── Recorded — playback-before-submit + re-record (P0) ─────────────────────
  if (recorded && audioUrl) {
    return (
      <div className={wrapperClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-socrat-muted">
          Прослушай запись перед отправкой
        </p>
        <audio
          src={audioUrl}
          controls
          preload="metadata"
          className="w-full"
          style={{ touchAction: 'manipulation' }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReRecord}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-[14px] border border-socrat-border text-slate-700 hover:bg-socrat-surface font-semibold text-sm transition-colors touch-manipulation disabled:opacity-50"
            style={{ touchAction: 'manipulation' }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Перезаписать
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 flex-1 px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] font-bold text-sm transition-colors touch-manipulation disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ touchAction: 'manipulation' }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                Отправляем…
              </>
            ) : (
              <>
                <Send className="h-[18px] w-[18px] stroke-2" aria-hidden="true" />
                Отправить ответ
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ─── Idle — start recording ─────────────────────────────────────────────────
  return (
    <div className={wrapperClass}>
      <button
        type="button"
        onClick={() => void handleStart()}
        disabled={isSubmitting}
        className="flex items-center justify-center gap-2 w-full px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] font-bold text-sm transition-colors touch-manipulation disabled:opacity-60"
        style={{ touchAction: 'manipulation' }}
      >
        <Mic className="h-[18px] w-[18px] stroke-2" aria-hidden="true" />
        Записать устный ответ
      </button>
      <p className="text-[11px] text-center text-socrat-muted">
        Запиши монолог голосом — до 7 минут. Сможешь прослушать перед отправкой.
      </p>
    </div>
  );
}

export default SpeakingComposer;
