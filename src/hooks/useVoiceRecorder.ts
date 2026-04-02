import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";

const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export interface VoiceRecordingResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
  fileName: string;
}

function getPreferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return PREFERRED_AUDIO_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function getVoiceFileName(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "voice.ogg";
  if (normalized.includes("mp4")) return "voice.m4a";
  if (normalized.includes("mpeg")) return "voice.mp3";
  if (normalized.includes("wav")) return "voice.wav";
  return "voice.webm";
}

export const useVoiceRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const stopResolverRef = useRef<((value: VoiceRecordingResult | null) => void) | null>(null);
  const cancelOnStopRef = useRef(false);

  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";

  const clearDurationTimer = useCallback(() => {
    if (durationIntervalRef.current !== null) {
      window.clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    clearDurationTimer();

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = null;
    setRecordingDurationSeconds(0);
    setIsRecording(false);
  }, [clearDurationTimer]);

  useEffect(() => {
    return () => {
      cancelOnStopRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      toast({
        title: "Не поддерживается",
        description: "Голосовые сообщения работают только в современных браузерах с доступом к микрофону.",
        variant: "destructive",
      });
      return false;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = getPreferredAudioMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      cancelOnStopRef.current = false;
      chunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        const resolveStop = stopResolverRef.current;
        stopResolverRef.current = null;
        resolveStop?.(null);

        toast({
          title: "Ошибка записи",
          description: "Не удалось записать голосовое сообщение. Попробуй ещё раз.",
          variant: "destructive",
        });

        cleanupRecordingResources();
      };

      recorder.onstart = () => {
        startedAtRef.current = Date.now();
        setRecordingDurationSeconds(0);
        setIsRecording(true);

        clearDurationTimer();
        durationIntervalRef.current = window.setInterval(() => {
          const startedAt = startedAtRef.current;
          if (!startedAt) return;
          setRecordingDurationSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        }, 250);
      };

      recorder.onstop = () => {
        const stoppedAt = Date.now();
        const startedAt = startedAtRef.current ?? stoppedAt;
        const durationSeconds = Math.max(1, Math.round((stoppedAt - startedAt) / 1000));
        const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
        const shouldDiscard = cancelOnStopRef.current;
        const audioBlob = shouldDiscard
          ? null
          : new Blob(chunksRef.current, { type: mimeType });

        const resolveStop = stopResolverRef.current;
        stopResolverRef.current = null;

        cleanupRecordingResources();

        if (!resolveStop) {
          return;
        }

        if (!audioBlob || audioBlob.size === 0) {
          resolveStop(null);
          return;
        }

        resolveStop({
          blob: audioBlob,
          durationSeconds,
          mimeType,
          fileName: getVoiceFileName(mimeType),
        });
      };

      recorder.start();
      return true;
    } catch (error) {
      console.error("Failed to start voice recording:", error);
      cleanupRecordingResources();

      toast({
        title: "Нет доступа к микрофону",
        description: "Разреши доступ к микрофону в браузере и попробуй ещё раз.",
        variant: "destructive",
      });

      return false;
    }
  }, [cleanupRecordingResources, clearDurationTimer, isSupported]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve<VoiceRecordingResult | null>(null);
    }

    cancelOnStopRef.current = false;

    return new Promise<VoiceRecordingResult | null>((resolve) => {
      stopResolverRef.current = resolve;
      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    cancelOnStopRef.current = true;

    const resolveStop = stopResolverRef.current;
    stopResolverRef.current = null;
    resolveStop?.(null);

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    cleanupRecordingResources();
  }, [cleanupRecordingResources]);

  return {
    isRecording,
    isSupported,
    recordingDurationSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
  };
};
