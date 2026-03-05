import { supabase } from '@/lib/supabaseClient';
import type {
  StudentHomeworkAssignment,
  StudentHomeworkAssignmentDetails,
  StudentHomeworkSubmission,
} from '@/types/homework';

const HOMEWORK_IMAGES_BUCKET = 'homework-images';
const HOMEWORK_SUBMISSIONS_BUCKET = 'homework-submissions';
const STORAGE_REF_PREFIX = 'storage://';

export class StudentHomeworkApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentHomeworkApiError';
  }
}

function ensureUserId(userId: string | undefined): string {
  if (!userId) {
    throw new StudentHomeworkApiError('Пользователь не авторизован');
  }
  return userId;
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }
  return ensureUserId(data.user?.id);
}

function isDeadlinePassed(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() <= Date.now();
}

function translateSupabaseError(message: string): string {
  const lower = message.toLowerCase();
  if (message.includes('DEADLINE_PASSED')) return 'Дедлайн уже прошёл. Новая попытка недоступна.';
  if (message.includes('MAX_ATTEMPTS_REACHED')) return 'Лимит попыток исчерпан.';
  if (message.includes('homework_tutor_submissions_attempt_unique')) {
    return 'Попытка уже создана. Обновите страницу и попробуйте снова.';
  }
  if (lower.includes('row-level security')) {
    return 'Недостаточно прав для выполнения операции.';
  }
  if (lower.includes('permission denied')) {
    return 'Доступ запрещён для этой операции.';
  }
  return message;
}

function toStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
}

export async function listStudentAssignments(): Promise<StudentHomeworkAssignment[]> {
  const studentId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('homework_tutor_student_assignments')
    .select(`
      assignment_id,
      homework_tutor_assignments!inner(
        id,
        title,
        subject,
        topic,
        description,
        deadline,
        status,
        created_at
      )
    `)
    .eq('student_id', studentId);

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }

  const assignmentRows = (data ?? []).filter((row: any) => {
    const status = row?.homework_tutor_assignments?.status;
    return status === 'active' || status === 'closed';
  });

  const assignmentIds = assignmentRows.map((row: any) => row.assignment_id as string);

  const { data: attemptsRows, error: attemptsError } = await supabase
    .from('homework_tutor_submissions')
    .select('assignment_id, attempt_no, status')
    .eq('student_id', studentId)
    .in('assignment_id', assignmentIds.length > 0 ? assignmentIds : ['00000000-0000-0000-0000-000000000000']);

  if (attemptsError) {
    throw new StudentHomeworkApiError(attemptsError.message);
  }

  const attemptsMap = new Map<string, { attempts_used: number; latest_status: string | null }>();
  for (const row of attemptsRows ?? []) {
    const assignmentId = row.assignment_id as string;
    const prev = attemptsMap.get(assignmentId) ?? { attempts_used: 0, latest_status: null };
    const attemptNo = Number(row.attempt_no ?? 0);
    if (attemptNo > prev.attempts_used) {
      attemptsMap.set(assignmentId, {
        attempts_used: attemptNo,
        latest_status: typeof row.status === 'string' ? row.status : null,
      });
    }
  }

  return assignmentRows
    .map((row: any) => {
      const assignment = row.homework_tutor_assignments;
      const attemptInfo = attemptsMap.get(assignment.id) ?? { attempts_used: 0, latest_status: null };
      return {
        id: assignment.id,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        description: assignment.description,
        deadline: assignment.deadline,
        status: assignment.status,
        max_attempts: 3,
        attempts_used: attemptInfo.attempts_used,
        latest_submission_status: attemptInfo.latest_status,
      } satisfies StudentHomeworkAssignment;
    })
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
}

export async function getStudentSubmissions(assignmentId: string): Promise<StudentHomeworkSubmission[]> {
  const studentId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('homework_tutor_submissions')
    .select(`
      id,
      assignment_id,
      student_id,
      attempt_no,
      status,
      total_score,
      total_max_score,
      submitted_at,
      homework_tutor_submission_items(
        id,
        task_id,
        student_text,
        student_image_urls,
        ai_feedback,
        ai_score,
        ai_is_correct,
        tutor_comment,
        tutor_override_correct
      )
    `)
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .order('attempt_no', { ascending: false });

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }

  return (data ?? []) as unknown as StudentHomeworkSubmission[];
}

