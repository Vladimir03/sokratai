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

import { useEffect, useRef, useState } from 'react';
import { Headphones, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getKBImageSignedUrl } from '@/lib/kbApi';
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

// ─── Аудио одного блока ──────────────────────────────────────────────────────

function BlockAudio({
  audioUrl,
  disabled,
  onChange,
  onUploadingChange,
}: {
  audioUrl: string | null;
  disabled: boolean;
  onChange: (ref: string | null) => void;
  onUploadingChange: (uploading: boolean) => void;
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
    onUploadingChange(true);
    setFileInfo(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} МБ`);
    try {
      const res = await uploadListeningAudio(file);
      onChange(res.storageRef);
      toast.success('Аудио загружено — проверьте воспроизведение');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить аудио');
    } finally {
      setUploading(false);
      onUploadingChange(false);
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
  onUploadingChange: (uploading: boolean) => void;
}) {
  const patchBlock = (id: string, patch: Partial<TaskBlockDraft>) => {
    onBlocksChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBlock = (id: string) => {
    // Привязки снимаем СРАЗУ: иначе задача уедет на сервер со ссылкой на
    // удалённый блок и словит BLOCK_NOT_FOUND уже на сохранении.
    tasks.filter((t) => t.blockId === id).forEach((t) => onBindTask(t.localId, null));
    onBlocksChange(blocks.filter((b) => b.id !== id));
  };

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

        {blocks.map((block, index) => {
          const boundCount = tasks.filter((t) => t.blockId === block.id).length;
          return (
            <div key={block.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
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
                    onChange={(e) => patchBlock(block.id, { title: e.target.value })}
                    placeholder="Exercice 1 — интервью"
                    className={INPUT_CLASS}
                  />
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeBlock(block.id)}
                  aria-label={`Удалить блок ${index + 1}`}
                  title="Удалить блок"
                  className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 [touch-action:manipulation]"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
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
                  onChange={(e) => patchBlock(block.id, { instruction: e.target.value })}
                  placeholder="Vous allez entendre deux fois un document. Lisez les questions…"
                  className={cn(INPUT_CLASS, 'resize-y leading-relaxed')}
                />
              </div>

              <BlockAudio
                audioUrl={block.audioUrl}
                disabled={disabled}
                onChange={(ref) => patchBlock(block.id, { audioUrl: ref })}
                onUploadingChange={onUploadingChange}
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
                    onChange={(e) => patchBlock(block.id, { transcript: e.target.value })}
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
                      const otherIndex = task.blockId
                        ? blocks.findIndex((b) => b.id === task.blockId)
                        : -1;
                      const takenByOther = !mine && otherIndex >= 0;
                      const label = task.kimNumber || `#${taskIndex + 1}`;
                      return (
                        <button
                          key={task.localId}
                          type="button"
                          disabled={disabled}
                          onClick={() => onBindTask(task.localId, mine ? null : block.id)}
                          title={
                            takenByOther
                              ? `Сейчас в блоке «${blockDisplayTitle(blocks[otherIndex], otherIndex)}» — нажмите, чтобы перенести сюда`
                              : undefined
                          }
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
                {boundCount === 0 && block.audioUrl ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Ни один вопрос не выбран — плеер покажется один раз над всей Частью 1.
                    Это нормально для цельной записи всей секции.
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
