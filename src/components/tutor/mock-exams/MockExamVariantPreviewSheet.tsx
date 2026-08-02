// Mock Exams v1 — FIX-2: variant preview drawer.
//
// Job: репетитор хочет увидеть содержимое варианта ДО назначения, чтобы
// убедиться что задачи и сложность подходят его ученикам. Без этого
// преподаватели «покупают вслепую» и теряют доверие.
//
// Контракт:
// - Читает mock_exam_variants + mock_exam_variant_tasks напрямую через
//   PostgREST. RLS policy «Mock variants read by authenticated» / «Mock
//   variant tasks read by authenticated» (миграция
//   20260508120000_mock_exams_v1_schema.sql) разрешает любой authenticated
//   read — каталог вариантов общий, не tutor-specific.
// - Показывает task_text + task_image_url + correct_answer + solution_text.
//   correct_answer / solution_text видны TOLKO репетитору в этом drawer'е
//   (он уже залогинен через TutorGuard), а student'у — никогда.
// - Изображения резолвятся через supabase.storage.createSignedUrl (1h TTL),
//   path извлекается через локальный parseStorageRef (mirror студенческой
//   логики в StudentMockExam.tsx). Storage путь возвращается с proxy host'ом
//   автоматически (RU bypass в supabaseClient.ts).
//
// Анти-патерны исключены (.claude/rules/90-design-system.md):
//   • Lucide icons only
//   • shadcn Sheet / Card / Badge
//   • text-base (16px) для accessibility
//   • SheetContent w-[80vw] !max-w-3xl на десктопе, full на мобиле
//   • КaTeX через lazy MathText (тяжёлая, гружается по факту открытия drawer)

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  GraduationCap,
  Headphones,
  ImageIcon,
  Library,
  Loader2,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';
import {
  PhotoViewer,
  SafeImage,
  type PhotoViewerItem,
  usePhotoViewer,
} from '@/components/common/photo-viewer';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

// TASK-OCR Round 7 (2026-05-21): mirror StudentMockExam.tsx markdown-detect
// логика — task_text может содержать GFM-таблицы (КИМ 6/10/14/15/17 для
// варианта 1, КИМ 6/20 для варианта 2). MathText один не рендерит таблицы;
// MarkdownTaskText (react-markdown + remark-gfm + remark-math + rehype-katex)
// рендерит. Не используем MarkdownTaskText напрямую для всех task_text —
// тяжёлая (~80KB gz), lazy-load'им только когда регекс матчит таблицу.
const MarkdownTableRenderer = lazy(() =>
  import('@/components/student/mock-exam/MarkdownTaskText').then((m) => ({
    default: m.MarkdownTaskText,
  })),
);

// Single source of truth для GFM table detection — mirror
// StudentMockExam::MARKDOWN_TABLE_RE (line ~229).
const MARKDOWN_TABLE_RE = /\n\s*\|.+\|\s*\n\s*\|\s*[:\-| ]+\|\s*\n/;

interface VariantSummaryRow {
  id: string;
  title: string;
  exam_type: string;
  source: string | null;
  source_attribution: string | null;
  duration_minutes: number;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
  /**
   * Блоки заданий (2026-08-02): общий материал над группой вопросов.
   * ⚠️ Транскриптов здесь НЕТ и быть не может: `block_transcripts_json` не
   * гранится authenticated (rule 45 — это ответы аудирования), и его
   * добавление в select уронило бы ВЕСЬ запрос. Превью и так показывает
   * то, что увидит ученик, а ученик транскрипт до сдачи не видит.
   */
  task_blocks_json?: PreviewTaskBlock[] | null;
}

interface PreviewTaskBlock {
  id: string;
  title?: string | null;
  instruction?: string | null;
  image_url?: string | null;
  audio_url?: string | null;
}

interface VariantTaskRow {
  id: string;
  kim_number: number;
  part: 1 | 2;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  solution_text: string | null;
  // 2026-06-07: фото эталонного решения Части 2 (dual-format: single ref OR
  // JSON-array). Tutor-only превью ДО выдачи — рядом с solution_text.
  solution_image_urls: string | null;
  check_mode: string | null;
  max_score: number;
  topic: string | null;
  /** Привязка к элементу task_blocks_json[].id; null = задача вне блока. */
  block_id?: string | null;
}

