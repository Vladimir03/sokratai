/**
 * AI task loader telemetry (kb-ai-task-loader, P0).
 *
 * PII-free: ids + counts only. NEVER task text, answers, folder names, emails,
 * or storage refs (rule 40 telemetry-convention). Typed overloads make the build
 * fail on an unregistered event / wrong payload (mirror homeworkTelemetry.ts).
 *
 * | Event               | Fire site                                  | Payload                                  |
 * |---------------------|--------------------------------------------|------------------------------------------|
 * | kb_ai_extract_run   | InputStage (after a successful extract)     | folderId, materialType, found, lowConf   |
 * | kb_ai_tasks_saved   | AiTaskLoaderPage (after a commit attempt)   | folderId, saved, skipped, failed, cropped|
 * | kb_ai_pdf_rendered  | InputStage (after PDF → page images)        | pageCount, renderedPages                 |
 * | kb_ai_draft_refined | AiTaskLoaderPage (успешный refine)          | folderId                                 |
 * | kb_ai_crop_action   | AiTaskLoaderPage/DraftCard (кроп-решение)   | action (edited/full/removed)             |
 *
 * Метрика точности AI-bbox = отношение edited/full/removed к suggested-кропам,
 * доехавшим до commit (поле cropped в kb_ai_tasks_saved).
 */

type KbAiLoaderEvent =
  | 'kb_ai_extract_run'
  | 'kb_ai_tasks_saved'
  | 'kb_ai_pdf_rendered'
  | 'kb_ai_draft_refined'
  | 'kb_ai_crop_action';

interface KbAiExtractRunPayload
  extends Record<string, string | number | boolean | null | undefined> {
  folderId: string;
  materialType: 'text' | 'image';
  found: number;
  lowConfAnswers: number;
  /** W3.1: сколько прогонов-чанков выполнено (большой PDF → авто-прогоны по 10). */
  chunks?: number;
}

interface KbAiTasksSavedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  folderId: string;
  saved: number;
  skipped: number;
  /** Волна 2: строки с ошибкой сохранения (остались на «Повторить неудачные»). */
  failed?: number;
  /** Волна 2: сколько задач сохранено с кропнутым рисунком. */
  cropped?: number;
  /** Волна 2: сбои кропа (задача сохранена без картинки). */
  cropFailed?: number;
}

interface KbAiPdfRenderedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  pageCount: number;
  renderedPages: number;
}

interface KbAiDraftRefinedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  folderId: string;
}

interface KbAiCropActionPayload
  extends Record<string, string | number | boolean | null | undefined> {
  /** edited = тутор правил рамку; full = «весь файл»; removed = рисунок убран. */
  action: 'edited' | 'full' | 'removed';
}

type KbAiLoaderPayload =
  | KbAiExtractRunPayload
  | KbAiTasksSavedPayload
  | KbAiPdfRenderedPayload
  | KbAiDraftRefinedPayload
  | KbAiCropActionPayload;

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
export function trackKbAiLoaderEvent(event: 'kb_ai_pdf_rendered', payload: KbAiPdfRenderedPayload): void;
export function trackKbAiLoaderEvent(event: 'kb_ai_draft_refined', payload: KbAiDraftRefinedPayload): void;
export function trackKbAiLoaderEvent(event: 'kb_ai_crop_action', payload: KbAiCropActionPayload): void;
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
