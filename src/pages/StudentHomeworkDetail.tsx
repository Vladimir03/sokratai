import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  runStudentSubmissionAiCheck,
  submitStudentAnswer,
} from '@/lib/studentHomeworkApi';
import { useStudentAssignment } from '@/hooks/useStudentHomework';
import type { StudentHomeworkAssignmentDetails, StudentHomeworkSubmission } from '@/types/homework';

const GuidedHomeworkWorkspace = lazy(() => import('@/components/homework/GuidedHomeworkWorkspace'));

type AnswerType = 'text' | 'image' | 'pdf';

const ANSWER_TYPES: AnswerType[] = ['text', 'image', 'pdf'];

const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  in_progress: 'Черновик',
  submitted: 'Отправлено',
  ai_checked: 'Проверено AI',
  tutor_reviewed: 'Проверено репетитором',
};

type AiCheckUiStatus = 'idle' | 'running' | 'failed' | 'done';
const AUTO_AI_CHECK_MAX_ATTEMPTS = 8;
const AUTO_AI_CHECK_INTERVAL_MS = 15_000;

function formatSubmissionStatus(status: string): string {
  return SUBMISSION_STATUS_LABELS[status] ?? status;
}

function translateAiCheckError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const lower = rawMessage.toLowerCase();
  if (lower.includes('failed to run ai check') || lower.includes('ai_check_failed')) {
    return 'AI-проверка ещё не завершилась. Мы продолжим проверять автоматически.';
  }
  if (lower.includes('invalid state')) {
    return 'Работа ещё не готова к AI-проверке. Обновим статус автоматически.';
  }
  return 'AI-проверка временно недоступна. Повторите проверку чуть позже.';
}

function inferAnswerTypeFromSubmission(submission: StudentHomeworkSubmission | null, taskId: string): AnswerType {
  if (!submission) return 'text';
  const item = submission.homework_tutor_submission_items.find((row) => row.task_id === taskId);
  if (!item || !item.student_image_urls || item.student_image_urls.length === 0) {
    return 'text';
  }
  return item.student_image_urls.some((path) => path.toLowerCase().endsWith('.pdf')) ? 'pdf' : 'image';
}

function buildHomeworkChatContext(
  assignment: StudentHomeworkAssignmentDetails,
  submission: StudentHomeworkSubmission,
): string {
  const itemsByTaskId = new Map(
    submission.homework_tutor_submission_items.map((item) => [item.task_id, item]),
  );

  const materialsText = assignment.materials.length === 0
    ? 'Материалов нет.'
    : assignment.materials.map((material, index) => {
      const source = material.url ?? material.storage_ref;
      return `${index + 1}. ${material.title}${source ? ` — ${source}` : ''}`;
    }).join('\n');

  const tasksText = assignment.tasks.map((task) => {
    const item = itemsByTaskId.get(task.id);
    const lines: string[] = [
      `Задача ${task.order_num}: ${task.task_text}`,
    ];

    if (item?.student_text?.trim()) {
      lines.push(`Мой текстовый ответ: ${item.student_text.trim()}`);
    }

    if (item?.student_image_urls && item.student_image_urls.length > 0) {
      lines.push(`Мои файлы: ${item.student_image_urls.join(', ')}`);
    }

    if (!item?.student_text?.trim() && (!item?.student_image_urls || item.student_image_urls.length === 0)) {
      lines.push('Мой ответ: [нет данных]');
    }

    if (item?.ai_feedback?.trim()) {
      lines.push(`AI-фидбек: ${item.ai_feedback.trim()}`);
    }

    if (item?.ai_score !== null && item?.ai_score !== undefined) {
      lines.push(`AI-оценка: ${item.ai_score}/${task.max_score}`);
    }

    return lines.join('\n');
  }).join('\n\n');

  return [
    `Я разбираю домашнюю работу "${assignment.title}".`,
    `Предмет: ${assignment.subject}.`,
    assignment.topic ? `Тема: ${assignment.topic}.` : null,
    assignment.description ? `Описание ДЗ: ${assignment.description}.` : null,
    `Попытка: #${submission.attempt_no}.`,
    `Статус проверки: ${formatSubmissionStatus(submission.status)}.`,
    submission.total_score !== null && submission.total_max_score !== null
      ? `Итог: ${submission.total_score}/${submission.total_max_score}.`
      : null,
    '',
    'Материалы:',
    materialsText,
    '',
    'Задачи и мои ответы:',
    tasksText,
    '',
    'Помоги разобрать ошибки, объясни логику решения по шагам и дай план, как улучшить результат.',
  ].filter(Boolean).join('\n');
}