export async function getStudentAssignment(assignmentId: string): Promise<StudentHomeworkAssignmentDetails> {
  const studentId = await getCurrentUserId();

  const { data: assigned, error: assignedError } = await supabase
    .from('homework_tutor_student_assignments')
    .select('assignment_id')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (assignedError) throw new StudentHomeworkApiError(assignedError.message);
  if (!assigned) throw new StudentHomeworkApiError('Задание не найдено');

  const { data: assignment, error: assignmentError } = await supabase
    .from('homework_tutor_assignments')
    .select('id, title, subject, topic, description, deadline, status, created_at')
    .eq('id', assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError(assignmentError?.message ?? 'Задание не найдено');
  }

  const { data: tasks, error: tasksError } = await supabase
    .from('homework_tutor_tasks')
    .select('id, assignment_id, order_num, task_text, task_image_url, max_score')
    .eq('assignment_id', assignmentId)
    .order('order_num', { ascending: true });

  if (tasksError) throw new StudentHomeworkApiError(tasksError.message);

  const { data: materials, error: materialsError } = await supabase
    .from('homework_tutor_materials')
    .select('id, assignment_id, type, title, storage_ref, url, created_at')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true });

  if (materialsError) throw new StudentHomeworkApiError(materialsError.message);

  const submissions = await getStudentSubmissions(assignmentId);

  const result = {
    ...assignment,
    max_attempts: 3,
    updated_at: assignment.created_at,
    tasks: (tasks ?? []) as StudentHomeworkAssignmentDetails['tasks'],
    materials: (materials ?? []) as StudentHomeworkAssignmentDetails['materials'],
    submissions,
  } as unknown as StudentHomeworkAssignmentDetails;
  return result;
}

export async function createStudentSubmission(assignmentId: string): Promise<StudentHomeworkSubmission> {
  const studentId = await getCurrentUserId();

  const { data: assignment, error: assignmentError } = await supabase
    .from('homework_tutor_assignments')
    .select('id, deadline')
    .eq('id', assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError('Задание не найдено');
  }

  if (isDeadlinePassed(assignment.deadline)) {
    throw new StudentHomeworkApiError('Дедлайн уже прошёл. Новая попытка недоступна.');
  }

  const { data: latestSubmission, error: latestError } = await supabase
    .from('homework_tutor_submissions')
    .select('attempt_no')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .order('attempt_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new StudentHomeworkApiError(latestError.message);
  }

  const attemptsUsed = Number(latestSubmission?.attempt_no ?? 0);
  const maxAttempts = 3;

  if (attemptsUsed >= maxAttempts) {
    throw new StudentHomeworkApiError('Лимит попыток исчерпан.');
  }

  const { data, error } = await supabase
    .from('homework_tutor_submissions')
    .insert({
      assignment_id: assignmentId,
      student_id: studentId,
      attempt_no: attemptsUsed + 1,
      telegram_chat_id: null,
      status: 'in_progress',
    })
    .select(`
      id,
      assignment_id,
      student_id,
      attempt_no,
      status,
      total_score,
      total_max_score,
      submitted_at,
      homework_tutor_submission_items(
        id,
        task_id,
        student_text,
        student_image_urls,
        ai_feedback,
        ai_score,
        ai_is_correct,
        tutor_comment,
        tutor_override_correct
      )
    `)
    .single();

  if (error || !data) {
    throw new StudentHomeworkApiError(translateSupabaseError(error?.message ?? 'Не удалось создать попытку'));
  }

  return data as unknown as StudentHomeworkSubmission;
}

