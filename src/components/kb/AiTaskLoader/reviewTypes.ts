import type { ExtractedTask, ImageBbox } from '@/lib/kbAiExtractApi';

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

/**
 * W4 (2026-07-16): честность о полноте распознавания. Ожидание считается по
 * маркерам нумерации текстового слоя цифрового PDF (`countSequentialTaskMarkers`);
 * null = ожидание неизвестно (сканы/скриншоты/текст без сквозной нумерации).
 */
export interface ExtractCompleteness {
  /** Σ маркеров нумерации по всем страницам (null = неизвестно). */
  expectedTotal: number | null;
  /** Чанки, где после авто-повтора распознано меньше ожидаемого. */
  shortfalls: { pages: string; got: number; expected: number }[];
}

/**
 * «Один загрузчик — N назначений» (фаза 1, 2026-07-20): куда уходят
 * распознанные задачи после ревью. Extract-ядро и ревью-UI общие; отличается
 * только commit-адаптер:
 * - `kb_folder` — прежний путь: bulk insertTask в выбранную папку Базы;
 * - `hw_draft`  — конструктор ДЗ: задачи возвращаются колбэком, запись в БД
 *   идёт существующим path A (никаких новых write-path — rule 40); Базу
 *   наполнит авто-зеркало «Из ДЗ» при сохранении ДЗ.
 * Будущий `mock_variant` (фаза 2) — третий член union со своим onCommit.
 */
export type AiLoaderDestination =
  | { kind: 'kb_folder'; initialFolderId: string }
  | {
      kind: 'hw_draft';
      /** Предмет ДЗ (meta.subject конструктора) — форсится в InputStage. */
      subject: string;
      /** Lazy find-or-create папки «Из ДЗ» — удовлетворяет folder-гейт edge. */
      resolveFolderId: () => Promise<string>;
      /** Commit-адаптер: получает выбранные задачи после кроп-пайплайна. */
      onCommit: (items: AiLoaderCommitItem[]) => void;
    }
  | {
      /** Фаза 2 пуш 3: конструктор варианта пробника (mock_exam_variant_tasks
       *  через editor state → edge POST/PUT; в Базу НЕ зеркалится). */
      kind: 'mock_variant';
      subject: string;
      resolveFolderId: () => Promise<string>;
      onCommit: (items: AiLoaderCommitItem[]) => void;
    };

/** Единица commit'а для не-KB назначений (после кроп-он-коммит пайплайна). */
export interface AiLoaderCommitItem {
  draft: ExtractedTask;
  override: ReviewOverrides;
  /** Финальный ref картинки: кроп-ref | оригинал | null (убрана / сбой кропа). */
  attachmentRef: string | null;
}

/** Состояние для гарда закрытия Sheet-хоста (потеря черновиков / активный extract). */
export interface AiLoaderGuardState {
  /** true = идёт extract или commit — закрывать нельзя. */
  busy: boolean;
  /** true = ревью-стадия с черновиками — закрытие требует confirm. */
  hasDrafts: boolean;
}
