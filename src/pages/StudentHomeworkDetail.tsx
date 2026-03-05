import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { PageContent } from '@/components/PageContent';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createStudentSubmission,
  finalizeSubmission,
  submitStudentAnswer,
} from '@/lib/studentHomeworkApi';
import { useStudentAssignment } from '@/hooks/useStudentHomework';

type AnswerType = 'text' | 'image' | 'pdf';

const StudentHomeworkDetail = () => {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useStudentAssignment(id);

  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});
  const [draftFiles, setDraftFiles] = useState<Record<string, File[]>>({});
  const [answerTypes, setAnswerTypes] = useState<Record<string, AnswerType>>({});
  const [submitting, setSubmitting] = useState(false);

  const latestSubmission = useMemo(
    () => data?.submissions?.[0] ?? null,
    [data?.submissions],
  );
  const inProgressSubmission = useMemo(
    () => data?.submissions?.find((s) => s.status === 'in_progress') ?? null,
    [data?.submissions],
  );

  const attemptsUsed = latestSubmission?.attempt_no ?? 0;
  const maxAttempts = data?.max_attempts ?? 3;
  const deadlinePassed = data?.deadline ? new Date(data.deadline).getTime() <= Date.now() : false;
  const attemptsReached = attemptsUsed >= maxAttempts;

  const canSubmit = !deadlinePassed && !attemptsReached;

  const handleFinalize = async () => {
    if (!data) return;
    setSubmitting(true);
    try {
      const submission = inProgressSubmission ?? (await createStudentSubmission(data.id));

      for (const task of data.tasks) {
        await submitStudentAnswer(
          submission.id,
          task.id,
          draftTexts[task.id],
          draftFiles[task.id],
          answerTypes[task.id],
        );
      }

      await finalizeSubmission(submission.id);
      toast.success('Домашнее задание отправлено');
      await queryClient.invalidateQueries({ queryKey: ['student', 'homework'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
            {error && <p className="text-destructive">Не удалось загрузить задание</p>}

            {data && (
              <div className="max-w-4xl mx-auto space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>{data.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p>Предмет: {data.subject}</p>
                    {data.deadline && <p>Дедлайн: {new Date(data.deadline).toLocaleString('ru-RU')}</p>}
                    <p>Попытки: {attemptsUsed}/{maxAttempts}</p>
                    {deadlinePassed && <Badge variant="destructive">Дедлайн прошёл</Badge>}
                    {attemptsReached && <Badge variant="destructive">Лимит попыток исчерпан</Badge>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Материалы</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {data.materials.length === 0 && <p className="text-muted-foreground">Материалов нет</p>}
                    {data.materials.map((material) => (
                      <div key={material.id} className="text-sm">
                        {material.url ? (
                          <a className="underline" href={material.url} target="_blank" rel="noreferrer">
                            {material.title}
                          </a>
                        ) : (
                          <span>{material.title}</span>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Задачи</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.tasks.map((task) => {
                      const aType = answerTypes[task.id] ?? 'text';
                      return (
                        <div key={task.id} className="space-y-3 border rounded-md p-3">
                          <p className="font-medium">{task.order_num}. {task.task_text}</p>

                          <div className="flex gap-2 text-sm">
                            {(['text', 'image', 'pdf'] as AnswerType[]).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setAnswerTypes((prev) => ({ ...prev, [task.id]: t }))}
                                className={`px-3 py-1 rounded border transition-colors ${
                                  aType === t
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'border-input hover:bg-accent'
                                }`}
                              >
                                {t === 'text' ? 'Текст' : t === 'image' ? 'Фото' : 'PDF'}
                              </button>
                            ))}
                          </div>

                          {aType === 'text' && (
                            <textarea
                              className="w-full border rounded-md p-2 text-base"
                              style={{ fontSize: '16px' }}
                              placeholder="Ваш ответ"
                              rows={4}
                              value={draftTexts[task.id] ?? ''}
                              onChange={(e) =>
                                setDraftTexts((prev) => ({ ...prev, [task.id]: e.target.value }))
                              }
                            />
                          )}

                          {aType === 'image' && (
                            <div className="space-y-1">
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                capture="environment"
                                onChange={(e) =>
                                  setDraftFiles((prev) => ({
                                    ...prev,
                                    [task.id]: Array.from(e.target.files ?? []),
                                  }))
                                }
                              />
                              {(draftFiles[task.id]?.length ?? 0) > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Выбрано файлов: {draftFiles[task.id].length}
                                </p>
                              )}
                            </div>
                          )}

                          {aType === 'pdf' && (
                            <div className="space-y-1">
                              <input
                                type="file"
                                accept="application/pdf"
                                onChange={(e) =>
                                  setDraftFiles((prev) => ({
                                    ...prev,
                                    [task.id]: Array.from(e.target.files ?? []),
                                  }))
                                }
                              />
                              {(draftFiles[task.id]?.length ?? 0) > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {draftFiles[task.id][0].name}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>История попыток</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {data.submissions.length === 0 && <p className="text-muted-foreground">Попыток пока нет</p>}
                    {data.submissions.map((submission) => (
                      <div key={submission.id} className="text-sm border rounded-md p-2">
                        Попытка #{submission.attempt_no}: {submission.status}
                        {submission.total_score !== null && (
                          <span> — {submission.total_score}/{submission.total_max_score}</span>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {canSubmit && (
                  <Button disabled={submitting} onClick={handleFinalize} className="w-full">
                    {submitting ? 'Отправка...' : 'Сдать'}
                  </Button>
                )}
              </div>
            )}
          </main>
        </PageContent>
      </div>
    </AuthGuard>
  );
};

export default StudentHomeworkDetail;
