/**
 * AI task loader telemetry (kb-ai-task-loader, P0).
 *
 * PII-free: ids + counts only. NEVER task text, answers, folder names, emails,
 * or storage refs (rule 40 telemetry-convention). Typed overloads make the build
 * fail on an unregistered event / wrong payload (mirror homeworkTelemetry.ts).
 *
 * | Event              | Fire site                                  | Payload                                  |
 * |--------------------|--------------------------------------------|------------------------------------------|
 * | kb_ai_extract_run  | InputStage (after a successful extract)     | folderId, materialType, found, lowConf   |
 * | kb_ai_tasks_saved  | AiTaskLoaderPage (after a commit attempt)   | folderId, saved, skipped                 |
 */

type KbAiLoaderEvent = 'kb_ai_extract_run' | 'kb_ai_tasks_saved';

interface KbAiExtractRunPayload
  extends Record<string, string | number | boolean | null | undefined> {
  folderId: string;
  materialType: 'text' | 'image';
  found: number;
  lowConfAnswers: number;
}

interface KbAiTasksSavedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  folderId: string;
  saved: number;
  skipped: number;
}

type KbAiLoaderPayload = KbAiExtractRunPayload | KbAiTasksSavedPayload;

interface DataLayerWindow extends Window {
  dataLayer?: Array<Record<string, unknown>>;
  gtag?: (...args: unknown[]) => void;
}

function toSafePayload(payload: KbAiLoaderPayload): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    safe[key] = value;
  }
  return safe;
}

export function trackKbAiLoaderEvent(event: 'kb_ai_extract_run', payload: KbAiExtractRunPayload): void;
export function trackKbAiLoaderEvent(event: 'kb_ai_tasks_saved', payload: KbAiTasksSavedPayload): void;
export function trackKbAiLoaderEvent(event: KbAiLoaderEvent, payload: KbAiLoaderPayload): void {
  const safePayload = toSafePayload(payload);
  const timestamp = new Date().toISOString();
  console.info('kb_ai_loader_event', { event, timestamp, ...safePayload });

  const win = window as DataLayerWindow;
  if (Array.isArray(win.dataLayer)) {
    win.dataLayer.push({ event, timestamp, ...safePayload });
  }
  if (typeof win.gtag === 'function') {
    win.gtag('event', event, safePayload);
  }
}
