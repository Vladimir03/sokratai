import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useKbSources } from '@/hooks/useKnowledgeBase';
import {
  useCreateSource,
  useDeleteSource,
  useUpdateSource,
} from '@/hooks/useModeratorCatalog';
import type { KBSource } from '@/types/kb';

interface SourcesManagerProps {
  onClose: () => void;
}

/**
 * Модераторская модалка управления справочником источников (kb_sources):
 * add / rename / delete. Список используется в форме задачи (выпадающий
 * выбор источника). Зеркало SubtopicManager.
 */
export function SourcesManager({ onClose }: SourcesManagerProps) {
  const { sources, loading } = useKbSources();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleAdd = () => {
    const name = newName.trim();
    if (!name || createSource.isPending) return;
    createSource.mutate(
      { name, sortOrder: sources.length * 10 },
      {
        onSuccess: () => { setNewName(''); },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось создать источник'),
      },
    );
  };

  const handleRename = (id: string) => {
    const name = draft.trim();
    if (!name) { setEditingId(null); return; }
    updateSource.mutate(
      { id, name },
      {
        onSuccess: () => { setEditingId(null); },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось сохранить источник'),
      },
    );
  };

  const handleDelete = (s: KBSource) => {
    if (!window.confirm(`Удалить источник «${s.name}»?`)) return;
    deleteSource.mutate(s.id, {
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось удалить источник'),
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 className="text-base font-semibold">Источники задач</h3>
          <button type="button" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-3 text-xs text-slate-500">
            Список источников, из которого репетиторы выбирают при добавлении задачи.
          </p>

          <div className="flex flex-col gap-2">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : (
              sources.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  {editingId === s.id ? (
                    <>
                      <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(s.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg border border-socrat-border px-3 py-2 text-[16px] focus:border-socrat-primary/50 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRename(s.id)}
                        className="rounded-lg p-2 text-socrat-primary hover:bg-socrat-primary/10 [touch-action:manipulation]"
                        aria-label="Сохранить"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 [touch-action:manipulation]"
                        aria-label="Отмена"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{s.name}</span>
                      <button
                        type="button"
                        onClick={() => { setEditingId(s.id); setDraft(s.name); }}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-socrat-primary [touch-action:manipulation]"
                        aria-label="Переименовать источник"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(s)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 [touch-action:manipulation]"
                        aria-label="Удалить источник"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}

            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                placeholder="Новый источник…"
                className="min-w-0 flex-1 rounded-lg border border-socrat-border px-3 py-2 text-[16px] placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newName.trim() || createSource.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-socrat-primary px-3 py-2 text-[13px] font-semibold text-white disabled:cursor-default disabled:bg-socrat-border [touch-action:manipulation]"
              >
                <Plus className="h-3.5 w-3.5" />
                Добавить
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
