import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useCreateSubtopic,
  useDeleteSubtopic,
  useUpdateSubtopic,
} from '@/hooks/useModeratorCatalog';
import type { KBSubtopic } from '@/types/kb';

interface SubtopicManagerProps {
  topicId: string;
  subtopics: KBSubtopic[];
}

/** Модераторская панель управления подтемами темы (add / rename / delete). */
export function SubtopicManager({ topicId, subtopics }: SubtopicManagerProps) {
  const createSubtopic = useCreateSubtopic();
  const updateSubtopic = useUpdateSubtopic();
  const deleteSubtopic = useDeleteSubtopic();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const handleAdd = () => {
    const name = newName.trim();
    if (!name || createSubtopic.isPending) return;
    createSubtopic.mutate(
      { topicId, name, sortOrder: subtopics.length },
      {
        onSuccess: () => { setNewName(''); },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось создать подтему'),
      },
    );
  };

  const handleRename = (id: string) => {
    const name = draft.trim();
    if (!name) { setEditingId(null); return; }
    updateSubtopic.mutate(
      { id, name },
      {
        onSuccess: () => { setEditingId(null); },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось сохранить подтему'),
      },
    );
  };

  const handleDelete = (s: KBSubtopic) => {
    if (!window.confirm(`Удалить подтему «${s.name}»?`)) return;
    deleteSubtopic.mutate(s.id, {
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Не удалось удалить подтему'),
    });
  };

  return (
    <div className="rounded-2xl border border-socrat-border bg-white px-4 py-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        Подтемы · модератор
      </div>

      <div className="flex flex-col gap-2">
        {subtopics.map((s) => (
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
                  aria-label="Переименовать подтему"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 [touch-action:manipulation]"
                  aria-label="Удалить подтему"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}

        <div className="mt-1 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Новая подтема…"
            className="min-w-0 flex-1 rounded-lg border border-socrat-border px-3 py-2 text-[16px] placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim() || createSubtopic.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-socrat-primary px-3 py-2 text-[13px] font-semibold text-white disabled:cursor-default disabled:bg-socrat-border [touch-action:manipulation]"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}
