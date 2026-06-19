// Редактор меток ученика (доп. группы, is_primary=false) — чип-инпут «создать или
// выбрать» (type-ahead), запрос Елены 2026-06-18. Метки сохраняются СРАЗУ (не в общий
// save формы): мгновенный фидбэк + не усложняет большой handleSave профиля.
//
// Type-ahead показывает существующие метки → реюз, защита от дублей «как попало».
// rule 80: 16px input, touch-action:manipulation. rule 90: Lucide, без эмодзи.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { addStudentTag, createTutorGroup, removeStudentTag } from '@/lib/tutors';
import type { TutorGroup } from '@/types/tutor';

interface StudentTagsEditorProps {
  tutorStudentId: string;
  /** Текущие метки ученика. */
  tags: TutorGroup[];
  /** Все метки репетитора (is_primary=false) — для type-ahead. */
  allTags: TutorGroup[];
  /** Рефетч memberships (+ groups, если метка создана). */
  onChanged: () => void;
}

const tagLabel = (t: TutorGroup) => t.short_name?.trim() || t.name;

export function StudentTagsEditor({ tutorStudentId, tags, allTags, onChanged }: StudentTagsEditorProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Синхронный guard против гонки двойного Enter → дубль одноимённых меток (review P2).
  // `busy` (state) для дизейбла кнопок асинхронен; ref проверяется сразу.
  const busyRef = useRef(false);

  const currentIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  const q = input.trim().toLowerCase();

  const suggestions = useMemo(() => {
    if (!q) return [];
    return allTags
      .filter((t) => !currentIds.has(t.id) && tagLabel(t).toLowerCase().includes(q))
      .slice(0, 6);
  }, [allTags, currentIds, q]);

  const exactExisting = useMemo(
    () => allTags.find((t) => tagLabel(t).toLowerCase() === q),
    [allTags, q],
  );

  const handleAddExisting = useCallback(
    async (tagGroupId: string) => {
      if (busyRef.current) return;
      if (currentIds.has(tagGroupId)) {
        setInput('');
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const ok = await addStudentTag(tutorStudentId, tagGroupId);
        if (!ok) {
          toast.error('Не удалось добавить метку');
          return;
        }
        setInput('');
        onChanged();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [currentIds, tutorStudentId, onChanged],
  );

  const handleCreateAndAdd = useCallback(async () => {
    // Проверяем (но НЕ выставляем) guard до делегации в handleAddExisting —
    // иначе вложенный вызов забанит сам себя.
    if (busyRef.current) return;
    const name = input.trim();
    if (!name) return;
    // Реюз существующей метки (создать-или-выбрать) — защита от дублей.
    if (exactExisting) {
      await handleAddExisting(exactExisting.id);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const created = await createTutorGroup({ name, is_primary: false });
      if (!created) {
        toast.error('Не удалось создать метку');
        return;
      }
      const ok = await addStudentTag(tutorStudentId, created.id);
      if (!ok) {
        toast.error('Не удалось добавить метку');
        return;
      }
      setInput('');
      onChanged();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [input, exactExisting, handleAddExisting, tutorStudentId, onChanged]);

  const handleRemove = useCallback(
    async (tagGroupId: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const ok = await removeStudentTag(tutorStudentId, tagGroupId);
        if (!ok) {
          toast.error('Не удалось убрать метку');
          return;
        }
        onChanged();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [tutorStudentId, onChanged],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-sm text-muted-foreground">Меток пока нет</span>}
        {tags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
          >
            <Tag className="h-3 w-3 text-slate-400" aria-hidden="true" />
            {tagLabel(t)}
            <button
              type="button"
              onClick={() => void handleRemove(t.id)}
              disabled={busy}
              aria-label={`Убрать метку ${tagLabel(t)}`}
              className="ml-0.5 rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
              style={{ touchAction: 'manipulation' }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              void handleCreateAndAdd();
            }
          }}
          placeholder="Добавить метку (#интенсив, 11 класс…)"
          aria-label="Добавить метку"
          className="min-h-[44px] w-full rounded-md border border-socrat-border bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          style={{ touchAction: 'manipulation' }}
        />
        {q.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-socrat-border bg-white shadow-md">
            {suggestions.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void handleAddExisting(t.id)}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                style={{ touchAction: 'manipulation' }}
              >
                <Tag className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {tagLabel(t)}
              </button>
            ))}
            {!exactExisting && (
              <button
                type="button"
                onClick={() => void handleCreateAndAdd()}
                disabled={busy}
                className="flex w-full items-center gap-2 border-t border-socrat-border px-3 py-2 text-left text-sm font-medium text-accent hover:bg-slate-50 disabled:opacity-50"
                style={{ touchAction: 'manipulation' }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Создать «{input.trim()}»
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
