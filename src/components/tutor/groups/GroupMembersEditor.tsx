// Редактор состава группы/метки «со стороны группы» (запрос Егора #39 — раньше
// состав менялся только по одному ученику из его карточки). Каждый переключатель
// сохраняется сразу (паттерн StudentTagsEditor: мгновенный фидбэк, нет большого
// save). Учебная группа: DB-триггер single_primary_guard сам переносит ученика
// из прежней основной группы. После добавления в учебную группу с будущими
// занятиями — существующий roster-prompt (AddToGroupLessonsPrompt).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { useTutorStudents, useTutorGroupMemberships } from '@/hooks/useTutor';
import { addStudentTag, removeStudentTag, setStudentPrimaryGroup } from '@/lib/tutors';
import {
  addStudentToGroupFutureLessons,
  countGroupFutureLessons,
} from '@/lib/tutorScheduleGroupCreate';
import { invalidateGroupRosterCaches } from '@/lib/tutorStudentCacheSync';
import { invalidateGroupEditorCaches } from '@/components/tutor/groups/groupCaches';
import { AddToGroupLessonsPrompt } from '@/components/tutor/AddToGroupLessonsPrompt';
import { cn } from '@/lib/utils';

interface GroupMembersEditorProps {
  group: { id: string; name: string; short_name?: string | null; is_primary: boolean };
  onClose: () => void;
}

