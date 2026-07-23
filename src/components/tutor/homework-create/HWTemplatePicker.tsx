import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Library } from 'lucide-react';
import { useTutorHomeworkTemplates } from '@/hooks/useTutorHomework';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import type { HomeworkSubject, HomeworkTemplateListItem } from '@/lib/tutorHomeworkApi';
import { getSubjectLabel } from '@/types/homework';
import { normalizeContentSubjects } from '@/lib/tutorSubjects';
import { SUBJECTS } from './types';

export interface HWTemplatePickerProps {
  onSelect: (template: HomeworkTemplateListItem) => void;
}

// unified-task-model F3 (2026-07-05): вкладка «Банк Сократа» — общие шаблоны,
// опубликованные модераторами (mirror KBPickerSheet Каталог/Моя база). Выбор
// шаблона Банка = prefill конструктора (снимок при выдаче) — форк НЕ нужен.
type PickerTab = 'mine' | 'shared';

export function HWTemplatePicker({ onSelect }: HWTemplatePickerProps) {
  const [tab, setTab] = useState<PickerTab>('mine');
  // Ф2: дефолт фильтра — единственный контент-предмет профиля (иначе 'all');
  // чипы предметов профиля — первыми. Тот же app-wide profile-ключ, что держит
  // SideNav (НЕ новая query-подписка в смысле rule 40 — данные влияют только
  // на дефолт/порядок чипов фильтра, не на state конструктора).
  const { data: tutorProfile } = useTutorProfile();
  const profileSubjects = normalizeContentSubjects(tutorProfile?.subjects);
  const [filterSubject, setFilterSubject] = useState<string>(() =>
    profileSubjects.length === 1 ? profileSubjects[0] : 'all',
  );
  const { templates, loading } = useTutorHomeworkTemplates(
    filterSubject !== 'all' ? (filterSubject as HomeworkSubject) : undefined,
    tab,
  );
  const [open, setOpen] = useState(false);

  const handlePick = useCallback(
    (tpl: HomeworkTemplateListItem) => {
      onSelect(tpl);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Library className="h-4 w-4" />
          Из шаблона
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Шаблоны домашних заданий</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {/* Вкладки Мои / Банк (mirror KBPickerSheet) */}
          <div role="group" aria-label="Источник шаблонов" className="flex gap-1">
            {([
              { value: 'mine', label: 'Мои шаблоны' },
              { value: 'shared', label: 'Банк Сократа' },
            ] as const).map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                aria-pressed={tab === t.value}
                style={{ touchAction: 'manipulation' }}
                className={`flex-1 min-h-[44px] px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                  tab === t.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {[
              'all',
              ...profileSubjects,
              ...SUBJECTS.map((s) => s.value).filter((v) => !profileSubjects.includes(v)),
            ].map((s) => (
              <button
                key={s}
                onClick={() => setFilterSubject(s)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  filterSubject === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50'
                }`}
              >
                {s === 'all' ? 'Все' : getSubjectLabel(s)}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {tab === 'shared'
                ? 'В Банке пока нет шаблонов по этому предмету.'
                : 'Нет шаблонов. Создайте ДЗ и сохраните как шаблон.'}
            </p>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handlePick(tpl)}
                  className="w-full text-left p-3 rounded-md border hover:bg-muted/50 transition-colors space-y-1"
                >
                  <p className="text-sm font-medium">{tpl.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{getSubjectLabel(tpl.subject)}</span>
                    {tpl.topic && <span>· {tpl.topic}</span>}
                    {tpl.task_count != null && <span>· {tpl.task_count} задач</span>}
                    {tab === 'shared' && (tpl.usage_count ?? 0) > 0 && (
                      <span>· использовано {tpl.usage_count} раз</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
