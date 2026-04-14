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
import type { HomeworkSubject, HomeworkTemplateListItem } from '@/lib/tutorHomeworkApi';
import { getSubjectLabel } from '@/types/homework';
import { SUBJECTS } from './types';

export interface HWTemplatePickerProps {
  onSelect: (template: HomeworkTemplateListItem) => void;
}

export function HWTemplatePicker({ onSelect }: HWTemplatePickerProps) {
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const { templates, loading } = useTutorHomeworkTemplates(
    filterSubject !== 'all' ? (filterSubject as HomeworkSubject) : undefined,
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
          <div className="flex flex-wrap gap-1">
            {['all', ...SUBJECTS.map(s => s.value)].map((s) => (
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
              Нет шаблонов. Создайте ДЗ и сохраните как шаблон.
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
