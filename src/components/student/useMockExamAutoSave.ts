// Mock Exams v1 — student auto-save hook (TASK-4 hard requirement).
//
// Контракт: ученик решает 4 часа, ОДИН потерянный ответ — это churn для пилота.
// Hybrid persistence: DB (server-of-truth) + localStorage (offline buffer).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-2
// Risk: docs/delivery/features/mock-exams-v1/product-nuances.md #3 (state persistence)
//
// Flow:
//   - on mount: read DB-saved answers; merge с localStorage queued drafts
//     (localStorage wins для unsaved). Это решает «открыл вкладку, упал
//     wifi во время предыдущей debounced-save → DB не получила, localStorage
//     получил» edge case.
//   - on input: setAnswer(kim, value) — IMMEDIATELY пишем в localStorage,
//     запускаем debounced PATCH (500ms)
//   - on PATCH success: убираем kim из localStorage queue
//   - on PATCH fail: keep in localStorage; markDirty=true; UI показывает
//     «офлайн» индикатор
//   - on `online` event: flush all queued kim → PATCH в порядке очереди
//   - on `beforeunload`: проактивно вызываем sendBeacon если поддерживается
//     (но не блокируем закрытие вкладки)
//
// Не использует React Query — эта механика нужна **до** initial render hooks
// (browser может закрыть вкладку любую секунду; мы не можем зависеть
// от typical mount lifecycle).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  autosaveMockExamAnswer,
  StudentMockExamApiError,
} from '@/lib/studentMockExamApi';

const DEBOUNCE_MS = 500;
const ONLINE_FLUSH_DELAY_MS = 200; // small delay to avoid rapid-fire network burst

/** Per-kim answer + status. Status purely UX-side, не критичен для submit. */
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutosaveSnapshot {
  /** Map kim_number → answer string. Empty string ⇔ student cleared. */
  answers: Record<number, string>;
  /** Per-kim status — для inline UX-индикаторов «сохранено / сохраняется». */
  statusByKim: Record<number, AutosaveStatus>;
  /** Number of un-flushed (in-flight + queued + errored) kim entries. */
  pendingCount: number;
  /** ISO timestamp of last successful save (any kim). */
  lastSavedAt: string | null;
  /** True iff current value differs from server-known last save (для submit confirm). */
  hasUnsavedDraft: boolean;
  /** True iff we have queued kim that failed to save (offline mode). */
  isOffline: boolean;
}

export interface UseMockExamAutoSaveOptions {
  attemptId: string;
  /** Initial answers from server (DB). Map of kim_number → answer. */
  initialAnswers: Array<{ kim_number: number; student_answer: string | null }>;
  /** Disable auto-save (e.g. attempt already submitted). */
  disabled?: boolean;
}

interface QueuedDraft {
  answer: string;
  queuedAt: number;
}

function getStorageKey(attemptId: string): string {
  return `sokrat-mock-exam-autosave:${attemptId}`;
}

function readQueueFromStorage(attemptId: string): Record<number, QueuedDraft> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getStorageKey(attemptId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<number, QueuedDraft> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const kim = Number.parseInt(k, 10);
      if (!Number.isInteger(kim)) continue;
      if (!v || typeof v !== 'object') continue;
      const obj = v as Record<string, unknown>;
      if (typeof obj.answer !== 'string') continue;
      out[kim] = {
        answer: obj.answer,
        queuedAt: typeof obj.queuedAt === 'number' ? obj.queuedAt : Date.now(),
      };
    }
    return out;
  } catch (err) {
    console.warn('[mock-exam-autosave] failed to read storage', err);
    return {};
  }
}

function writeQueueToStorage(attemptId: string, queue: Record<number, QueuedDraft>): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(attemptId);
    if (Object.keys(queue).length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(queue));
    }
  } catch (err) {
    // Likely quota or private mode — non-fatal, log only.
    console.warn('[mock-exam-autosave] failed to write storage', err);
  }
}

