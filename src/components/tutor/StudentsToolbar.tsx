import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, RotateCcw, Search, Tag } from 'lucide-react';
import type { TutorGroup } from '@/types/tutor';

export type SortField = 'activity' | 'name' | 'progress';
export type SortOrder = 'asc' | 'desc';
export type GroupFilterMode = 'all' | 'grouped' | 'individual';

export interface FilterValues {
  paymentStatus: 'paid' | 'unpaid' | null;
  examType: 'ege' | 'oge' | null;
  subject: string | null;
  groupMode: GroupFilterMode;
  groupId: string | null;
  /** Фильтр по метке (доп. группа, is_primary=false). Запрос Елены 2026-06-18. */
  tagId: string | null;
}

interface StudentsToolbarProps {
  sortBy: SortField;
  sortOrder: SortOrder;
  search: string;
  filters: FilterValues;
  subjects: string[];
  /** Только ОСНОВНЫЕ группы (is_primary) — для фильтра «Конкретная группа». */
  groups: TutorGroup[];
  /** Метки (is_primary=false) — для фильтра по метке. */
  tags: TutorGroup[];
  showGroupControls: boolean;
  totalCount: number;
  filteredCount: number;
  onSearchChange: (value: string) => void;
  onSortChange: (field: SortField) => void;
  onSortOrderToggle: () => void;
  onFilterChange: (filters: FilterValues) => void;
  onReset: () => void;
}

export function StudentsToolbar({
  sortBy,
  sortOrder,
  search,
  filters,
  subjects,
  groups,
  tags,
  showGroupControls,
  totalCount,
  filteredCount,
  onSearchChange,
  onSortChange,
  onSortOrderToggle,
  onFilterChange,
  onReset,
}: StudentsToolbarProps) {
  const hasActiveFilters = search.trim().length > 0 ||
                          filters.paymentStatus !== null ||
                          filters.examType !== null ||
                          filters.subject !== null ||
                          (showGroupControls && (filters.groupMode !== 'all' || filters.groupId !== null || filters.tagId !== null));

  const handlePaymentChange = (value: string) => {
    onFilterChange({
      ...filters,
      paymentStatus: value === 'all' ? null : value as 'paid' | 'unpaid',
    });
  };

  const handleExamChange = (value: string) => {
    onFilterChange({
      ...filters,
      examType: value === 'all' ? null : value as 'ege' | 'oge',
    });
  };

  const handleSubjectChange = (value: string) => {
    onFilterChange({
      ...filters,
      subject: value === 'all' ? null : value,
    });
  };

  const handleGroupModeChange = (value: string) => {
    const groupMode = value as GroupFilterMode;
    onFilterChange({
      ...filters,
      groupMode,
      groupId: groupMode === 'grouped' ? filters.groupId : null,
    });
  };

  const handleGroupChange = (value: string) => {
    onFilterChange({
      ...filters,
      groupId: value === 'all' ? null : value,
      groupMode: value === 'all' ? filters.groupMode : 'grouped',
    });
  };

  const handleTagChange = (value: string) => {
    onFilterChange({
      ...filters,
      tagId: value === 'all' ? null : value,
    });
  };

  return (
    <div className="space-y-3">
      {/* Поиск по имени (маркировка репетитора, а не данные ученика) */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по имени или Telegram"
          aria-label="Поиск учеников"
          className="min-h-[44px] w-full rounded-md border border-socrat-border bg-white py-2 pl-9 pr-3 text-base text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          style={{ touchAction: 'manipulation' }}
        />
      </div>

      {/* Sort and filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Sort by */}
        <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortField)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activity">По активности</SelectItem>
            <SelectItem value="name">По имени</SelectItem>
            <SelectItem value="progress">По прогрессу</SelectItem>
          </SelectContent>
        </Select>

        <Button 
          variant="outline" 
          size="icon"
          onClick={onSortOrderToggle}
          title={sortOrder === 'asc' ? 'По возрастанию' : 'По убыванию'}
        >
          <ArrowUpDown className={`h-4 w-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
        </Button>

        {/* Payment filter */}
        <Select 
          value={filters.paymentStatus ?? 'all'} 
          onValueChange={handlePaymentChange}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Оплата" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="paid">Оплачено</SelectItem>
            <SelectItem value="unpaid">Не оплачено</SelectItem>
          </SelectContent>
        </Select>

        {/* Exam type filter */}
        <Select 
          value={filters.examType ?? 'all'} 
          onValueChange={handleExamChange}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Экзамен" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="ege">ЕГЭ</SelectItem>
            <SelectItem value="oge">ОГЭ</SelectItem>
          </SelectContent>
        </Select>

        {/* Subject filter */}
        {subjects.length > 0 && (
          <Select 
            value={filters.subject ?? 'all'} 
            onValueChange={handleSubjectChange}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Предмет" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все предметы</SelectItem>
              {subjects.map(subject => (
                <SelectItem key={subject} value={subject}>{subject}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showGroupControls && (
          <Select value={filters.groupMode} onValueChange={handleGroupModeChange}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Формат занятий" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все форматы</SelectItem>
              <SelectItem value="grouped">В мини-группе</SelectItem>
              <SelectItem value="individual">Индивидуально</SelectItem>
            </SelectContent>
          </Select>
        )}

        {showGroupControls && groups.length > 0 && (
          <Select value={filters.groupId ?? 'all'} onValueChange={handleGroupChange}>
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Конкретная группа" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все мини-группы</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.short_name || group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Фильтр по метке (#интенсив и т.п.) */}
        {showGroupControls && tags.length > 0 && (
          <Select value={filters.tagId ?? 'all'} onValueChange={handleTagChange}>
            <SelectTrigger className="w-[170px]">
              <Tag className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <SelectValue placeholder="Метка" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все метки</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.short_name || tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Reset button */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Сбросить
          </Button>
        )}
      </div>

      {/* Counter */}
      <p className="text-sm text-muted-foreground">
        {filteredCount === totalCount ? (
          `${totalCount} ${getStudentWord(totalCount)}`
        ) : (
          `Найдено ${filteredCount} из ${totalCount} ${getStudentWord(totalCount)}`
        )}
      </p>
    </div>
  );
}

function getStudentWord(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'учеников';
  const lastOne = count % 10;
  if (lastOne === 1) return 'ученик';
  if (lastOne >= 2 && lastOne <= 4) return 'ученика';
  return 'учеников';
}
