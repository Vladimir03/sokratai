// Блоки заданий пробника — общий материал + N привязанных вопросов.
//
// Зачем (2026-08-01, данные прода): в варианте Эмилии «DELF B1 junior» одна и
// та же преамбула («Vous souhaitez faire un stage…») продублирована в шести
// задачах, а «Lisez l'article "APPRENDRE L'HISTOIRE AUTREMENT"» — в пяти.
// Вариант был плоским списком задач, общему материалу жить негде — репетитор
// копировал его руками. У DELF это структурная норма: каждый exercice = свой
// документ (текст статьи ИЛИ аудиотрек) + группа вопросов под ним.
//
// Аудио здесь — просто ОДИН ИЗ ВИДОВ материала блока, не отдельная механика.
// Ответ Эмилии на вопрос «один файл или несколько» — «и так и так»: один блок
// с треком и без привязок = общий плеер над всей Частью 1 (прежнее поведение
// variant-level трека); N блоков = плеер над каждой группой.
//
// ⚠️ ANTI-LEAK (rule 45): транскрипт живёт в драфте рядом с блоком ради UX, но
// НА ПРОВОД уходит отдельным объектом `block_transcripts` — в БД это отдельная
// колонка без column-GRANT'а, потому что транскрипт трека = ответы аудирования.
// Ученик видит его только после сдачи. Не «схлопывать» их в один объект.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getKBImageSignedUrl, uploadKBTaskImage, validateImageFile } from '@/lib/kbApi';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';
import { stripLatex } from '@/components/kb/ui/stripLatex';
import { uploadListeningAudio, validateListeningAudioFile } from '@/lib/mockExamApi';
import type { VariantTaskDraft } from './variantTaskDraft';

const INPUT_CLASS =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-base md:text-sm ' +
  'text-slate-900 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';

const TRANSCRIPT_MAX = 40000;
const INSTRUCTION_MAX = 8000;
export const MAX_TASK_BLOCKS = 10;

export interface TaskBlockDraft {
  /** Стабильный slug — на него ссылается VariantTaskDraft.blockId. */
  id: string;
  title: string;
  instruction: string;
  imageUrl: string | null;
  audioUrl: string | null;
  /** UI-only: на сервер уходит отдельным полем (см. шапку файла). */
  transcript: string;
}