export async function uploadStudentHomeworkFiles(
  studentId: string,
  assignmentId: string,
  submissionId: string,
  taskId: string,
  files: File[],
): Promise<string[]> {
  const uploadedPaths: string[] = [];

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const ext = isPdf ? 'pdf' : (file.name.split('.').pop()?.toLowerCase() || 'jpg');
    const fileId = crypto.randomUUID();
    const primaryObjectPath = `${studentId}/${assignmentId}/${submissionId}/${taskId}/${fileId}.${ext}`;
    const contentType = file.type || (isPdf ? 'application/pdf' : 'application/octet-stream');

    const { error: primaryError } = await supabase.storage
      .from(HOMEWORK_SUBMISSIONS_BUCKET)
      .upload(primaryObjectPath, file, { upsert: false, contentType });

    if (!primaryError) {
      uploadedPaths.push(toStorageRef(HOMEWORK_SUBMISSIONS_BUCKET, primaryObjectPath));
      continue;
    }

    // Fallback to homework-images bucket if homework-submissions not yet created in this env
    const isBucketMissing =
      primaryError.message?.toLowerCase().includes('bucket not found') ||
      (primaryError as unknown as { statusCode?: number }).statusCode === 404;

    if (!isBucketMissing) {
      throw new StudentHomeworkApiError(
        `Ошибка загрузки файла: ${translateSupabaseError(primaryError.message)}`,
      );
    }

    // Legacy homework-images policies expect path prefix homework/{assignmentId}/...
    const fallbackObjectPath = `homework/${assignmentId}/${submissionId}/${taskId}/${fileId}.${ext}`;
    const { error: fallbackError } = await supabase.storage
      .from(HOMEWORK_IMAGES_BUCKET)
      .upload(fallbackObjectPath, file, { upsert: false, contentType });

    if (fallbackError) {
      throw new StudentHomeworkApiError(
        `Ошибка загрузки файла: ${translateSupabaseError(fallbackError.message)}`,
      );
    }
    uploadedPaths.push(fallbackObjectPath);
  }

  return uploadedPaths;
}

export async function submitStudentAnswer(
  submissionId: string,
  taskId: string,
  text?: string,
  files?: File[],
  answerType?: 'text' | 'image' | 'pdf',
): Promise<void> {
  let filePaths: string[] | null = null;

  if (files && files.length > 0) {
    const studentId = await getCurrentUserId();

    const { data: submission, error: submissionError } = await supabase
      .from('homework_tutor_submissions')
      .select('assignment_id')
      .eq('id', submissionId)
      .single();

    if (submissionError || !submission) {
      throw new StudentHomeworkApiError('Попытка не найдена');
    }

    filePaths = await uploadStudentHomeworkFiles(
      studentId,
      submission.assignment_id,
      submissionId,
      taskId,
      files,
    );
  }

  // Determine answer_type if not explicitly provided
  const resolvedAnswerType: 'text' | 'image' | 'pdf' | null = answerType ?? (
    files && files.length > 0
      ? (files.some(
          (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
        )
          ? 'pdf'
          : 'image')
      : (text?.trim() ? 'text' : null)
  );

  const { error } = await supabase
    .from('homework_tutor_submission_items')
    .upsert(
      {
        submission_id: submissionId,
        task_id: taskId,
        student_text: text?.trim() || null,
        student_image_urls: filePaths,
        answer_type: resolvedAnswerType,
      },
      { onConflict: 'submission_id,task_id' },
    );

  if (error) {
    throw new StudentHomeworkApiError(translateSupabaseError(error.message));
  }
}

export async function finalizeSubmission(submissionId: string): Promise<void> {
  const { data: submission, error: submissionError } = await supabase
    .from('homework_tutor_submissions')
    .select('assignment_id')
    .eq('id', submissionId)
    .single();

  if (submissionError || !submission) {
    throw new StudentHomeworkApiError('Попытка не найдена');
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('homework_tutor_assignments')
    .select('deadline')
    .eq('id', submission.assignment_id)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError('Задание не найдено');
  }

  if (isDeadlinePassed(assignment.deadline)) {
    throw new StudentHomeworkApiError('Дедлайн уже прошёл. Сдача недоступна.');
  }

  const { error } = await supabase
    .from('homework_tutor_submissions')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', submissionId);

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }
}
