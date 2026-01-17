import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, SearchX, AlertCircle, RotateCcw, UserPlus } from 'lucide-react';

interface StudentsSkeletonProps {
  count?: number;
}

export function StudentsSkeleton({ count = 3 }: StudentsSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-4">
            <Skeleton className="h-12 w-12 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-2 w-full" />
              <div className="flex gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

interface StudentsEmptyProps {
  onAddStudent?: () => void;
}

export function StudentsEmpty({ onAddStudent }: StudentsEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Users className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-lg mb-2">У вас пока нет учеников</h3>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Добавьте первого ученика, чтобы начать отслеживать его прогресс
      </p>
      {onAddStudent && (
        <Button onClick={onAddStudent}>
          <UserPlus className="h-4 w-4 mr-2" />
          Добавить ученика
        </Button>
      )}
    </div>
  );
}

interface StudentsEmptyFiltersProps {
  onReset: () => void;
}

export function StudentsEmptyFilters({ onReset }: StudentsEmptyFiltersProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <SearchX className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-lg mb-2">Ничего не найдено</h3>
      <p className="text-muted-foreground mb-6">
        Попробуйте изменить параметры фильтрации
      </p>
      <Button variant="outline" onClick={onReset}>
        <RotateCcw className="h-4 w-4 mr-2" />
        Сбросить фильтры
      </Button>
    </div>
  );
}

interface StudentsErrorProps {
  onRetry: () => void;
}

export function StudentsError({ onRetry }: StudentsErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <h3 className="font-medium text-lg mb-2">Не удалось загрузить учеников</h3>
      <p className="text-muted-foreground mb-6">
        Произошла ошибка при загрузке данных
      </p>
      <Button onClick={onRetry}>
        <RotateCcw className="h-4 w-4 mr-2" />
        Повторить
      </Button>
    </div>
  );
}
