import type { ExtractedTask, ImageBbox } from '@/lib/kbAiExtractApi';
import type { ExamType, KBFolderTreeNode } from '@/types/kb';

/** Flatten folder tree into { id, name, depth } for <select> options (mirror
 *  CreateTaskModal). Живёт здесь (не в компонент-файле) ради react-refresh. */
export function flattenTree(
  nodes: KBFolderTreeNode[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

/**
 * «Тип» задачи в ревью (ВОЛНА 8, 2026-07-23). БД-enum `exam_type` = только
 * ege/oge (расширять НЕЛЬЗЯ — готча ALTER TYPE, skill kb-module): `olympiad`
 * и `other` (школьный экзамен, IELTS…) живут как `exam = NULL` в БД —
 * решение владельца, ноль миграций. Единственный конвертер на границе
 * БД/скоринга — `overrideExamToDb`.
 */
export type ReviewExam = '' | 'ege' | 'oge' | 'olympiad' | 'other';

/** ege/oge → как есть; ''/olympiad/other → null (exam-колонка БД, авто-балл, чекеры). */
export function overrideExamToDb(exam: ReviewExam): ExamType | null {
  return exam === 'ege' || exam === 'oge' ? exam : null;
}

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
  exam: ReviewExam;
  /** Текстовый стейт инпута (пусто = нет КИМ). */
  kimNumber: string;
  /**
   * Происхождение КИМ (техдолг ревью 5.6, 2026-07-23): 'marker' — из «Тип N»/
   * вариантной нумерации файла (детерминированный zip InputStage); 'ai' —
   * догадка модели; 'manual' — ручная правка/bulk в ревью; null — КИМ пуст.
   * Только UI-подсказка (чип у ячейки КИМ) — в БД не персистится.
   */
  kimSource: 'marker' | 'ai' | 'manual' | null;
  /** Пусто = авто-балл по КИМ (физика) / без балла. */
  primaryScore: string;
  /**
   * ВОЛНА 8: сложность 1–5 олимпиадной задачи (текстовый стейт селекта;
   * пусто = не задана). Пишется в `difficulty` И `primary_score` — зеркало
   * CreateTaskModal. Используется только при exam === 'olympiad'.
   */
  difficulty: string;
  /**
   * ВОЛНА 8: формат проверки; '' = авто (по № КИМ через subject-aware
   * `inferCheckFormatForSubject` — физика ЕГЭ 21–26, social ЕГЭ 17–25 → развёрнутое).
   */
  checkFormat: '' | 'short_answer' | 'detailed_solution';
  /**
   * ВОЛНА 8: папка НА ЗАДАНИЕ (запрос владельца «каждому заданию — своя папка»);
   * null = папка пачки (folderId Flow). Только KB-назначение.
   */
  folderId: string | null;
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
 * ВОЛНА 5 (2026-07-21): классификация по умолчанию на ВЕСЬ пакет, заданная в
 * InputStage ДО распознавания (запрос Милады «сначала предмет, потом темы»).
 * Применяется как начальный override КАЖДОЙ задачи; явный batch-дефолт побеждает
 * per-task подсказку AI (тутор задал тему — применить ко всем), переопределение
 * по одной остаётся в ревью. Пустые поля = не задано → фолбэк на AI-резолв.
 * Рендерится только для KB-назначения (`kb_folder`); hw/mock шлют пустой объект.
 */
export interface BatchClassification {
  exam: ReviewExam;
  topicId: string;
  subtopicId: string;
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
  /** ВОЛНА 8: refs скриншотов решения (kb-attachments), загруженных в ревью. */
  solutionRefs: string[];
}

/** Состояние для гарда закрытия Sheet-хоста (потеря черновиков / активный extract). */
export interface AiLoaderGuardState {
  /** true = идёт extract или commit — закрывать нельзя. */
  busy: boolean;
  /** true = ревью-стадия с черновиками — закрытие требует confirm. */
  hasDrafts: boolean;
}