/** Slug без UUID-шума: короткий, читаемый в JSON, проходит BLOCK_ID_RE на edge. */
export function createTaskBlock(index: number): TaskBlockDraft {
  return {
    id: `b${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    instruction: '',
    imageUrl: null,
    audioUrl: null,
    transcript: '',
  };
}

export function blockDisplayTitle(block: TaskBlockDraft, index: number): string {
  return block.title.trim() || `Блок ${index + 1}`;
}

// ─── Документ (фото) одного блока ────────────────────────────────────────────
//
// Один файл на блок: скан статьи/документа DELF. Бакет и валидатор те же, что
// у фото условия задачи — отдельного пути загрузки не заводим.

function BlockImage({
  imageUrl,
  disabled,
  onChange,
}: {
  imageUrl: string | null;
  disabled: boolean;
  onChange: (ref: string | null) => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstRef = parseAttachmentUrls(imageUrl)[0] ?? null;

  useEffect(() => {
    setFailed(false);
    setSignedUrl(null);
    if (!firstRef) return;
    let cancelled = false;
    void getKBImageSignedUrl(firstRef).then((url) => {
      if (cancelled) return;
      if (url) setSignedUrl(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [firstRef]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploading(true);
    try {
      const res = await uploadKBTaskImage(file);
      onChange(res.storageRef);
      toast.success('Документ прикреплён');
    } catch {
      toast.error('Не удалось загрузить документ');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {firstRef ? (
        failed ? (
          <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-1 text-center text-[10px] font-medium leading-tight text-amber-700">
            Файл недоступен
          </div>
        ) : signedUrl ? (
          <img
            loading="lazy"
            src={signedUrl}
            alt="Документ блока"
            onError={() => setFailed(true)}
            className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <ImagePlus className="h-4 w-4 animate-pulse text-slate-300" aria-hidden="true" />
          </div>
        )
      ) : null}
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50 [touch-action:manipulation]"
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {firstRef ? 'Заменить документ' : 'Документ (фото)'}
      </button>
      {firstRef ? (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => onChange(null)}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 [touch-action:manipulation]"
        >
          Убрать
        </button>
      ) : null}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}

// ─── Аудио одного блока ──────────────────────────────────────────────────────

function BlockAudio({
  audioUrl,
  disabled,
  onChange,
  onUploadingChange,
  uploadKey,
}: {
  audioUrl: string | null;
  disabled: boolean;
  onChange: (ref: string | null) => void;
  /** P0-2: ключ блока, а не голый boolean — параллельные загрузки. */
  onUploadingChange: (key: string, uploading: boolean) => void;
  uploadKey: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [audioFailed, setAudioFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAudioFailed(false);
    setSignedUrl(null);
    if (!audioUrl) return;
    let cancelled = false;
    void getKBImageSignedUrl(audioUrl).then((url) => {
      if (cancelled) return;
      if (url) setSignedUrl(url);
      else setAudioFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationError = validateListeningAudioFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploading(true);
    onUploadingChange(uploadKey, true);
    setFileInfo(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} МБ`);
    try {
      const res = await uploadListeningAudio(file);
      onChange(res.storageRef);
      toast.success('Аудио загружено — проверьте воспроизведение');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить аудио');
    } finally {
      setUploading(false);
      onUploadingChange(uploadKey, false);
      setFileInfo(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50 [touch-action:manipulation]"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Headphones className="h-4 w-4" aria-hidden="true" />
          )}
          {uploading ? 'Загружаем…' : audioUrl ? 'Заменить аудио' : 'Загрузить аудио'}
        </button>
        {audioUrl ? (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => onChange(null)}
            className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 [touch-action:manipulation]"
          >
            Убрать
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.ogg,.wav"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      {uploading && fileInfo ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Загружаем {fileInfo} — большой файл может идти 1–3 минуты. Не закрывайте
          страницу и не нажимайте «Сохранить», пока загрузка не завершится.
        </p>
      ) : null}

      {audioUrl ? (
        audioFailed ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Аудиофайл недоступен — загрузите заново.
          </p>
        ) : signedUrl ? (
          // Self-check: репетитор слышит, что именно загрузилось.
          <audio controls preload="metadata" src={signedUrl} className="min-h-11 w-full [touch-action:manipulation]">
            Ваш браузер не поддерживает воспроизведение аудио.
          </audio>
        ) : (
          <div className="flex h-10 items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Готовим плеер…
          </div>
        )
      ) : null}
    </div>
  );
}

// ─── Карточка одного блока ───────────────────────────────────────────────────
//
// memo ОБЯЗАТЕЛЕН (Этап 0, перф-критерий №4 research task-blocks): секция
// держит до 10 блоков × N чипов задач, и до выноса каждый keystroke в
// инструкции пересоздавал массив blocks → перерисовывалась ВСЯ секция
// (~300 кнопок + эффекты BlockImage/BlockAudio). Родитель передаёт СТАБИЛЬНЫЕ
// колбэки (useCallback поверх ref'ов на живые blocks/tasks), поэтому при
// правке блока i перерисовывается только его карточка.

interface BlockCardProps {
  block: TaskBlockDraft;
  index: number;
  tasks: VariantTaskDraft[];
  disabled: boolean;
  transcriptDisabled: boolean;
  onPatch: (id: string, patch: Partial<TaskBlockDraft>) => void;
  onSetAudio: (id: string, ref: string | null) => void;
  onRemove: (id: string) => void;
  onBindTask: (taskLocalId: string, blockId: string | null) => void;
  onBindRange: (blockId: string, from: number, to: number) => void;
  /** Название чужого блока для тултипа «занято» — через ref, чтобы memo жил. */
  getBlockLabel: (blockId: string) => string | null;
  onUploadingChange: (key: string, uploading: boolean) => void;
}

