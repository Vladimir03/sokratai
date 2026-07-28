import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BoardCanvas, type BoardTool } from '@/components/whiteboard/BoardCanvas';
import { BoardToolbar } from '@/components/whiteboard/BoardToolbar';
import { PagesPanel } from '@/components/whiteboard/PagesPanel';
import {
  type Board,
  type BoardPageRow,
  WhiteboardApiError,
  createBoardPage,
  deleteBoardPage,
  getBoard,
  getOrCreateLessonBoard,
  saveBoardPage,
  updateBoard,
} from '@/lib/whiteboardApi';
import {
  type BoardBackground,
  type BoardElement,
  type BoardGridMm,
  BOARD_COLORS,
  DEFAULT_PEN_SIZE_MM,
  DEFAULT_TEXT_SIZE_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  createText,
  normalizeBackground,
  normalizeGridMm,
  parseElements,
  primeSeqCounter,
  translateElement,
} from '@/lib/whiteboard/model';
import { boardPdfFileName, exportBoardToPdf } from '@/lib/whiteboard/exportPdf';
import { deleteMaterial, uploadLessonPdf } from '@/lib/lessonMaterialsApi';

// Страница доски (Фаза 1). Доска ОДНОПОЛЬЗОВАТЕЛЬСКАЯ: передача мела — Фаза 2.
//
// ⚠️ Данные загружаются вручную (useEffect + useState), а НЕ через useQuery.
// Это осознанно: на доске лежит несохранённый рукописный ввод, и фоновый
// refetch по возврату фокуса затёр бы его — тот самый класс потери формы при
// смене вкладки, из-за которого в конструкторе ДЗ появился гард smoke-check §8.

const AUTOSAVE_DELAY_MS = 900;
const HISTORY_LIMIT = 60;

interface PageState {
  id: string;
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
}

interface HistoryEntry {
  past: BoardElement[][];
  future: BoardElement[][];
}

function rowToPageState(row: BoardPageRow): PageState {
  const elements = parseElements(row.elements);
  primeSeqCounter(elements);
  return {
    id: row.id,
    elements,
    background: normalizeBackground(row.background),
    gridMm: normalizeGridMm(row.grid_mm),
  };
}