/**
 * Hybrid auto-save для Mock Exams Part 1.
 *
 * @example
 * const { answers, setAnswer, isOffline, pendingCount, hasUnsavedDraft } =
 *   useMockExamAutoSave({
 *     attemptId,
 *     initialAnswers: data.part1_answers,
 *   });
 */
export function useMockExamAutoSave(
  options: UseMockExamAutoSaveOptions,
): AutosaveSnapshot & {
  setAnswer: (kimNumber: number, value: string) => void;
  /** Force flush all pending kim now (e.g. before submit). Returns when done. */
  flush: () => Promise<{ flushed: number; failed: number }>;
} {
  const { attemptId, initialAnswers, disabled = false } = options;

  // Server-known snapshot — merged on mount; updated on every successful save.
  const serverKnownRef = useRef<Record<number, string>>({});
  // Local queue — drafts that haven't reached the server yet.
  const queueRef = useRef<Record<number, QueuedDraft>>({});
  // Per-kim debounce timers.
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  // Track in-flight saves to avoid double-PATCH.
  const inFlightRef = useRef<Set<number>>(new Set());

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [statusByKim, setStatusByKim] = useState<Record<number, AutosaveStatus>>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // ─── Mount: merge DB + localStorage (localStorage wins for unsaved) ───────
  useEffect(() => {
    const fromDb: Record<number, string> = {};
    for (const row of initialAnswers ?? []) {
      fromDb[row.kim_number] = row.student_answer ?? '';
    }
    serverKnownRef.current = { ...fromDb };

    const queued = readQueueFromStorage(attemptId);
    queueRef.current = queued;

    // Merge: localStorage drafts override DB for same kim.
    const merged: Record<number, string> = { ...fromDb };
    const initialStatus: Record<number, AutosaveStatus> = {};
    for (const [kimStr, draft] of Object.entries(queued)) {
      const kim = Number.parseInt(kimStr, 10);
      merged[kim] = draft.answer;
      initialStatus[kim] = 'pending';
    }
    setAnswers(merged);
    setStatusByKim(initialStatus);
    if (Object.keys(queued).length > 0) {
      // We have un-flushed drafts from a previous session → try to push now.
      setIsOffline(false);
      // Schedule async flush after first paint to keep mount fast.
      setTimeout(() => {
        void flushAllInternal();
      }, ONLINE_FLUSH_DELAY_MS);
    }

    return () => {
      // Cleanup all timers on unmount — but keep localStorage queue intact
      // (intentional: another tab / next mount can still recover).
      for (const t of Object.values(timersRef.current)) {
        clearTimeout(t);
      }
      timersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // ─── Schedule debounced save per kim (defined first; calls via persistRef) ──
  // We break the persistKim ↔ scheduleSave cycle with a ref so eslint-react-hooks
  // doesn't see a circular dep. persistRef.current set right after persistKim.
  const persistRef = useRef<((kim: number) => Promise<void>) | null>(null);

  const scheduleSave = useCallback(
    (kim: number, delayMs: number = DEBOUNCE_MS): void => {
      const existing = timersRef.current[kim];
      if (existing) clearTimeout(existing);
      timersRef.current[kim] = setTimeout(() => {
        delete timersRef.current[kim];
        const fn = persistRef.current;
        if (fn) void fn(kim);
      }, delayMs);
    },
    [],
  );

  // ─── Internal: persist single kim → server ────────────────────────────────
  const persistKim = useCallback(
    async (kim: number): Promise<void> => {
      if (disabled) return;
      if (inFlightRef.current.has(kim)) return; // already saving — debounce will requeue
      const draft = queueRef.current[kim];
      if (!draft) return; // nothing to save

      inFlightRef.current.add(kim);
      setStatusByKim((s) => ({ ...s, [kim]: 'saving' }));

      try {
        const res = await autosaveMockExamAnswer(attemptId, kim, draft.answer);
        // Success → drop from queue, update server-known, mark saved.
        const currentDraft = queueRef.current[kim];
        // Race guard: another keystroke might have arrived after we started
        // saving; only drop the queue entry if it hasn't been mutated since.
        if (currentDraft && currentDraft.queuedAt === draft.queuedAt) {
          delete queueRef.current[kim];
          writeQueueToStorage(attemptId, queueRef.current);
          serverKnownRef.current[kim] = draft.answer;
          setStatusByKim((s) => ({ ...s, [kim]: 'saved' }));
        } else {
          // Newer draft exists — schedule another save round (immediate).
          setStatusByKim((s) => ({ ...s, [kim]: 'pending' }));
          scheduleSave(kim, 0);
        }
        setLastSavedAt(res.saved_at);
        setIsOffline(false);
      } catch (err) {
        const isAuth =
          err instanceof StudentMockExamApiError && err.status === 401;
        // Auth errors are terminal — UI должно перехватить и показать «войди заново».
        // Network errors → keep in localStorage, mark offline.
        setStatusByKim((s) => ({ ...s, [kim]: 'error' }));
        if (!isAuth) {
          setIsOffline(true);
        }
        console.warn('[mock-exam-autosave] save failed for kim', kim, err);
      } finally {
        inFlightRef.current.delete(kim);
      }
    },
    [attemptId, disabled, scheduleSave],
  );

  // Wire the ref AFTER persistKim is defined so scheduleSave's setTimeout
  // callback can call into the latest persistKim. Updated on every render
  // where persistKim changes — that's only when attemptId/disabled change.
  persistRef.current = persistKim;

  // ─── Public: setAnswer ────────────────────────────────────────────────────
  const setAnswer = useCallback(
    (kim: number, value: string): void => {
      // Update UI state first — paint is non-blocking.
      setAnswers((prev) => ({ ...prev, [kim]: value }));
      setStatusByKim((s) => ({ ...s, [kim]: 'pending' }));

      // localStorage write — sync, before any async trip. Hard requirement:
      // even if browser crashes 1ms later, the answer is on disk.
      queueRef.current[kim] = { answer: value, queuedAt: Date.now() };
      writeQueueToStorage(attemptId, queueRef.current);

      // Debounced server save.
      if (!disabled) scheduleSave(kim);
    },
    [attemptId, disabled, scheduleSave],
  );

  // ─── Flush ALL queued kim (used by online event + before submit) ─────────
  const flushAllInternal = useCallback(async (): Promise<{ flushed: number; failed: number }> => {
    if (disabled) return { flushed: 0, failed: 0 };
    let flushed = 0;
    let failed = 0;
    const kims = Object.keys(queueRef.current).map((k) => Number.parseInt(k, 10));
    for (const kim of kims) {
      // Cancel pending timer; trigger immediate save.
      const timer = timersRef.current[kim];
      if (timer) {
        clearTimeout(timer);
        delete timersRef.current[kim];
      }
      try {
        await persistKim(kim);
        if (!queueRef.current[kim]) flushed += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { flushed, failed };
  }, [disabled, persistKim]);

  // ─── Listen to `online` event → auto-flush queued drafts ──────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      // Small delay to let other layers settle.
      setTimeout(() => {
        void flushAllInternal();
      }, ONLINE_FLUSH_DELAY_MS);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flushAllInternal]);

  // ─── Best-effort flush on tab close (sendBeacon if possible) ──────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBeforeUnload = () => {
      // Just write current queue to localStorage one more time — sendBeacon
      // path requires GoTrue token in headers, awkward; rely on next-tab
      // recovery via queue.
      writeQueueToStorage(attemptId, queueRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [attemptId]);

  // ─── Derived: pendingCount + hasUnsavedDraft ──────────────────────────────
  const pendingCount = Object.keys(queueRef.current).length;
  const hasUnsavedDraft = Object.entries(answers).some(([kimStr, value]) => {
    const kim = Number.parseInt(kimStr, 10);
    return serverKnownRef.current[kim] !== value;
  });

  return {
    answers,
    statusByKim,
    pendingCount,
    lastSavedAt,
    hasUnsavedDraft,
    isOffline,
    setAnswer,
    flush: flushAllInternal,
  };
}