export function GroupMembersEditor({ group, onClose }: GroupMembersEditorProps) {
  const queryClient = useQueryClient();
  const { students, loading: studentsLoading, error: studentsError } = useTutorStudents();
  const {
    memberships,
    loading: membershipsLoading,
    error: membershipsError,
    isRecovering: membershipsRecovering,
    refetch: refetchMemberships,
  } = useTutorGroupMemberships(true);

  const [search, setSearch] = useState('');
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  // Локальные override'ы поверх кэша memberships: чекбокс переключается сразу
  // после успешного сейва, не дожидаясь медленного под DPI рефетча.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const busyRef = useRef(false);
  // Инвалидация — ОДИН раз на закрытие, а не после каждого переключателя
  // (ревью 5.6 P2): состав из 25 человек давал 25 мутаций × 4 активных
  // рефетча. Пока редактор открыт, правду показывают overrides.
  const dirtyRef = useRef(false);

  // Ревью 5.6 P1 #6: сорванный под РФ-DPI запрос состава раньше выглядел как
  // «в группе никого» — репетитор видел ложный состав с рабочими чекбоксами.
  // Нет валидного снимка → редактор в режиме «данные не загрузились».
  const rosterUnavailable =
    (Boolean(membershipsError) && memberships.length === 0) ||
    (Boolean(studentsError) && students.length === 0);

  // Roster-prompt после добавления в учебную группу с будущими занятиями.
  const [futureCount, setFutureCount] = useState(0);
  const [lessonsPrompt, setLessonsPrompt] = useState<{
    tutorStudentId: string;
    studentName: string;
  } | null>(null);
  const [isAddingToLessons, setIsAddingToLessons] = useState(false);

  const flushGroupCaches = useCallback(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    void invalidateGroupEditorCaches(queryClient);
  }, [queryClient]);

  const handleClose = useCallback(() => {
    flushGroupCaches();
    onClose();
  }, [flushGroupCaches, onClose]);

  // Размонтирование мимо handleClose (родитель закрыл сам) — состав всё равно
  // обязан доехать до остальных поверхностей.
  useEffect(() => () => flushGroupCaches(), [flushGroupCaches]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleClose]);

  useEffect(() => {
    if (!group.is_primary) return;
    let cancelled = false;
    countGroupFutureLessons(group.id)
      .then((n) => {
        if (!cancelled) setFutureCount(n);
      })
      .catch((e) => console.error('countGroupFutureLessons failed:', e));
    return () => {
      cancelled = true;
    };
  }, [group.id, group.is_primary]);

  const memberIds = useMemo(
    () =>
      new Set(
        memberships
          .filter((m) => m.tutor_group_id === group.id && m.is_active)
          .map((m) => m.tutor_student_id),
      ),
    [memberships, group.id],
  );

  // Прежняя основная группа ученика (для подписи «переедет из …»).
  const otherPrimaryByStudent = useMemo(() => {
    if (!group.is_primary) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const m of memberships) {
      if (!m.is_active || m.tutor_group_id === group.id) continue;
      const g = m.tutor_group;
      if (g?.is_primary) {
        map.set(m.tutor_student_id, g.short_name?.trim() || g.name);
      }
    }
    return map;
  }, [memberships, group.id, group.is_primary]);

  const isChecked = (tutorStudentId: string) =>
    overrides[tutorStudentId] ?? memberIds.has(tutorStudentId);

  const studentLabel = (s: (typeof students)[number]) =>
    (s as { display_name?: string | null }).display_name ||
    s.profiles?.username ||
    'Ученик';

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...students].sort((a, b) =>
      studentLabel(a).localeCompare(studentLabel(b), 'ru'),
    );
    if (!q) return sorted;
    return sorted.filter((s) => studentLabel(s).toLowerCase().includes(q));
  }, [students, search]);

  const memberCount = useMemo(
    () => students.filter((s) => isChecked(s.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, memberIds, overrides],
  );

  const handleToggle = async (tutorStudentId: string, studentName: string) => {
    if (busyRef.current || rosterUnavailable) return;
    busyRef.current = true;
    setBusyStudentId(tutorStudentId);
    const next = !isChecked(tutorStudentId);
    try {
      let ok: boolean;
      if (group.is_primary) {
        ok = await setStudentPrimaryGroup(tutorStudentId, next ? group.id : null);
      } else {
        ok = next
          ? await addStudentTag(tutorStudentId, group.id)
          : await removeStudentTag(tutorStudentId, group.id);
      }
      if (!ok) {
        toast.error('Не удалось сохранить изменение состава');
        return;
      }
      setOverrides((prev) => ({ ...prev, [tutorStudentId]: next }));
      dirtyRef.current = true;
      if (next && group.is_primary && futureCount > 0) {
        setLessonsPrompt({ tutorStudentId, studentName });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось сохранить изменение состава',
      );
    } finally {
      busyRef.current = false;
      setBusyStudentId(null);
    }
  };

  const handleConfirmAddToLessons = async () => {
    if (!lessonsPrompt) return;
    setIsAddingToLessons(true);
    try {
      const res = await addStudentToGroupFutureLessons(group.id, lessonsPrompt.tutorStudentId);
      if (res.ok) {
        toast.success(`Добавлен в ${res.addedCount ?? 0} будущих занятий группы`);
        await invalidateGroupRosterCaches(queryClient);
      } else {
        toast.error(res.error || 'Не удалось добавить в занятия группы');
      }
    } catch (e) {
      console.error(e);
      toast.error('Не удалось добавить в занятия группы');
    } finally {
      setIsAddingToLessons(false);
      setLessonsPrompt(null);
    }
  };

  const loading = studentsLoading || membershipsLoading;
  const groupLabel = group.short_name?.trim() || group.name;

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={handleClose} />

      {/* max-h в vh, не dvh: Safari 15.0–15.3 не знает dvh (rule 80). */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-members-title"
        className="fixed left-1/2 top-1/2 z-[301] flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95"
      >
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <div className="min-w-0">
            <h3 id="group-members-title" className="truncate text-base font-semibold">
              Состав: {groupLabel}
            </h3>
            <p className="text-xs text-slate-500">
              {group.is_primary ? 'Учебная группа' : 'Метка'} ·{' '}
              {rosterUnavailable ? 'состав не загрузился' : `выбрано ${memberCount}`}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-50"
            style={{ touchAction: 'manipulation' }}
            aria-label="Закрыть"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {rosterUnavailable ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-[13px] text-amber-900">
            <p>
              Не удалось загрузить состав группы, поэтому отметки ниже могут не отражать
              реальность — менять состав сейчас нельзя.
            </p>
            <button
              type="button"
              onClick={() => void refetchMemberships()}
              disabled={membershipsRecovering}
              className="mt-2 inline-flex min-h-[36px] items-center rounded-lg border border-amber-300 bg-white px-3 text-[13px] font-semibold text-amber-900 disabled:opacity-60"
              style={{ touchAction: 'manipulation' }}
            >
              {membershipsRecovering ? 'Загружаем…' : 'Повторить'}
            </button>
          </div>
        ) : null}

        <div className="border-b border-socrat-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти ученика…"
              aria-label="Поиск ученика"
              className="w-full rounded-lg border border-socrat-border py-2 pl-9 pr-3 text-[16px] placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none"
              style={{ touchAction: 'manipulation' }}
            />
          </div>
          {group.is_primary && (
            <p className="mt-2 text-xs text-slate-500">
              У ученика одна учебная группа — при добавлении сюда он переедет из прежней.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredStudents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {students.length === 0 ? 'Учеников пока нет' : 'Никого не нашлось'}
            </p>
          ) : (
            <ul>
              {filteredStudents.map((s) => {
                const checked = isChecked(s.id);
                const busy = busyStudentId === s.id;
                const fromGroup = !checked ? otherPrimaryByStudent.get(s.id) : undefined;
                return (
                  <li key={s.id}>
                    {/* Кнопка-строка + Radix Checkbox: нативный input невидим под
                        глобальным CSS-reset (QA прода 2026-07-27 — «пустые» строки). */}
                    <button
                      type="button"
                      onClick={() => void handleToggle(s.id, studentLabel(s))}
                      disabled={busy || rosterUnavailable}
                      aria-pressed={checked}
                      aria-label={`${checked ? 'Убрать из состава' : 'Добавить в состав'}: ${studentLabel(s)}`}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50',
                        (busy || rosterUnavailable) && 'opacity-60',
                      )}
                      style={{ touchAction: 'manipulation' }}
                    >
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="pointer-events-none shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                        {studentLabel(s)}
                      </span>
                      {busy ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
                      ) : fromGroup ? (
                        <span className="shrink-0 text-xs text-slate-400">из «{fromGroup}»</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] rounded-lg bg-socrat-primary px-4 text-[13px] font-semibold text-white"
            style={{ touchAction: 'manipulation' }}
          >
            Готово
          </button>
        </div>
      </div>

      <AddToGroupLessonsPrompt
        open={Boolean(lessonsPrompt)}
        studentName={lessonsPrompt?.studentName ?? ''}
        groupName={groupLabel}
        futureCount={futureCount}
        isSubmitting={isAddingToLessons}
        onConfirm={() => void handleConfirmAddToLessons()}
        onCancel={() => setLessonsPrompt(null)}
      />
    </>
  );
}
