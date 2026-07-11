import type { ImageBbox } from '@/lib/kbAiExtractApi';

/**
 * Review-модель AI-загрузчика (волна 2, 2026-07-11).
 *
 * Контент черновика живёт в `ExtractedTask` (drafts[]); классификация,
 * которую тутор видит/правит ДО сохранения — в параллельном массиве
 * `ReviewOverrides` (пре-резолв темы при входе в ревью вместо «невидимого
 * сюрприза» на коммите). Commit читает ТОЛЬКО overrides.
 */
export interface ReviewOverrides {
  /** Резолвнутая/выбранная тема; null = не сматчено (amber в таблице). */
  topicId: string | null;
  subtopicId: string | null;
  sourceLabel: string;
  exam: '' | 'ege' | 'oge';
  /** Текстовый стейт инпута (пусто = нет КИМ). */
  kimNumber: string;
  /** Пусто = авто-балл по КИМ (физика) / без балла. */
  primaryScore: string;
}

/**
 * Состояние кропа рисунка задачи.
 * - `suggested` — рамка от AI, тутор не трогал (кропится на commit как есть — WYSIWYG);
 * - `edited` — тутор поправил рамку в BboxEditor;
 * - `full` — «прикрепить весь файл» (кроп отключён, едет оригинал).
 * null = кропа нет вообще (AI не дал bbox / рисунок убран / ручной файл).
 */
export interface CropState {
  bbox: ImageBbox | null;
  status: 'suggested' | 'edited' | 'full';
}

/** Per-row статус сохранения (bulk-commit, «Повторить неудачные»). */
export type RowStatus = 'idle' | 'saved' | 'failed';