const StudentHomeworkDetail = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useStudentAssignment(id);

  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});
  const [draftFiles, setDraftFiles] = useState<Record<string, File[]>>({});
  const [answerTypes, setAnswerTypes] = useState<Record<string, AnswerType>>({});
  const [isStartingAttempt, setIsStartingAttempt] = useState(false);
  const [isSubmittingAttempt, setIsSubmittingAttempt] = useState(false);
  const [isRunningAiCheck, setIsRunningAiCheck] = useState(false);
  const [aiCheckUiStatus, setAiCheckUiStatus] = useState<AiCheckUiStatus>('idle');
  const [aiCheckErrorMessage, setAiCheckErrorMessage] = useState<string | null>(null);
  const aiCheckInFlightRef = useRef(false);
  const autoAiCheckAttemptsRef = useRef<Record<string, number>>({});

  const latestSubmission = useMemo(
    () => data?.submissions?.[0] ?? null,
    [data?.submissions],
  );

  const inProgressSubmission = useMemo(
    () => data?.submissions?.find((submission) => submission.status === 'in_progress') ?? null,
    [data?.submissions],
  );

  const latestCompletedSubmission = useMemo(
    () => data?.submissions?.find((submission) => submission.status !== 'in_progress') ?? null,
    [data?.submissions],
  );

  const inProgressItemsMap = useMemo(
    () => new Map((inProgressSubmission?.homework_tutor_submission_items ?? []).map((item) => [item.task_id, item])),
    [inProgressSubmission],
  );

  const latestCompletedItemsMap = useMemo(
    () => new Map((latestCompletedSubmission?.homework_tutor_submission_items ?? []).map((item) => [item.task_id, item])),
    [latestCompletedSubmission],
  );

  const latestCompletedTaskRows = useMemo(
    () => {
      if (!data || !latestCompletedSubmission) return [];
      return data.tasks.map((task) => ({
        task,
        item: latestCompletedItemsMap.get(task.id) ?? null,
      }));
    },
    [data, latestCompletedItemsMap, latestCompletedSubmission],
  );

  const attemptsUsed = latestSubmission?.attempt_no ?? 0;
  const maxAttempts = data?.max_attempts ?? 3;
  const deadlinePassed = data?.deadline ? new Date(data.deadline).getTime() <= Date.now() : false;
  const attemptsReached = attemptsUsed >= maxAttempts;

  const canStartAttempt = Boolean(data) && !deadlinePassed && !attemptsReached && !inProgressSubmission;
  const canSubmitAttempt = Boolean(data) && Boolean(inProgressSubmission) && !deadlinePassed;
  const hasAnyCompletedSubmission = Boolean(latestCompletedSubmission);
  const isBusy = isStartingAttempt || isSubmittingAttempt || isRunningAiCheck;
  const latestSubmissionNeedsAiCheck = latestCompletedSubmission?.status === 'submitted';
  const latestSubmissionChecked = latestCompletedSubmission?.status === 'ai_checked' ||
    latestCompletedSubmission?.status === 'tutor_reviewed';
  const canDiscussWithAi = Boolean(latestSubmissionChecked && latestCompletedSubmission);
  const latestCompletedSubmissionId = latestCompletedSubmission?.id ?? null;
  const latestCompletedSubmissionStatus = latestCompletedSubmission?.status ?? null;

  const refreshHomeworkData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['student', 'homework'] });
    await queryClient.refetchQueries({ queryKey: ['student', 'homework', 'assignment', id] });
  }, [id, queryClient]);

  const runAiCheckForSubmission = useCallback(
    async (
      submissionId: string,
      options?: { silent?: boolean; showSuccessToast?: boolean },
    ): Promise<boolean> => {
      if (aiCheckInFlightRef.current) return false;

      aiCheckInFlightRef.current = true;
      setIsRunningAiCheck(true);
      setAiCheckUiStatus('running');
      setAiCheckErrorMessage(null);

      try {
        const aiResult = await runStudentSubmissionAiCheck(submissionId);
        if (aiResult.status === 'ai_checked' || aiResult.status === 'tutor_reviewed') {
          setAiCheckUiStatus('done');
          setAiCheckErrorMessage(null);
          if (options?.showSuccessToast) {
            if (aiResult.total_score !== null && aiResult.total_max_score !== null) {
              toast.success(`AI-проверка завершена: ${aiResult.total_score}/${aiResult.total_max_score}`);
            } else {
              toast.success('AI-проверка завершена.');
            }
          }
          return true;
        }
        setAiCheckUiStatus('running');
        return false;
      } catch (error) {
        const translated = translateAiCheckError(error);
        setAiCheckUiStatus('failed');
        setAiCheckErrorMessage(translated);
        if (!options?.silent) {
          toast.error(translated);
        }
        return false;
      } finally {
        aiCheckInFlightRef.current = false;
        setIsRunningAiCheck(false);
        await refreshHomeworkData();
      }
    },
    [refreshHomeworkData],
  );

  const handleRetryAiCheck = async () => {
    if (!latestCompletedSubmissionId || latestCompletedSubmissionStatus !== 'submitted') return;

    autoAiCheckAttemptsRef.current[latestCompletedSubmissionId] = 0;
    await runAiCheckForSubmission(latestCompletedSubmissionId, {
      showSuccessToast: true,
    });
  };

  useEffect(() => {
    if (!latestCompletedSubmissionId || !latestCompletedSubmissionStatus) {
      setAiCheckUiStatus('idle');
      setAiCheckErrorMessage(null);
      return;
    }

    if (latestCompletedSubmissionStatus === 'ai_checked' || latestCompletedSubmissionStatus === 'tutor_reviewed') {
      setAiCheckUiStatus('done');
      setAiCheckErrorMessage(null);
      delete autoAiCheckAttemptsRef.current[latestCompletedSubmissionId];
      return;
    }

    if (latestCompletedSubmissionStatus === 'submitted') {
      setAiCheckUiStatus((prev) => (prev === 'failed' ? prev : 'running'));
      return;
    }

    setAiCheckUiStatus('idle');
    setAiCheckErrorMessage(null);
  }, [latestCompletedSubmissionId, latestCompletedSubmissionStatus]);

  useEffect(() => {
    if (!latestCompletedSubmissionId || latestCompletedSubmissionStatus !== 'submitted') return;
    const submissionId = latestCompletedSubmissionId;

    const runAutoCheck = async () => {
      if (aiCheckInFlightRef.current) return;
      const attempts = autoAiCheckAttemptsRef.current[submissionId] ?? 0;
      if (attempts >= AUTO_AI_CHECK_MAX_ATTEMPTS) {
        setAiCheckUiStatus('failed');
        setAiCheckErrorMessage((prev) => prev ?? 'AI-проверка заняла больше времени. Нажмите «Проверить сейчас».');
        return;
      }

      autoAiCheckAttemptsRef.current[submissionId] = attempts + 1;
      await runAiCheckForSubmission(submissionId, { silent: true });
    };

    void runAutoCheck();
    const intervalId = window.setInterval(() => {
      void runAutoCheck();
    }, AUTO_AI_CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [latestCompletedSubmissionId, latestCompletedSubmissionStatus, runAiCheckForSubmission]);

  const handleStartAttempt = async () => {
    if (!data || !canStartAttempt) return;

    setIsStartingAttempt(true);
    try {
      await createStudentSubmission(data.id);
      setDraftTexts({});
      setDraftFiles({});
      setAnswerTypes({});
      await refreshHomeworkData();
      toast.success('Попытка создана. Заполните ответы и нажмите «Сдать».');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось начать попытку');
    } finally {
      setIsStartingAttempt(false);
    }
  };

  const handleSubmitAttempt = async () => {
    if (!data || !inProgressSubmission) return;

    const missingTaskNumbers = data.tasks
      .filter((task) => {
        const draftText = (draftTexts[task.id] ?? '').trim();
        const draftFileCount = draftFiles[task.id]?.length ?? 0;
        const existingItem = inProgressItemsMap.get(task.id);
        const existingText = (existingItem?.student_text ?? '').trim();
        const existingFileCount = existingItem?.student_image_urls?.length ?? 0;
        return draftText.length === 0 && draftFileCount === 0 && existingText.length === 0 && existingFileCount === 0;
      })
      .map((task) => task.order_num);

    if (missingTaskNumbers.length > 0) {
      toast.error(`Заполните ответы для задач: ${missingTaskNumbers.join(', ')}`);
      return;
    }

    setIsSubmittingAttempt(true);
    try {
      for (const task of data.tasks) {
        const draftText = draftTexts[task.id];
        const draftTaskFiles = draftFiles[task.id];
        const hasDraftText = typeof draftText === 'string' && draftText.trim().length > 0;
        const hasDraftFiles = Array.isArray(draftTaskFiles) && draftTaskFiles.length > 0;
        const hasStoredAnswer = inProgressItemsMap.has(task.id);

        if (!hasDraftText && !hasDraftFiles && hasStoredAnswer) {
          continue;
        }

        await submitStudentAnswer(
          inProgressSubmission.id,
          task.id,
          draftText,
          draftTaskFiles,
          answerTypes[task.id],
        );
      }

      await finalizeSubmission(inProgressSubmission.id);
      toast.success('Домашка отправлена. AI-проверка запущена.');
      setDraftTexts({});
      setDraftFiles({});
      setAnswerTypes({});
      setAiCheckUiStatus('running');
      setAiCheckErrorMessage(null);
      autoAiCheckAttemptsRef.current[inProgressSubmission.id] = 0;
      await refreshHomeworkData();
      void runAiCheckForSubmission(inProgressSubmission.id, { silent: true, showSuccessToast: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
      setIsSubmittingAttempt(false);
      return;
    } finally {
      setIsSubmittingAttempt(false);
    }
  };

  const handleDiscussWithAi = () => {
    if (!data || !latestCompletedSubmission || !canDiscussWithAi) return;

    const contextMessage = buildHomeworkChatContext(data, latestCompletedSubmission);
    navigate('/chat', {
      state: {
        initialMessage: contextMessage,
        chatType: 'homework_help',
      },
    });
  };

  // Guided chat mode: render interactive workspace
  if (data && data.workflow_mode === 'guided_chat') {
    return (
      <AuthGuard>
        <div className="min-h-[100dvh] bg-background flex flex-col">
          <Navigation />
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Загрузка...
              </div>
            }
          >
            <GuidedHomeworkWorkspace assignment={data} />
          </Suspense>
        </div>
      </AuthGuard>
    );
  }

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
                    {inProgressSubmission && (
                      <Badge variant="secondary">Текущая попытка #{inProgressSubmission.attempt_no}: Черновик</Badge>
                    )}
                    {!inProgressSubmission && latestSubmissionNeedsAiCheck && (
                      <Badge variant={aiCheckUiStatus === 'failed' ? 'destructive' : 'secondary'}>
                        {aiCheckUiStatus === 'failed' ? 'AI-проверка задерживается' : 'Отправлено, идёт AI-проверка'}
                      </Badge>
                    )}
                    {!inProgressSubmission && latestSubmissionChecked && (
                      <Badge>AI-проверка завершена</Badge>
                    )}
                    {deadlinePassed && <Badge variant="destructive">Дедлайн прошёл</Badge>}
                    {attemptsReached && <Badge variant="destructive">Лимит попыток исчерпан</Badge>}
                  </CardContent>
                </Card>

                {latestCompletedSubmission && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Последняя отправка</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm">
                        Попытка #{latestCompletedSubmission.attempt_no}: {formatSubmissionStatus(latestCompletedSubmission.status)}
                      </p>
                      {latestSubmissionNeedsAiCheck && (
                        <p className="text-sm text-muted-foreground">
                          {aiCheckUiStatus === 'failed'
                            ? aiCheckErrorMessage ?? 'AI-проверка ещё не завершилась.'
                            : 'AI-проверка выполняется. Результат появится на этой странице автоматически.'}
                        </p>
                      )}
                      {latestCompletedSubmission.total_score !== null && (
                        <p className="text-sm font-medium">
                          Результат: {latestCompletedSubmission.total_score}/{latestCompletedSubmission.total_max_score}
                        </p>
                      )}

                      {latestSubmissionNeedsAiCheck && (
                        <Button
                          variant="outline"
                          onClick={handleRetryAiCheck}
                          disabled={isRunningAiCheck}
                        >
                          {isRunningAiCheck ? 'Проверяем...' : 'Проверить сейчас'}
                        </Button>
                      )}

                      {latestSubmissionChecked && latestCompletedTaskRows.length > 0 && (
                        <div className="space-y-2">
                          {latestCompletedTaskRows.map(({ task, item }) => {
                            const score = item?.ai_score ?? 0;
                            const isCorrect = item?.ai_is_correct;
                            return (
                              <div key={task.id} className="rounded-md border p-3 text-sm space-y-1">
                                <p className="font-medium">
                                  {isCorrect === true ? '✅' : isCorrect === false ? '❌' : '•'} Задача {task.order_num}: {score}/{task.max_score}
                                </p>
                                {item?.ai_feedback?.trim() && (
                                  <p className="text-muted-foreground">{item.ai_feedback.trim()}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {canDiscussWithAi ? (
                        <Button variant="outline" onClick={handleDiscussWithAi}>
                          Разобрать с ИИ в чате
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Кнопка разбора с ИИ станет доступна после завершения AI-проверки.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

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
                    {!inProgressSubmission && canStartAttempt && (
                      <p className="text-sm text-muted-foreground">
                        Нажмите «Начать попытку», чтобы открыть ввод ответов.
                      </p>
                    )}
                    {data.tasks.map((task) => {
                      const inferredType = inferAnswerTypeFromSubmission(inProgressSubmission, task.id);
                      const answerType = answerTypes[task.id] ?? inferredType;
                      const existingFileCount = inProgressItemsMap.get(task.id)?.student_image_urls?.length ?? 0;

                      return (
                        <div key={task.id} className="space-y-3 border rounded-md p-3">
                          <p className="font-medium">{task.order_num}. {task.task_text}</p>

                          <div className="flex gap-2 text-sm">
                            {ANSWER_TYPES.map((type) => (
                              <button
                                key={type}
                                type="button"
                                disabled={!inProgressSubmission || isBusy}
                                onClick={() => setAnswerTypes((prev) => ({ ...prev, [task.id]: type }))}
                                className={`px-3 py-1 rounded border transition-colors ${
                                  answerType === type
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'border-input hover:bg-accent'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                              >
                                {type === 'text' ? 'Текст' : type === 'image' ? 'Фото' : 'PDF'}
                              </button>
                            ))}
                          </div>

                          {answerType === 'text' && (
                            <textarea
                              className="w-full border rounded-md p-2 text-base disabled:opacity-60"
                              style={{ fontSize: '16px' }}
                              placeholder="Ваш ответ"
                              rows={4}
                              disabled={!inProgressSubmission || isBusy}
                              value={draftTexts[task.id] ?? ''}
                              onChange={(event) =>
                                setDraftTexts((prev) => ({ ...prev, [task.id]: event.target.value }))
                              }
                            />
                          )}

                          {answerType === 'image' && (
                            <div className="space-y-1">
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                capture="environment"
                                className="text-base"
                                style={{ fontSize: '16px' }}
                                disabled={!inProgressSubmission || isBusy}
                                onChange={(event) =>
                                  setDraftFiles((prev) => ({
                                    ...prev,
                                    [task.id]: Array.from(event.target.files ?? []),
                                  }))
                                }
                              />
                              {(draftFiles[task.id]?.length ?? 0) > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Выбрано файлов: {draftFiles[task.id].length}
                                </p>
                              )}
                              {(draftFiles[task.id]?.length ?? 0) === 0 && existingFileCount > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Уже прикреплено файлов: {existingFileCount}
                                </p>
                              )}
                            </div>
                          )}

                          {answerType === 'pdf' && (
                            <div className="space-y-1">
                              <input
                                type="file"
                                accept="application/pdf"
                                className="text-base"
                                style={{ fontSize: '16px' }}
                                disabled={!inProgressSubmission || isBusy}
                                onChange={(event) =>
                                  setDraftFiles((prev) => ({
                                    ...prev,
                                    [task.id]: Array.from(event.target.files ?? []),
                                  }))
                                }
                              />
                              {(draftFiles[task.id]?.length ?? 0) > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {draftFiles[task.id][0].name}
                                </p>
                              )}
                              {(draftFiles[task.id]?.length ?? 0) === 0 && existingFileCount > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Уже прикреплено файлов: {existingFileCount}
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
                        Попытка #{submission.attempt_no}: {formatSubmissionStatus(submission.status)}
                        {submission.total_score !== null && (
                          <span> — {submission.total_score}/{submission.total_max_score}</span>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {canStartAttempt && (
                  <Button disabled={isBusy} onClick={handleStartAttempt} className="w-full">
                    {isStartingAttempt ? 'Создание попытки...' : 'Начать новую попытку'}
                  </Button>
                )}

                {canSubmitAttempt && (
                  <Button disabled={isBusy} onClick={handleSubmitAttempt} className="w-full">
                    {isSubmittingAttempt
                      ? 'Отправка...'
                      : isRunningAiCheck
                        ? 'Проверка AI...'
                        : 'Сдать'}
                  </Button>
                )}

                {!canStartAttempt && !canSubmitAttempt && !hasAnyCompletedSubmission && (
                  <p className="text-sm text-muted-foreground text-center">
                    Новая попытка сейчас недоступна.
                  </p>
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