export default function Whiteboard() {
  const params = useParams<{ boardId?: string; lessonId?: string }>();
  const navigate = useNavigate();

  const [board, setBoard] = useState<Board | null>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tool, setTool] = useState<BoardTool>('pen');
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [size, setSize] = useState<number>(DEFAULT_PEN_SIZE_MM);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);

  const historyRef = useRef<Map<string, HistoryEntry>>(new Map());
  const [historyTick, setHistoryTick] = useState(0);
  const dirtyRef = useRef<Set<string>>(new Set());
  const pagesRef = useRef<PageState[]>([]);
  /** Снимок, отправленный в последний экспорт, — чтобы не плодить одинаковые PDF. */
  const exportedSignatureRef = useRef<string | null>(null);

  pagesRef.current = pages;

  const activePage = pages[activeIndex] ?? null;

  // ─── Загрузка ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const load = params.lessonId
      ? getOrCreateLessonBoard(params.lessonId)
      : params.boardId
        ? getBoard(params.boardId)
        : Promise.reject(new WhiteboardApiError('Доска не указана', 'NO_BOARD'));

    load
      .then((data) => {
        if (cancelled) return;
        setBoard(data.board);
        const next = data.pages.map(rowToPageState);
        setPages(next.length > 0 ? next : []);
        setActiveIndex(0);
        // Адрес приводим к каноническому: перезагрузка по /lesson/:id иначе
        // каждый раз заново резолвила бы доску.
        if (params.lessonId) {
          navigate(`/tutor/board/${data.board.id}`, { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Не удалось открыть доску');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.boardId, params.lessonId, navigate]);

  // ─── Автосохранение ─────────────────────────────────────────────────────────

  const flushDirty = useCallback(async () => {
    const ids = Array.from(dirtyRef.current);
    if (ids.length === 0) return;
    dirtyRef.current = new Set();
    setSaving(true);
    try {
      for (let i = 0; i < ids.length; i++) {
        const page = pagesRef.current.find((p) => p.id === ids[i]);
        if (!page) continue;
        // Последовательно: страниц единицы, а параллельный залп на плохой сети
        // (RU DPI, rule 95) увеличил бы шанс, что часть записей потеряется.
        await saveBoardPage(page.id, {
          elements: page.elements,
          background: page.background,
          grid_mm: page.gridMm,
        });
      }
    } catch (err) {
      // Возвращаем страницы в очередь: несохранённый конспект молча терять нельзя.
      for (let i = 0; i < ids.length; i++) dirtyRef.current.add(ids[i]);
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить доску');
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (dirtyRef.current.size === 0) return;
    const timer = setTimeout(() => {
      void flushDirty();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pages, flushDirty]);

  // Уход со страницы — досохраняем то, что не успел дебаунс.
  useEffect(
    () => () => {
      void flushDirty();
    },
    [flushDirty],
  );

  // ─── Правки сцены ───────────────────────────────────────────────────────────

  const markDirty = useCallback((pageId: string) => {
    dirtyRef.current.add(pageId);
  }, []);

  const pushHistory = useCallback((pageId: string, snapshot: BoardElement[]) => {
    const entry = historyRef.current.get(pageId) ?? { past: [], future: [] };
    entry.past.push(snapshot);
    if (entry.past.length > HISTORY_LIMIT) entry.past.shift();
    entry.future = [];
    historyRef.current.set(pageId, entry);
    setHistoryTick((t) => t + 1);
  }, []);

  const updateActiveElements = useCallback(
    (updater: (elements: BoardElement[]) => BoardElement[], recordHistory = true) => {
      setPages((prev) => {
        const page = prev[activeIndex];
        if (!page) return prev;
        const nextElements = updater(page.elements);
        if (nextElements === page.elements) return prev;
        if (recordHistory) pushHistory(page.id, page.elements);
        markDirty(page.id);
        const copy = prev.slice();
        copy[activeIndex] = { ...page, elements: nextElements };
        return copy;
      });
    },
    [activeIndex, markDirty, pushHistory],
  );

  const handleCommitElement = useCallback(
    (element: BoardElement) => {
      updateActiveElements((elements) => [...elements, element]);
    },
    [updateActiveElements],
  );

  const handleEraseElements = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const removal = new Set(ids);
      updateActiveElements((elements) => elements.filter((el) => !removal.has(el.id)));
    },
    [updateActiveElements],
  );

  const handleMoveSelection = useCallback(
    (dx: number, dy: number) => {
      if ((dx === 0 && dy === 0) || selectedIds.length === 0) return;
      const moving = new Set(selectedIds);
      // recordHistory=false: перетаскивание идёт десятками событий, и каждое
      // в истории превратило бы Ctrl+Z в покадровую перемотку.
      updateActiveElements(
        (elements) => elements.map((el) => (moving.has(el.id) ? translateElement(el, dx, dy) : el)),
        false,
      );
    },
    [selectedIds, updateActiveElements],
  );

  const handleUndo = useCallback(() => {
    if (!activePage) return;
    const entry = historyRef.current.get(activePage.id);
    if (!entry || entry.past.length === 0) return;
    const previous = entry.past.pop() as BoardElement[];
    entry.future.push(activePage.elements);
    historyRef.current.set(activePage.id, entry);
    setHistoryTick((t) => t + 1);
    updateActiveElements(() => previous, false);
  }, [activePage, updateActiveElements]);

  const handleRedo = useCallback(() => {
    if (!activePage) return;
    const entry = historyRef.current.get(activePage.id);
    if (!entry || entry.future.length === 0) return;
    const next = entry.future.pop() as BoardElement[];
    entry.past.push(activePage.elements);
    historyRef.current.set(activePage.id, entry);
    setHistoryTick((t) => t + 1);
    updateActiveElements(() => next, false);
  }, [activePage, updateActiveElements]);

  const historyState = useMemo(() => {
    void historyTick;
    const entry = activePage ? historyRef.current.get(activePage.id) : undefined;
    return { canUndo: (entry?.past.length ?? 0) > 0, canRedo: (entry?.future.length ?? 0) > 0 };
  }, [activePage, historyTick]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // ─── Разлиновка ─────────────────────────────────────────────────────────────

  const patchActivePage = useCallback(
    (patch: Partial<Pick<PageState, 'background' | 'gridMm'>>) => {
      setPages((prev) => {
        const page = prev[activeIndex];
        if (!page) return prev;
        markDirty(page.id);
        const copy = prev.slice();
        copy[activeIndex] = { ...page, ...patch };
        return copy;
      });
    },
    [activeIndex, markDirty],
  );

  // ─── Страницы ───────────────────────────────────────────────────────────────

  const handleAddPage = useCallback(async () => {
    if (!board || busy) return;
    setBusy(true);
    try {
      await flushDirty();
      const created = await createBoardPage(board.id, {
        background: activePage?.background ?? 'grid',
        grid_mm: activePage?.gridMm ?? 5,
      });
      setPages((prev) => [...prev, rowToPageState(created)]);
      setActiveIndex(pagesRef.current.length);
      setSelectedIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось добавить страницу');
    } finally {
      setBusy(false);
    }
  }, [board, busy, flushDirty, activePage]);

  const handleDeletePage = useCallback(
    async (index: number) => {
      const page = pagesRef.current[index];
      if (!page || busy) return;
      setBusy(true);
      try {
        await deleteBoardPage(page.id);
        historyRef.current.delete(page.id);
        dirtyRef.current.delete(page.id);
        setPages((prev) => prev.filter((_, i) => i !== index));
        setActiveIndex((prev) => Math.max(0, Math.min(prev, pagesRef.current.length - 2)));
        setSelectedIds([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить страницу');
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const handleSelectPage = useCallback((index: number) => {
    setActiveIndex(index);
    setSelectedIds([]);
  }, []);

  // ─── Текст ──────────────────────────────────────────────────────────────────

  const commitTextDraft = useCallback(() => {
    setTextDraft((draft) => {
      if (draft && draft.value.trim()) {
        handleCommitElement(createText(draft.x, draft.y, draft.value.trim(), color, DEFAULT_TEXT_SIZE_MM));
      }
      return null;
    });
  }, [color, handleCommitElement]);

  // ─── Экспорт ────────────────────────────────────────────────────────────────

  const buildPdfBlob = useCallback(async () => {
    const source = pagesRef.current;
    if (source.length === 0) throw new Error('В доске нет страниц');
    return exportBoardToPdf(
      source.map((p) => ({ elements: p.elements, background: p.background, gridMm: p.gridMm })),
    );
  }, []);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await flushDirty();
      const blob = await buildPdfBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = boardPdfFileName(board?.title ?? null, new Date());
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось собрать PDF');
    } finally {
      setBusy(false);
    }
  }, [busy, flushDirty, buildPdfBlob, board]);

  /**
   * Главное действие Фазы 1 (W1.10): конспект оказывается в материалах занятия
   * БЕЗ ручного скачивания и прикрепления.
   *
   * ⚠️ Прикрепление идёт СУЩЕСТВУЮЩИМ путём `uploadLessonPdf` → tutor_lesson_materials
   * (kind:'pdf') — тем же, которым репетитор грузит конспекты руками. Новой сущности
   * здесь быть не должно: ученик видит материал без единой правки на своей стороне.
   */
  const handleAttachToLesson = useCallback(async () => {
    if (!board?.lesson_id || busy) return;
    setBusy(true);
    try {
      await flushDirty();
      const signature = JSON.stringify(
        pagesRef.current.map((p) => p.elements.map((el) => `${el.id}:${el.version}`)),
      );
      if (signature === exportedSignatureRef.current && board.export_material_id) {
        toast.success('Конспект уже прикреплён к занятию');
        return;
      }

      const blob = await buildPdfBlob();
      const fileName = boardPdfFileName(board.title, new Date());
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const material = await uploadLessonPdf(file, board.lesson_id, fileName);

      // Прошлый автоэкспорт убираем: иначе каждое «прикрепить» съедало бы слот
      // из пяти, и ученик видел бы пять версий одного конспекта.
      const previousId = board.export_material_id;
      const updated = await updateBoard(board.id, { export_material_id: material.id });
      setBoard(updated);
      exportedSignatureRef.current = signature;
      if (previousId) {
        await deleteMaterial(previousId).catch(() => undefined);
      }
      toast.success('Конспект прикреплён к занятию');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось прикрепить конспект');
    } finally {
      setBusy(false);
    }
  }, [board, busy, flushDirty, buildPdfBlob]);

  // ─── Рендер ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError || !board) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-slate-700">{loadError ?? 'Доска не найдена'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/tutor/board')}>
          К списку досок
        </Button>
      </div>
    );
  }

  const pageSummaries = pages.map((p) => ({
    id: p.id,
    elements: p.elements,
    background: p.background,
    gridMm: p.gridMm,
  }));

  return (
    // Динамическая единица высоты (dvh): на iOS адресная строка съедает часть
    // статической вьюпорт-высоты, и низ панели страниц уходил бы за экран (rule 80).
    <div className="flex h-[100dvh] flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/tutor/board')}
          style={{ touchAction: 'manipulation' }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Доски
        </Button>

        <input
          value={board.title ?? ''}
          placeholder="Без названия"
          onChange={(e) => setBoard({ ...board, title: e.target.value })}
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title !== (board.title ?? '')) {
              void updateBoard(board.id, { title: title || null }).catch(() => undefined);
            }
          }}
          // 16px (text-base) обязателен на инпутах — иначе Safari iOS зумит (rule 80).
          className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-base font-medium text-slate-900 hover:border-slate-200 focus:border-accent focus:outline-none"
        />

        <span className="hidden shrink-0 items-center gap-1.5 text-sm text-slate-500 sm:flex">
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Сохраняем
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-accent" />
              Сохранено
            </>
          )}
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={busy}
          style={{ touchAction: 'manipulation' }}
        >
          <Download className="mr-1.5 h-4 w-4" />
          PDF
        </Button>

        {board.lesson_id && (
          <Button
            size="sm"
            onClick={handleAttachToLesson}
            disabled={busy}
            style={{ touchAction: 'manipulation' }}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="mr-1.5 h-4 w-4" />
            )}
            Прикрепить к занятию
          </Button>
        )}
      </header>

      <BoardToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        size={size}
        onSizeChange={setSize}
        background={activePage?.background ?? 'grid'}
        onBackgroundChange={(background) => patchActivePage({ background })}
        gridMm={activePage?.gridMm ?? 5}
        onGridMmChange={(gridMm: BoardGridMm) => patchActivePage({ gridMm })}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        disabled={busy}
      />

      <div className="relative min-h-0 flex-1 overflow-auto p-3">
        <div
          className="relative mx-auto h-full max-h-full bg-white shadow-sm ring-1 ring-slate-200"
          style={{ aspectRatio: `${PAGE_WIDTH_MM} / ${PAGE_HEIGHT_MM}` }}
        >
          {activePage && (
            <BoardCanvas
              elements={activePage.elements}
              background={activePage.background}
              gridMm={activePage.gridMm}
              tool={tool}
              color={color}
              size={size}
              selectedIds={selectedIds}
              readOnly={busy}
              onCommitElement={handleCommitElement}
              onEraseElements={handleEraseElements}
              onSelectionChange={setSelectedIds}
              onMoveSelection={handleMoveSelection}
              onRequestText={(x, y) => setTextDraft({ x, y, value: '' })}
            />
          )}

          {textDraft && (
            <textarea
              autoFocus
              value={textDraft.value}
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onBlur={commitTextDraft}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTextDraft(null);
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitTextDraft();
              }}
              placeholder="Текст, Esc — отмена"
              style={{
                left: `${(textDraft.x / PAGE_WIDTH_MM) * 100}%`,
                top: `${(textDraft.y / PAGE_HEIGHT_MM) * 100}%`,
              }}
              className="absolute z-10 min-h-[44px] w-48 resize-none rounded-md border border-accent bg-white p-2 text-base shadow-sm focus:outline-none"
            />
          )}
        </div>
      </div>

      <PagesPanel
        pages={pageSummaries}
        activeIndex={activeIndex}
        disabled={busy}
        onSelect={handleSelectPage}
        onAdd={handleAddPage}
        onDelete={handleDeletePage}
      />
    </div>
  );
}
