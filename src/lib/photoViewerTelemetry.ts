/**
 * Телеметрия просмотра и поворота фото (волна 1, план 1-ancient-quokka).
 *
 * Зеркало паттерна `homeworkTelemetry.ts` / `tutorPlanTelemetry.ts`:
 * типизированный реестр → console.info + dataLayer (GTM) + gtag. Отдельного
 * клиентского канала в `analytics_events` в проекте нет, и заводить его ради
 * этой фичи не нужно.
 *
 * PII-free по построению: только имя поверхности, угол и счётчики. НИКОГДА не
 * класть сюда storage-ref — это путь к файлу ученика (anti-leak, rule 40),
 * а трекер уходит наружу.
 *
 * Что меряем и зачем (метрики выбраны владельцем):
 *  • `photo_viewer_opened` / `photo_rotated` — guardrail волны 1: доля фото,
 *    которые всё ещё открывают сырой вкладкой браузера, должна дойти до нуля.
 *  • `photo_annotate_*` (волна 2) — главная метрика adoption: доля проверок
 *    с разметкой.
 */

/** Поверхность кабинета — по ней режем adoption. */
export type PhotoSurface =
  | 'homework_thread'
  | 'homework_task'
  | 'homework_preview'
  | 'homework_constructor'
  | 'mock_exam_review'
  | 'mock_exam_variant'
  | 'kb_task'
  | 'kb_editor'
  | 'tutor_student_chat'
  | 'lesson_materials';

interface ViewerOpenedPayload extends Record<string, string | number | boolean | undefined> {
  surface: PhotoSurface;
  count: number;
}

interface RotatedPayload extends Record<string, string | number | boolean | undefined> {
  surface: PhotoSurface;
  degrees: number;
  persisted: boolean;
}

interface AnnotateSentPayload extends Record<string, string | number | boolean | undefined> {
  surface: PhotoSurface;
  strokes: number;
  tools: string;
  duration_ms: number;
}

interface AnnotateSimplePayload extends Record<string, string | number | boolean | undefined> {
  surface: PhotoSurface;
}

interface DataLayerWindow extends Window {
  dataLayer?: Array<Record<string, unknown>>;
  gtag?: (...args: unknown[]) => void;
}

export function trackPhotoEvent(event: 'photo_viewer_opened', payload: ViewerOpenedPayload): void;
export function trackPhotoEvent(event: 'photo_rotated', payload: RotatedPayload): void;
export function trackPhotoEvent(event: 'photo_annotate_started', payload: AnnotateSimplePayload): void;
export function trackPhotoEvent(event: 'photo_annotate_discarded', payload: AnnotateSimplePayload): void;
export function trackPhotoEvent(event: 'photo_to_board', payload: AnnotateSimplePayload): void;
export function trackPhotoEvent(event: 'photo_annotate_sent', payload: AnnotateSentPayload): void;
export function trackPhotoEvent(
  event:
    | 'photo_viewer_opened'
    | 'photo_rotated'
    | 'photo_annotate_started'
    | 'photo_annotate_sent'
    | 'photo_annotate_discarded'
    | 'photo_to_board',
  payload: Record<string, string | number | boolean | undefined> = {},
): void {
  try {
    const safePayload: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) safePayload[key] = value;
    }
    const timestamp = new Date().toISOString();

    console.info('photo_event', { event, timestamp, ...safePayload });

    const win = window as DataLayerWindow;
    if (Array.isArray(win.dataLayer)) {
      win.dataLayer.push({ event, timestamp, ...safePayload });
    }
    if (typeof win.gtag === 'function') {
      win.gtag('event', event, safePayload);
    }
  } catch {
    // Телеметрия никогда не ломает просмотр.
  }
}