function parseTaskImageRefs(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        );
      }
    } catch {
      return [];
    }
  }
  return [trimmed];
}

function parseStorageRef(
  ref: string,
): { bucket: string; path: string } | null {
  if (!ref.startsWith('storage://')) return null;
  const rest = ref.slice('storage://'.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) return null;
  return {
    bucket: rest.slice(0, slashIndex),
    path: rest.slice(slashIndex + 1),
  };
}

async function resolveRefsToSignedUrls(refs: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const ref of refs) {
    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      urls.push(ref);
      continue;
    }
    const parsed = parseStorageRef(ref);
    if (!parsed) continue;
    try {
      const { data, error } = await supabase.storage
        .from(parsed.bucket)
        .createSignedUrl(parsed.path, 60 * 60);
      if (!error && data?.signedUrl) {
        urls.push(data.signedUrl);
      }
    } catch {
      // Best-effort — пропускаем сломанный ref, остальные грузим.
    }
  }
  return urls;
}

// Резолвит refs из одного поля (task_image_url ИЛИ solution_image_urls) в signed
// URLs, keyed by kim_number. Sequential — ~13 картинок на вариант, не критично.
async function resolveImagesByKim(
  tasks: VariantTaskRow[],
  pick: (task: VariantTaskRow) => string | null,
): Promise<Record<number, string[]>> {
  const result: Record<number, string[]> = {};
  for (const task of tasks) {
    const refs = parseTaskImageRefs(pick(task));
    if (refs.length === 0) continue;
    const urls = await resolveRefsToSignedUrls(refs);
    if (urls.length > 0) {
      result[task.kim_number] = urls;
    }
  }
  return result;
}

/** Подписывает медиа блоков (2026-08-02). Параллельно, а не в цикле: блоков
 *  до 10, у каждого до двух файлов — последовательные RTT затянули бы открытие
 *  превью на секунды. Аудио живёт в приватном бакете с own-namespace RLS,
 *  поэтому у ЧУЖОГО (каталожного) варианта подпись честно не сработает —
 *  шапка тогда скажет об этом прямо, а не притворится, что аудио нет. */
