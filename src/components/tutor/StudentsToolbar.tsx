import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, RotateCcw } from 'lucide-react';

export type SortField = 'activity' | 'name' | 'progress';
export type SortOrder = 'asc' | 'desc';

export interface FilterValues {
  paymentStatus: 'paid' | 'unpaid' | null;
  examType: 'ege' | 'oge' | null;
  subject: string | null;
}

interface StudentsToolbarProps {
  sortBy: SortField;
  sortOrder: SortOrder;
  filters: FilterValues;
  subjects: string[];
  totalCount: number;
  filteredCount: number;
  onSortChange: (field: SortField) => void;
  onSortOrderToggle: () => void;
  onFilterChange: (filters: FilterValues) => void;
  onReset: () => void;
}

export function StudentsToolbar({
  sortBy,
  sortOrder,
  filters,
  subjects,
  totalCount,
  filteredCount,
  onSortChange,
  onSortOrderToggle,
  onFilterChange,
  onReset,
}: StudentsToolbarProps) {
  const hasActiveFilters = filters.paymentStatus !== null || 
                          filters.examType !== null || 
                          filters.subject !== null;

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

  return (
    <div className="space-y-3">
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
