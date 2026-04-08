import { useRef, useState } from 'react';

const TRAINER_SESSION_STORAGE_KEY = 'trainer_session_id';

function readStoredSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(TRAINER_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionId(sessionId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TRAINER_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Safari private mode can throw on localStorage writes.
  }
}

function getOrCreateSessionId(): string {
  const storedSessionId = readStoredSessionId();
  if (storedSessionId) {
    return storedSessionId;
  }

  const generatedSessionId = Math.random().toString(36).slice(2, 18);
  writeStoredSessionId(generatedSessionId);
  return generatedSessionId;
}

export function useTrainerSession(): { sessionId: string; startedAt: string } {
  const [sessionId] = useState(() => getOrCreateSessionId());
  const startedAtRef = useRef(new Date().toISOString());

  return {
    sessionId,
    startedAt: startedAtRef.current,
  };
}