const BlockCard = memo(function BlockCard({
  block,
  index,
  tasks,
  disabled,
  transcriptDisabled,
  onPatch,
  onSetAudio,
  onRemove,
  onBindTask,
  onBindRange,
  getBlockLabel,
  onUploadingChange,
}: BlockCardProps) {
  // P1-7 ревью 5.6: удаление блока стирает текст, транскрипт и все привязки.
  // Два шага вместо одного клика по маленькой корзине — в create-режиме
  // восстановить введённую статью нечем.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');

  const boundCount = tasks.filter((t) => t.blockId === block.id).length;

  /** P1-4 ревью 5.6: вопросы блока идут не подряд → у ученика будет НЕСКОЛЬКО
   *  шапок с одним материалом (группировка идёт по смежным отрезкам). Это
   *  предсказуемо, но молчать нельзя — она ждёт один общий блок. */
  const boundIndexes = tasks
    .map((t, i) => (t.blockId === block.id ? i : -1))
    .filter((i) => i >= 0);
  const hasGap =
    boundIndexes.length >= 2 &&
    boundIndexes[boundIndexes.length - 1] - boundIndexes[0] + 1 !== boundIndexes.length;

  const handleBindRange = () => {
    const from = parseInt(rangeFrom.trim(), 10);
    const to = parseInt(rangeTo.trim(), 10);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 1 ||
      to > tasks.length ||
      from > to
    ) {
      toast.error(`Укажите диапазон в пределах от 1 до ${tasks.length}`);
      return;
    }
    onBindRange(block.id, from, to);
    setRangeFrom('');
    setRangeTo('');
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="mb-1 block text-xs font-semibold text-slate-500">
            Название блока {index + 1}
          </Label>
          <input
            type="text"
            value={block.title}
            disabled={disabled}
            maxLength={120}
            onChange={(e) => onPatch(block.id, { title: e.target.value })}
            placeholder="Exercice 1 — интервью"
            className={INPUT_CLASS}
          />
        </div>
        {confirmRemove ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onRemove(block.id)}
              className="rounded-md bg-red-600 px-2.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 [touch-action:manipulation]"
            >
              Удалить
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="rounded-md px-2 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 [touch-action:manipulation]"
            >
              Отмена
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // Пустой и ни с чем не связанный блок сносим сразу —
              // подтверждать нечего.
              const isEmpty = !block.title.trim() && !block.instruction.trim()
                && !block.audioUrl && !block.imageUrl && !block.transcript.trim()
                && boundCount === 0;
              if (isEmpty) onRemove(block.id);
              else setConfirmRemove(true);
            }}
            aria-label={`Удалить блок ${index + 1}`}
            title="Удалить блок"
            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 [touch-action:manipulation]"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div>
        <Label className="mb-1 block text-xs font-semibold text-slate-500">
          Общий текст <span className="font-normal text-slate-400">(виден ученику над вопросами блока)</span>
        </Label>
        <textarea
          value={block.instruction}
          disabled={disabled}
          rows={4}
          maxLength={INSTRUCTION_MAX}
          onChange={(e) => onPatch(block.id, { instruction: e.target.value })}
          placeholder="Vous allez entendre deux fois un document. Lisez les questions…"
          className={cn(INPUT_CLASS, 'resize-y leading-relaxed')}
        />
      </div>

      {/* P1-3 ревью 5.6: раньше контракт и подпись секции обещали
          «документ», а загрузить его было нечем — скан DELF прикрепить
          невозможно, скопированное фото не проверить и не убрать. */}
      <BlockImage
        imageUrl={block.imageUrl}
        disabled={disabled}
        onChange={(ref) => onPatch(block.id, { imageUrl: ref })}
      />

      <BlockAudio
        audioUrl={block.audioUrl}
        disabled={disabled}
        onChange={(ref) => onSetAudio(block.id, ref)}
        onUploadingChange={onUploadingChange}
        uploadKey={block.id}
      />

      {block.audioUrl ? (
        <div>
          <Label className="mb-1 block text-xs font-semibold text-slate-500">
            Транскрипт записи
          </Label>
          <textarea
            value={block.transcript}
            disabled={transcriptDisabled}
            rows={4}
            maxLength={TRANSCRIPT_MAX}
            onChange={(e) => onPatch(block.id, { transcript: e.target.value })}
            placeholder="Вставьте текст записи. Ученик увидит его только после сдачи — как разбор."
            className={cn(INPUT_CLASS, 'min-h-[100px] resize-y leading-relaxed')}
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              До сдачи транскрипт ученику не показывается.
            </p>
            {/* Браузер молча обрезает paste на maxLength — счётчик делает лимит видимым. */}
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                block.transcript.length >= TRANSCRIPT_MAX
                  ? 'font-semibold text-amber-600'
                  : 'text-slate-400',
              )}
            >
              {block.transcript.length.toLocaleString('ru-RU')} / 40 000
            </span>
          </div>
        </div>
      ) : null}

      <div>
        <Label className="mb-1.5 block text-xs font-semibold text-slate-500">
          Вопросы блока{' '}
          <span className="font-normal text-slate-400">
            {boundCount > 0 ? `— выбрано ${boundCount}` : '— нажмите номера'}
          </span>
        </Label>
        {tasks.length === 0 ? (
          <p className="text-xs text-slate-400">Сначала добавьте задачи ниже.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tasks.map((task, taskIndex) => {
              const mine = task.blockId === block.id;
              const takenByOther = !mine && Boolean(task.blockId);
              const label = task.kimNumber || `#${taskIndex + 1}`;
              // Этап 0: чип «#7» без текста вопроса — чистый recall (у DELF
              // КИМ пуст). Превью условия в native-тултипе; на мобиле его
              // компенсирует привязка диапазоном ниже.
              const snippet = stripLatex(task.taskText || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 80);
              const takenHint = takenByOther
                ? `Сейчас в блоке «${getBlockLabel(task.blockId as string) ?? '…'}» — нажмите, чтобы перенести сюда`
                : null;
              const chipTitle = [snippet || null, takenHint].filter(Boolean).join('\n');
              return (
                <button
                  key={task.localId}
                  type="button"
                  disabled={disabled}
                  onClick={() => onBindTask(task.localId, mine ? null : block.id)}
                  title={chipTitle || undefined}
                  className={cn(
                    'min-w-11 rounded-lg border px-2.5 py-1.5 text-sm font-medium tabular-nums transition-colors disabled:opacity-50 [touch-action:manipulation]',
                    mine
                      ? 'border-accent bg-accent text-white'
                      : takenByOther
                        ? 'border-slate-200 bg-slate-100 text-slate-400'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-accent/40 hover:text-accent',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {/* Этап 0: группы ФИПИ всегда смежные (русский 23–26, химия 29–30,
            DELF-exercice) — диапазон закрывает основной жест одним действием
            вместо N кликов по чипам на длинных вариантах (у Эмилии 29 задач). */}
        {tasks.length >= 3 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">Привязать подряд:</span>
            <input
              type="text"
              inputMode="numeric"
              value={rangeFrom}
              disabled={disabled}
              onChange={(e) => setRangeFrom(e.target.value)}
              placeholder="с №"
              aria-label="Привязать с задачи №"
              className={cn(INPUT_CLASS, 'h-9 w-16 px-2 py-1 text-center')}
            />
            <span className="text-xs text-slate-400">—</span>
            <input
              type="text"
              inputMode="numeric"
              value={rangeTo}
              disabled={disabled}
              onChange={(e) => setRangeTo(e.target.value)}
              placeholder="по №"
              aria-label="Привязать по задачу №"
              className={cn(INPUT_CLASS, 'h-9 w-16 px-2 py-1 text-center')}
            />
            <button
              type="button"
              disabled={disabled || !rangeFrom.trim() || !rangeTo.trim()}
              onClick={handleBindRange}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50 [touch-action:manipulation]"
            >
              Привязать
            </button>
            <span className="text-xs text-slate-400">
              № — порядковый номер задачи в списке (1–{tasks.length})
            </span>
          </div>
        ) : null}
        {boundCount === 0 && block.audioUrl ? (
          <p className="mt-1.5 text-xs text-slate-500">
            Ни один вопрос не выбран — плеер покажется один раз над всей Частью 1.
            Это нормально для цельной записи всей секции.
          </p>
        ) : null}
        {hasGap ? (
          <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            Вопросы блока идут не подряд — ученик увидит материал столько раз,
            сколько получится отдельных групп. Чтобы блок показался один раз,
            переставьте вопросы так, чтобы они шли друг за другом.
          </p>
        ) : null}
      </div>
    </div>
  );
});

// ─── Секция ──────────────────────────────────────────────────────────────────

export function TaskBlocksSection({
  blocks,
  tasks,
  disabled,
  transcriptDisabled,
  onBlocksChange,
  onBindTask,
  onUploadingChange,
}: {
  blocks: TaskBlockDraft[];
  /** Нужны для чипов привязки — источник истины по blockId остаётся в задачах. */
  tasks: VariantTaskDraft[];
  disabled: boolean;
  /** Отдельный гейт: prefill транскриптов идёт своим edge-запросом (data-loss гард). */
  transcriptDisabled: boolean;
  onBlocksChange: (next: TaskBlockDraft[]) => void;
  onBindTask: (taskLocalId: string, blockId: string | null) => void;
  onUploadingChange: (key: string, uploading: boolean) => void;
}) {
  // Живые ссылки для СТАБИЛЬНЫХ колбэков: без них memo на BlockCard мёртв
  // (любая зависимость от blocks пересоздавала бы колбэки на каждый keystroke).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const patchBlock = useCallback(
    (id: string, patch: Partial<TaskBlockDraft>) => {
      onBlocksChange(blocksRef.current.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [onBlocksChange],
  );

  // P1-6 ревью 5.6: транскрипт — спутник КОНКРЕТНОЙ записи. Раньше он переживал
  // удаление и замену трека (поле лишь скрывалось) и после новой загрузки
  // публиковался ученику как разбор новой записи. Чистим и говорим об этом.
  const setBlockAudio = useCallback(
    (id: string, ref: string | null) => {
      const block = blocksRef.current.find((b) => b.id === id);
      const hadTranscript = Boolean(block?.transcript.trim());
      patchBlock(id, hadTranscript ? { audioUrl: ref, transcript: '' } : { audioUrl: ref });
      if (hadTranscript) {
        toast.info(
          ref
            ? 'Транскрипт очищен — он относился к прежней записи. Вставьте текст новой.'
            : 'Транскрипт очищен вместе с записью.',
        );
      }
    },
    [patchBlock],
  );

  const removeBlock = useCallback(
    (id: string) => {
      // Привязки снимаем СРАЗУ: иначе задача уедет на сервер со ссылкой на
      // удалённый блок и словит BLOCK_NOT_FOUND уже на сохранении.
      tasksRef.current.filter((t) => t.blockId === id).forEach((t) => onBindTask(t.localId, null));
      onBlocksChange(blocksRef.current.filter((b) => b.id !== id));
    },
    [onBindTask, onBlocksChange],
  );

  const getBlockLabel = useCallback((blockId: string): string | null => {
    const list = blocksRef.current;
    const i = list.findIndex((b) => b.id === blockId);
    return i < 0 ? null : blockDisplayTitle(list[i], i);
  }, []);

  // Диапазон = цикл по существующему onBindTask: он функциональный
  // (setState(prev => …)), поэтому серия вызовов компонуется корректно и
  // батчится React 18 — отдельный bulk-канал в редакторе не нужен.
  const bindRange = useCallback(
    (blockId: string, from: number, to: number) => {
      const slice = tasksRef.current.slice(from - 1, to);
      let moved = 0;
      for (const t of slice) {
        if (t.blockId && t.blockId !== blockId) moved += 1;
        if (t.blockId !== blockId) onBindTask(t.localId, blockId);
      }
      toast.success(
        moved > 0
          ? `Привязано задач: ${slice.length}, из них перенесено из других блоков: ${moved}`
          : `Привязано задач: ${slice.length}`,
      );
    },
    [onBindTask],
  );

  return (
    <Card animate={false}>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Блоки заданий · необязательно
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Общий материал для группы вопросов: текст статьи, документ или аудиотрек.
              Пишете его один раз — он не дублируется в каждом вопросе.
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || blocks.length >= MAX_TASK_BLOCKS}
            onClick={() => onBlocksChange([...blocks, createTaskBlock(blocks.length)])}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50 [touch-action:manipulation]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить блок
          </button>
        </div>

        {blocks.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
            Блоков нет — каждый вопрос показывается сам по себе. Для аудирования
            добавьте блок и прикрепите к нему трек.
          </p>
        ) : null}

        {blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            block={block}
            index={index}
            tasks={tasks}
            disabled={disabled}
            transcriptDisabled={transcriptDisabled}
            onPatch={patchBlock}
            onSetAudio={setBlockAudio}
            onRemove={removeBlock}
            onBindTask={onBindTask}
            onBindRange={bindRange}
            getBlockLabel={getBlockLabel}
            onUploadingChange={onUploadingChange}
          />
        ))}
      </CardContent>
    </Card>
  );
}