async function resolveBlockMedia(
  blocks: PreviewTaskBlock[] | null,
): Promise<Record<string, { audio: string | null; image: string | null }>> {
  if (!Array.isArray(blocks) || blocks.length === 0) return {};
  const entries = await Promise.all(
    blocks.filter((b) => b?.id).map(async (block) => {
      const [audio, image] = await Promise.all([
        block.audio_url ? resolveRefsToSignedUrls([block.audio_url]) : Promise.resolve([]),
        block.image_url ? resolveRefsToSignedUrls([block.image_url]) : Promise.resolve([]),
      ]);
      return [block.id, { audio: audio[0] ?? null, image: image[0] ?? null }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function MathBlock({ text, className }: { text: string; className?: string }) {
  // Round 7 (2026-05-21): markdown-table fast path — mirror StudentMockExam.
  const hasMarkdownTable = MARKDOWN_TABLE_RE.test(text);
  if (hasMarkdownTable) {
    return (
      <Suspense
        fallback={
          <div className={cn('whitespace-pre-wrap', className)}>{text}</div>
        }
      >
        <MarkdownTableRenderer text={text} className={className} />
      </Suspense>
    );
  }
  return (
    <Suspense
      fallback={
        <div className={cn('whitespace-pre-wrap', className)}>{text}</div>
      }
    >
      <MathText text={text} className={cn('whitespace-pre-wrap', className)} />
    </Suspense>
  );
}

interface CollapsibleProps {
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'amber';
}

function Collapsible({ title, children, tone = 'default' }: CollapsibleProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'mt-3 overflow-hidden rounded-md border',
        tone === 'amber'
          ? 'border-amber-200 bg-amber-50/60'
          : 'border-slate-200 bg-slate-50/60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium',
          tone === 'amber' ? 'text-amber-900' : 'text-slate-700',
        )}
        aria-expanded={open}
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform',
            open && 'rotate-180',
            tone === 'amber' ? 'text-amber-700' : 'text-slate-500',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          className={cn(
            'border-t px-3 py-2.5 text-sm',
            tone === 'amber'
              ? 'border-amber-200 text-amber-950'
              : 'border-slate-200 text-slate-700',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface PreviewTaskCardProps {
  task: VariantTaskRow;
  imageUrls: string[];
  solutionImageUrls: string[];
}

function PreviewTaskCard({ task, imageUrls, solutionImageUrls }: PreviewTaskCardProps) {
  const isPart1 = task.part === 1;

  // Условие и эталон — разные просмотрщики: листать стрелками между схемой
  // задачи и эталонным решением было бы дезориентирующе.
  const conditionViewer = usePhotoViewer();
  const solutionViewer = usePhotoViewer();

  const conditionItems = useMemo<PhotoViewerItem[]>(
    () =>
      imageUrls.map((url, idx) => ({
        url,
        caption:
          task.kim_number === 20
            ? `Схема ${idx + 1} · задание №${task.kim_number}`
            : `Иллюстрация к заданию №${task.kim_number}`,
        alt: `Иллюстрация к заданию ${task.kim_number}`,
      })),
    [imageUrls, task.kim_number],
  );

  const solutionItems = useMemo<PhotoViewerItem[]>(
    () =>
      solutionImageUrls.map((url, idx) => ({
        url,
        caption: `Эталон решения №${task.kim_number} · фото ${idx + 1}`,
        alt: `Эталон решения №${task.kim_number} — фото ${idx + 1}`,
      })),
    [solutionImageUrls, task.kim_number],
  );

  return (
    <Card animate={false} className="border-slate-200">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'border-transparent text-xs font-semibold',
                isPart1
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-amber-100 text-amber-900',
              )}
            >
              №{task.kim_number}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {isPart1 ? 'Часть 1' : 'Часть 2'}
              {task.topic ? <> · {task.topic}</> : null}
            </span>
          </div>
          <span className="text-xs font-medium text-slate-600 tabular-nums">
            {task.max_score} балл{task.max_score === 1 ? '' : 'а'}
          </span>
        </div>
        <MathBlock
          text={task.task_text}
          className="text-sm leading-6 text-slate-800"
        />
        {imageUrls.length > 0 && (
          <div className="mt-3 grid gap-2">
            {imageUrls.map((url, idx) => {
              // Round 7 (2026-05-21) — mirror StudentMockExam.tsx caption logic
              // для KIM 20 (выбор схем). Variant 1 KIM 20: 5 пронумерованных
              // electrical схем; caption «Схема 1..5» нужна чтобы tutor
              // понимал нумерацию. Variant 2 KIM 20 — табличная задача, без
              // картинок → этот код не сработает (imageUrls пуст).
              const caption =
                task.kim_number === 20 ? `Схема ${idx + 1}` : null;
              return (
                <figure key={`${task.id}-${idx}`} className="m-0">
                  <button
                    type="button"
                    onClick={() => conditionViewer.open(idx)}
                    style={{ touchAction: 'manipulation' }}
                    aria-label={`Открыть ${caption ?? `иллюстрацию к заданию ${task.kim_number}`} во весь экран`}
                    className="block w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <SafeImage
                      src={url}
                      alt={caption ?? `Иллюстрация к заданию ${task.kim_number}`}
                      className="max-h-72 w-full object-contain"
                      interactive={false}
                    />
                  </button>
                  {caption && (
                    <figcaption className="mt-1 text-center text-sm font-medium text-slate-700">
                      {caption}
                    </figcaption>
                  )}
                </figure>
              );
            })}
          </div>
        )}
        {/* Tutor-only collapsibles. */}
        {isPart1 && task.correct_answer ? (
          <Collapsible title="Правильный ответ">
            <span className="font-mono tabular-nums">{task.correct_answer}</span>
          </Collapsible>
        ) : null}
        {!isPart1 && (task.solution_text || solutionImageUrls.length > 0) ? (
          <Collapsible title="Эталонное решение (видно только тебе)" tone="amber">
            {task.solution_text ? (
              <MathBlock
                text={task.solution_text}
                className="text-sm leading-6"
              />
            ) : null}
            {solutionImageUrls.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {solutionImageUrls.map((url, idx) => (
                  <button
                    key={`${task.id}-sol-${idx}`}
                    type="button"
                    onClick={() => solutionViewer.open(idx)}
                    style={{ touchAction: 'manipulation' }}
                    aria-label={`Открыть фото эталона ${idx + 1} во весь экран`}
                    className="block w-full overflow-hidden rounded-md border border-amber-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <SafeImage
                      src={url}
                      alt={`Эталон решения №${task.kim_number} — фото ${idx + 1}`}
                      className="aspect-[3/4] w-full object-cover"
                      interactive={false}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </Collapsible>
        ) : null}

        <PhotoViewer
          items={conditionItems}
          openIndex={conditionViewer.openIndex}
          onClose={conditionViewer.close}
          onNavigate={conditionViewer.navigate}
          surface="mock_exam_variant"
          canRotate
          ariaTitle={`Иллюстрации задания №${task.kim_number}`}
          ariaDescription="Фото можно повернуть, увеличить и рассмотреть целиком"
        />
        <PhotoViewer
          items={solutionItems}
          openIndex={solutionViewer.openIndex}
          onClose={solutionViewer.close}
          onNavigate={solutionViewer.navigate}
          surface="mock_exam_variant"
          canRotate
          ariaTitle={`Эталон решения №${task.kim_number}`}
          ariaDescription="Фото можно повернуть, увеличить и рассмотреть целиком"
        />
      </CardContent>
    </Card>
  );
}

/** Шапка блока в превью (2026-08-02).
 *
 *  Зачем: репетитор проверяет вариант ПЕРЕД назначением, а этот экран
 *  показывал только задачи — прикреплённый трек и общий текст были не видны.
 *  Эмилия из-за этого решила, что аудио не загрузилось (оно было в базе).
 *
 *  Показываем ровно то, что увидит ученик: материал блока. Транскрипт сюда НЕ
 *  выводим — ученик до сдачи его не видит, а колонка вдобавок не гранится
 *  клиенту. Репетитор правит транскрипт в редакторе варианта. */
function PreviewBlockHeader({
  block,
  audioUrl,
  imageUrl,
}: {
  block: PreviewTaskBlock;
  audioUrl: string | null;
  imageUrl: string | null;
}) {
  const heading = block.title?.trim()
    || (block.audio_url ? 'Аудирование' : 'Материал к заданиям');
  return (
    <Card animate={false} className="border-sky-200 bg-sky-50/70 shadow-none">
      <CardContent className="space-y-2 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          {block.audio_url ? (
            <Headphones className="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
          ) : null}
          <h5 className="text-sm font-semibold text-slate-900">{heading}</h5>
          <span className="text-xs text-muted-foreground">— общий для задач ниже</span>
        </div>
        {block.instruction?.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {block.instruction}
          </p>
        ) : null}
        {block.image_url ? (
          imageUrl ? (
            <SafeImage
              src={imageUrl}
              alt="Материал к заданиям"
              className="max-h-72 w-full rounded-lg object-contain"
            />
          ) : (
            <p className="text-xs text-muted-foreground">Готовим документ…</p>
          )
        ) : null}
        {block.audio_url ? (
          audioUrl ? (
            <audio
              controls
              preload="metadata"
              src={audioUrl}
              className="min-h-11 w-full touch-manipulation"
            >
              Ваш браузер не поддерживает воспроизведение аудио.
            </audio>
          ) : (
            // Ref есть, подпись не сработала. Говорим прямо: именно здесь
            // репетитор решает, готов ли вариант к выдаче.
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Аудио прикреплено, но не проигрывается здесь. Откройте вариант на
              редактирование и проверьте запись перед выдачей ученикам.
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Группировка задач по СМЕЖНЫМ отрезкам одного блока — зеркало логики
 *  студенческого экрана (`StudentMockExam`), чтобы превью не расходилось с
 *  тем, что реально увидит ученик. */
function groupByBlock(
  tasks: VariantTaskRow[],
  blocksById: Map<string, PreviewTaskBlock>,
): Array<{ key: string; block: PreviewTaskBlock | null; tasks: VariantTaskRow[] }> {
  const groups: Array<{ key: string; block: PreviewTaskBlock | null; tasks: VariantTaskRow[] }> = [];
  for (const task of tasks) {
    const blockId = task.block_id ?? null;
    const last = groups[groups.length - 1];
    if (last && (last.block?.id ?? null) === blockId) {
      last.tasks.push(task);
      continue;
    }
    groups.push({
      key: `${blockId ?? 'none'}-${task.id}`,
      block: blockId ? blocksById.get(blockId) ?? null : null,
      tasks: [task],
    });
  }
  return groups;
}

interface PreviewBodyProps {
  variant: VariantSummaryRow | null;
  tasks: VariantTaskRow[];
  imagesByKim: Record<number, string[]>;
  solutionImagesByKim: Record<number, string[]>;
  /** Подписанные медиа блоков, keyed by blockId. */
  blockMedia: Record<string, { audio: string | null; image: string | null }>;
  loading: boolean;
  error: string | null;
}

function PreviewBody({
  variant,
  tasks,
  imagesByKim,
  solutionImagesByKim,
  blockMedia,
  loading,
  error,
}: PreviewBodyProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-md" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        Не удалось загрузить вариант: {error}
      </div>
    );
  }

  if (!variant) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Вариант не найден.
      </div>
    );
  }

  const part1Tasks = tasks.filter((t) => t.part === 1);
  const part2Tasks = tasks.filter((t) => t.part === 2);

  const blocks = variant.task_blocks_json ?? [];
  const blocksById = new Map(blocks.filter((b) => b?.id).map((b) => [b.id, b]));
  const part1Groups = groupByBlock(part1Tasks, blocksById);
  const part2Groups = groupByBlock(part2Tasks, blocksById);
  // Блок без привязанных задач = материал на всю работу (цельный трек секции).
  // Показываем его над Частью 1 — там же, где увидит ученик.
  const boundIds = new Set(tasks.map((t) => t.block_id).filter(Boolean) as string[]);
  const unboundBlocks = blocks.filter((b) => b?.id && !boundIds.has(b.id));

  const renderGroups = (
    groups: Array<{ key: string; block: PreviewTaskBlock | null; tasks: VariantTaskRow[] }>,
  ) =>
    groups.map((group) => (
      <div key={group.key} className="space-y-2">
        {group.block ? (
          <PreviewBlockHeader
            block={group.block}
            audioUrl={blockMedia[group.block.id]?.audio ?? null}
            imageUrl={blockMedia[group.block.id]?.image ?? null}
          />
        ) : null}
        {group.tasks.map((task) => (
          <PreviewTaskCard
            key={task.id}
            task={task}
            imageUrls={imagesByKim[task.kim_number] ?? []}
            solutionImageUrls={solutionImagesByKim[task.kim_number] ?? []}
          />
        ))}
      </div>
    ));

  return (
    <div className="space-y-4">
      {/* Summary block */}
      <Card animate={false} className="bg-accent/5 border-accent/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-accent text-white"
              aria-hidden="true"
            >
              <Library className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                {variant.title}
              </h3>
              {variant.source_attribution ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {variant.source_attribution}
                </p>
              ) : null}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {tasks.length} заданий · макс. {variant.total_max_score} баллов ·{' '}
                {Math.floor(variant.duration_minutes / 60)} ч{' '}
                {variant.duration_minutes % 60} мин · Часть 1: {part1Tasks.length}{' '}
                ({variant.part1_max} б.) · Часть 2: {part2Tasks.length} (
                {variant.part2_max} б.)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Часть 1 */}
      {part1Tasks.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-base font-semibold text-slate-900">Часть 1</h4>
            <span className="text-xs text-muted-foreground">
              Авто-проверка коротких ответов
            </span>
          </div>
          <div className="space-y-2">
            {unboundBlocks.map((block) => (
              <PreviewBlockHeader
                key={block.id}
                block={block}
                audioUrl={blockMedia[block.id]?.audio ?? null}
                imageUrl={blockMedia[block.id]?.image ?? null}
              />
            ))}
            {renderGroups(part1Groups)}
          </div>
        </section>
      )}

      {/* Часть 2 */}
      {part2Tasks.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-base font-semibold text-slate-900">Часть 2</h4>
            <span className="text-xs text-muted-foreground">
              Развёрнутые решения · AI-черновик + твоё подтверждение
            </span>
          </div>
          <div className="space-y-2">{renderGroups(part2Groups)}</div>
        </section>
      )}
    </div>
  );
}

export interface MockExamVariantPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variantId: string | null;
}

export function MockExamVariantPreviewSheet({
  open,
  onOpenChange,
  variantId,
}: MockExamVariantPreviewSheetProps) {
  const [variant, setVariant] = useState<VariantSummaryRow | null>(null);
  const [tasks, setTasks] = useState<VariantTaskRow[]>([]);
  const [imagesByKim, setImagesByKim] = useState<Record<number, string[]>>({});
  const [solutionImagesByKim, setSolutionImagesByKim] = useState<
    Record<number, string[]>
  >({});
  const [blockMedia, setBlockMedia] = useState<
    Record<string, { audio: string | null; image: string | null }>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load variant + tasks ровно один раз при первом открытии (или смене variantId).
  // Каталог вариантов меняется только через миграцию seed — нет смысла рефечить.
  useEffect(() => {
    if (!open || !variantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Сброс картинок при смене варианта — иначе старые эталоны/иллюстрации
    // мелькнут на новом варианте до завершения async-резолва.
    setImagesByKim({});
    setSolutionImagesByKim({});

    (async () => {
      try {
        const variantQ = await supabase
          .from('mock_exam_variants')
          .select(
            'id, title, exam_type, source, source_attribution, duration_minutes, total_max_score, part1_max, part2_max, task_blocks_json',
          )
          .eq('id', variantId)
          .maybeSingle();
        if (cancelled) return;
        if (variantQ.error) {
          setError(`${variantQ.error.code ?? 'error'}: ${variantQ.error.message}`);
          setLoading(false);
          return;
        }

        const tasksQ = await supabase
          .from('mock_exam_variant_tasks')
          .select(
            'id, kim_number, part, order_num, task_text, task_image_url, correct_answer, solution_text, solution_image_urls, check_mode, max_score, topic, block_id',
          )
          .eq('variant_id', variantId)
          .order('order_num', { ascending: true });
        if (cancelled) return;
        if (tasksQ.error) {
          setError(`${tasksQ.error.code ?? 'error'}: ${tasksQ.error.message}`);
          setLoading(false);
          return;
        }

        // `task_blocks_json` в generated-типах — широкий `Json`, поэтому каст
        // через unknown (конвенция escape-hatch этого файла для новых колонок,
        // пока Lovable не перегенерит types.ts).
        const variantRow = variantQ.data as unknown as VariantSummaryRow | null;
        const taskRows = (tasksQ.data ?? []) as unknown as VariantTaskRow[];

        setVariant(variantRow);
        setTasks(taskRows);
        setLoading(false);

        // Resolve images асинхронно — body уже отрисуется без них, картинки
        // подтянутся когда будут готовы. Не блокируем основной paint.
        const [taskImgs, solutionImgs, blockMediaResolved] = await Promise.all([
          resolveImagesByKim(taskRows, (t) => t.task_image_url),
          resolveImagesByKim(taskRows, (t) => t.solution_image_urls),
          resolveBlockMedia(variantRow?.task_blocks_json ?? null),
        ]);
        if (!cancelled) {
          setImagesByKim(taskImgs);
          setSolutionImagesByKim(solutionImgs);
          setBlockMedia(blockMediaResolved);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, variantId]);

  // Header — соответствует дизайну KBPickerSheet.
  const headerSubline = useMemo(() => {
    if (loading) return 'Загружаем задачи…';
    if (!variant) return null;
    return `${tasks.length} заданий · макс. ${variant.total_max_score} баллов`;
  }, [loading, variant, tasks.length]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[80vw] sm:!max-w-3xl"
      >
        <SheetHeader className="border-b px-4 pb-3 pt-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4.5 w-4.5 text-accent" />
            Предпросмотр варианта
          </SheetTitle>
          {headerSubline ? (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              {loading ? (
                <Loader2
                  className="h-3 w-3 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ImageIcon className="h-3 w-3" aria-hidden="true" />
              )}
              {headerSubline}
            </p>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <PreviewBody
            variant={variant}
            tasks={tasks}
            imagesByKim={imagesByKim}
            solutionImagesByKim={solutionImagesByKim}
            blockMedia={blockMedia}
            loading={loading}
            error={error}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
