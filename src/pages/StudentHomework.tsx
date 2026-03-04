import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Navigation from '@/components/Navigation';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
import { useStudentAssignments } from '@/hooks/useStudentHomework';
import { Link } from 'react-router-dom';

function formatStatus(status: string | null, deadline: string | null) {
  if (deadline && new Date(deadline).getTime() <= Date.now()) return 'deadline_missed';
  if (status === 'tutor_reviewed' || status === 'ai_checked') return 'checked';
  if (status === 'submitted') return 'submitted';
  return 'assigned';
}

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'Отправлено',
  checked: 'Проверено',
  deadline_missed: 'Дедлайн прошёл',
};

const StudentHomework = () => {
  const { data, isLoading, error } = useStudentAssignments();

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            <div className="max-w-5xl mx-auto space-y-4">
              <h1 className="text-3xl font-bold">Домашние задания</h1>

              {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
              {error && <p className="text-destructive">Не удалось загрузить задания</p>}

              {!isLoading && !error && (data?.length ?? 0) === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Нет назначенных ДЗ
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data?.map((assignment) => {
                  const uiStatus = formatStatus(
                    assignment.latest_submission_status,
                    assignment.deadline,
                  );

                  return (
                    <Card key={assignment.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle>{assignment.title}</CardTitle>
                          <Badge>{STATUS_LABELS[uiStatus]}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-sm text-muted-foreground">Предмет: {assignment.subject}</p>
                        {assignment.deadline && (
                          <p className="text-sm text-muted-foreground">
                            Дедлайн: {new Date(assignment.deadline).toLocaleString('ru-RU')}
                          </p>
                        )}
                        <p className="text-sm">{assignment.attempts_used}/{assignment.max_attempts} попыток</p>
                        <Button asChild className="w-full">
                          <Link to={`/homework/${assignment.id}`}>Открыть</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </main>
        </PageContent>
      </div>
    </AuthGuard>
  );
};

export default StudentHomework;
