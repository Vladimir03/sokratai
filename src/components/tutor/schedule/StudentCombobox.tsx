// Пикер ученика в форме занятия (Волна 1 Расписания): поиск по имени (репорт
// репетитора: «При создании занятия нет поиска по имени учеников»), пункт
// «Без ученика» и быстрый плейсхолдер «+ Новый ученик» (имя → tutor-manual-add-student,
// ученики «не с платформы» из запроса групповика).
import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus, UserRound, UserX } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TutorStudentWithProfile } from '@/types/tutor';

/** Специальное значение «Без ученика» (занятие без участников — Волна 1). */
export const NO_STUDENT_VALUE = '__none__';

interface StudentComboboxProps {
  students: TutorStudentWithProfile[];
  /** profiles.id выбранного ученика; '' = не выбран; NO_STUDENT_VALUE = «Без ученика». */
  value: string;
  onChange: (studentProfileId: string) => void;
  disabled?: boolean;
  /** Показывать пункт «Без ученика». */
  allowNoStudent?: boolean;
  /** «+ Новый ученик»: создать плейсхолдера по имени прямо из формы (Волна 1). */
  onCreateStudent?: (name: string) => Promise<void> | void;
  creatingStudent?: boolean;
}

function studentLabel(s: TutorStudentWithProfile): string {
  return s.display_name?.trim() || s.profiles?.username || 'Без имени';
}

export function StudentCombobox({
  students,
  value,
  onChange,
  disabled,
  allowNoStudent,
  onCreateStudent,
  creatingStudent,
}: StudentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => students.find((s) => s.student_id === value) ?? null,
    [students, value],
  );

  const triggerLabel =
    value === NO_STUDENT_VALUE
      ? 'Без ученика'
      : selected
        ? studentLabel(selected)
        : 'Выберите ученика';

  const trimmedQuery = query.trim();

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !selected && value !== NO_STUDENT_VALUE && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          {/* text-base = 16px (rule 80: iOS Safari auto-zoom на <16px) */}
          <CommandInput
            placeholder="Поиск по имени..."
            value={query}
            onValueChange={setQuery}
            className="text-base"
          />
          <CommandList>
            <CommandEmpty>
              {onCreateStudent && trimmedQuery ? 'Не найдено — создайте нового ниже' : 'Ученик не найден'}
            </CommandEmpty>
            <CommandGroup>
              {allowNoStudent && (
                <CommandItem
                  value="— без ученика —"
                  onSelect={() => {
                    onChange(NO_STUDENT_VALUE);
                    setOpen(false);
                  }}
                >
                  <UserX className="mr-2 h-4 w-4 text-muted-foreground" />
                  Без ученика
                  {value === NO_STUDENT_VALUE && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              )}
              {students.map((s) => (
                <CommandItem
                  key={s.student_id}
                  // value участвует в поиске cmdk: ищем и по имени тутора, и по username.
                  value={`${studentLabel(s)} ${s.profiles?.username ?? ''} ${s.student_id}`}
                  onSelect={() => {
                    onChange(s.student_id);
                    setOpen(false);
                  }}
                >
                  <UserRound className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{studentLabel(s)}</span>
                  {value === s.student_id && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreateStudent && trimmedQuery.length > 0 && (
              <CommandGroup>
                <CommandItem
                  value={`__create__ ${trimmedQuery}`}
                  disabled={creatingStudent}
                  onSelect={() => {
                    void onCreateStudent(trimmedQuery);
                    setOpen(false);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4 text-accent" />
                  {creatingStudent ? 'Создаём...' : `Новый ученик «${trimmedQuery}»`}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
