/**
 * AI check logic for homework submissions.
 * Extracted from telegram-bot/homework/homework_handler.ts to avoid cross-function imports.
 */
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  checkHomeworkAnswer,
  recognizeHomeworkPhoto,
  type HomeworkAiErrorType,
  type HomeworkSubject,
} from "./vision_checker.ts";

const HOMEWORK_IMAGES_BUCKET = "homework-images";
const HOMEWORK_TASK_IMAGES_BUCKET = "homework-task-images";
const HOMEWORK_TASK_IMAGE_FALLBACK_BUCKET = "chat-images";
const AI_FEEDBACK_TASK_MAX_LEN = 450;
const AI_FEEDBACK_COMMENT_MAX_LEN = 280;
const AI_FEEDBACK_CONDITION_LABEL = "Условие задачи:";
const AI_FEEDBACK_COMMENT_LABEL = "Краткий комментарий:";

export interface HomeworkTaskRow {
  id: string;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  solution_steps: string | null;
  rubric_text: string | null;
  max_score: number;
}

export interface HomeworkSubmissionItemRow {
  id: string;
  submission_id: string;
  task_id: string;
  student_text: string | null;
  student_image_urls: string[] | null;
}

export interface HomeworkAiTaskResult {
  task_id: string;
  order_num: number;
  max_score: number;
  ai_score: number;
  is_correct: boolean;
  confidence: number;
  feedback: string;
  error_type: HomeworkAiErrorType;
  recognized_text: string;
}

export interface HomeworkAiCheckSummary {
  submission_id: string;
  assignment_id: string;
  assignment_title: string;
  subject: HomeworkSubject;
  total_score: number;
  total_max_score: number;
  task_results: HomeworkAiTaskResult[];
}

function isHomeworkSubject(value: string): value is HomeworkSubject {
  return value === "math" || value === "physics" || value === "history" || value === "social" || value === "english" || value === "cs";
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function shortenText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const sliced = text.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  const safe = lastSpace > maxLen * 0.7 ? sliced.slice(0, lastSpace) : sliced;
  return `${safe.trim()}...`;
}

function toComparableText(text: string): string {
  return normalizeText(text).replace(/\s+/g, " ");
}

function appendUniqueTextPart(parts: string[], text: string | null | undefined): void {
  const normalized = normalizeText(text);
  if (!normalized) return;

  const comparable = toComparableText(normalized);
  if (parts.some((part) => toComparableText(part) === comparable)) {
    return;
  }

  parts.push(normalized);
}

function formatAiFeedback(taskCondition: string, comment: string): string {
  const safeTaskCondition = shortenText(normalizeText(taskCondition), AI_FEEDBACK_TASK_MAX_LEN);
  const safeComment = shortenText(
    normalizeText(comment) || "AI не сформировал комментарий. Нужна ручная проверка репетитором.",
    AI_FEEDBACK_COMMENT_MAX_LEN,
  );

  if (!safeTaskCondition) {
    return `${AI_FEEDBACK_COMMENT_LABEL}\n${safeComment}`;
  }

  return [
    AI_FEEDBACK_CONDITION_LABEL,
    safeTaskCondition,
    "",
    AI_FEEDBACK_COMMENT_LABEL,
    safeComment,
  ].join("\n");
}

function resolveTaskMaxScore(maxScore: number): number {
  if (!Number.isFinite(maxScore)) return 1;
  const rounded = Math.round(maxScore);
  return rounded < 0 ? 0 : rounded;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function ensureSubmissionItemsForTasks(
  supabase: SupabaseClient,
  submissionId: string,
  taskIds: string[],
): Promise<void> {
  const uniqueTaskIds = [...new Set(taskIds.filter((taskId) => typeof taskId === "string" && taskId.length > 0))];
  if (uniqueTaskIds.length === 0) return;

  const payload = uniqueTaskIds.map((taskId) => ({
    submission_id: submissionId,
    task_id: taskId,
  }));

  const { error } = await supabase
    .from("homework_tutor_submission_items")
    .upsert(payload, { onConflict: "submission_id,task_id" });

  if (error) {
    throw new Error(`Failed to ensure submission items: ${error.message}`);
  }
}

async function downloadHomeworkImageAsBase64(supabase: SupabaseClient, objectPath: string): Promise<string> {
  // Try homework-submissions bucket first (new), fallback to homework-images
  const isStorageRef = objectPath.startsWith("storage://");
  let bucket = HOMEWORK_IMAGES_BUCKET;
  let path = objectPath;

  if (isStorageRef) {
    const withoutPrefix = objectPath.slice("storage://".length);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx > 0) {
      bucket = withoutPrefix.slice(0, slashIdx);
      path = withoutPrefix.slice(slashIdx + 1);
    }
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    // Fallback: if we tried homework-submissions and it failed, try homework-images
    if (bucket !== HOMEWORK_IMAGES_BUCKET) {
      const { data: fallbackData, error: fallbackError } = await supabase.storage
        .from(HOMEWORK_IMAGES_BUCKET)
        .download(path);
      if (fallbackError || !fallbackData) {
        throw new Error(`Failed to download homework image from storage: ${fallbackError?.message ?? error?.message ?? "unknown error"}`);
      }
      const buffer = await fallbackData.arrayBuffer();
      return bytesToBase64(new Uint8Array(buffer));
    }
    throw new Error(`Failed to download homework image from storage: ${error?.message ?? "unknown error"}`);
  }

  const buffer = await data.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

async function downloadTaskImageAsBase64(
  supabase: SupabaseClient,
  taskImageRef: string,
): Promise<string> {
  const isStorageRef = taskImageRef.startsWith("storage://");
  let bucket = HOMEWORK_TASK_IMAGES_BUCKET;
  let path = taskImageRef;

  if (isStorageRef) {
    const withoutPrefix = taskImageRef.slice("storage://".length);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx > 0) {
      bucket = withoutPrefix.slice(0, slashIdx);
      path = withoutPrefix.slice(slashIdx + 1);
    }
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (!error && data) {
    const buffer = await data.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  }

  if (bucket !== HOMEWORK_TASK_IMAGE_FALLBACK_BUCKET) {
    const { data: fallbackData, error: fallbackError } = await supabase.storage
      .from(HOMEWORK_TASK_IMAGE_FALLBACK_BUCKET)
      .download(path);
    if (!fallbackError && fallbackData) {
      const buffer = await fallbackData.arrayBuffer();
      return bytesToBase64(new Uint8Array(buffer));
    }
  }

  throw new Error(`Failed to download task image from storage: ${error?.message ?? "unknown error"}`);
}

export async function runHomeworkAiCheck(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<HomeworkAiCheckSummary> {
  console.log("homework_ai_check_start", { submission_id: submissionId });

  const { data: submission, error: submissionError } = await supabase
    .from("homework_tutor_submissions")
    .select("id, assignment_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    throw new Error(`Failed to load submission for AI check: ${submissionError?.message ?? "not found"}`);
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("homework_tutor_assignments")
    .select("id, title, subject")
    .eq("id", submission.assignment_id)
    .maybeSingle();

  if (assignmentError || !assignment) {
    throw new Error(`Failed to load assignment for AI check: ${assignmentError?.message ?? "not found"}`);
  }

  if (!isHomeworkSubject(assignment.subject)) {
    throw new Error(`Unsupported homework subject for AI check: ${assignment.subject}`);
  }

  const subject = assignment.subject as HomeworkSubject;

  const { data: tasks, error: tasksError } = await supabase
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, correct_answer, solution_steps, rubric_text, max_score")
    .eq("assignment_id", assignment.id)
    .order("order_num", { ascending: true });

  if (tasksError) {
    throw new Error(`Failed to load homework tasks for AI check: ${tasksError.message}`);
  }

  const typedTasks = (tasks ?? []) as HomeworkTaskRow[];
  if (typedTasks.length === 0) {
    throw new Error("Cannot run AI check: assignment has no tasks");
  }

  await ensureSubmissionItemsForTasks(supabase, submissionId, typedTasks.map((task) => task.id));

  const { data: submissionItems, error: itemsError } = await supabase
    .from("homework_tutor_submission_items")
    .select("id, submission_id, task_id, student_text, student_image_urls")
    .eq("submission_id", submissionId);

  if (itemsError) {
    throw new Error(`Failed to load submission items for AI check: ${itemsError.message}`);
  }

  const itemsByTaskId = new Map<string, HomeworkSubmissionItemRow>();
  for (const row of (submissionItems ?? []) as HomeworkSubmissionItemRow[]) {
    itemsByTaskId.set(row.task_id, row);
  }

  const taskResults: HomeworkAiTaskResult[] = [];

  for (const task of typedTasks) {
    try {
      const item = itemsByTaskId.get(task.id);
      const studentText = normalizeText(item?.student_text);
      const taskTextParts: string[] = [];
      const baseTaskText = normalizeText(task.task_text);
      appendUniqueTextPart(taskTextParts, baseTaskText);

      if (task.task_image_url) {
        try {
          const taskImageBase64 = await downloadTaskImageAsBase64(supabase, task.task_image_url);
          const recognizedTask = await recognizeHomeworkPhoto(taskImageBase64, subject, { strict: true });
          const normalizedTaskImageText = normalizeText(recognizedTask.recognized_text);
          appendUniqueTextPart(taskTextParts, normalizedTaskImageText);
        } catch (error) {
          console.warn("homework_ai_task_image_ocr_failed", {
            submission_id: submissionId,
            task_id: task.id,
            task_image_url: task.task_image_url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const effectiveTaskText = taskTextParts.join("\n\n");
      const studentImagePaths = Array.isArray(item?.student_image_urls)
        ? item!.student_image_urls.filter((v): v is string => typeof v === "string")
        : [];

      const hasTaskText = effectiveTaskText.length > 0;
      const hasStudentText = studentText.length > 0;
      const hasStudentImages = studentImagePaths.length > 0;

      const maxScore = resolveTaskMaxScore(task.max_score);

      if (!hasTaskText || (!hasStudentText && !hasStudentImages)) {
        const reason = !hasTaskText ? "empty_task_text" : "no_student_answer";
        console.log("homework_ai_context_insufficient", {
          submission_id: submissionId,
          task_id: task.id,
          order_num: task.order_num,
          reason,
        });

        taskResults.push({
          task_id: task.id,
          order_num: task.order_num,
          max_score: maxScore,
          ai_score: 0,
          is_correct: false,
          confidence: 0.2,
          feedback: formatAiFeedback(
            effectiveTaskText,
            "Недостаточно контекста для авто-проверки. Нужна ручная проверка репетитором.",
          ),
          error_type: "incomplete" as HomeworkAiErrorType,
          recognized_text: hasStudentText ? studentText : "",
        });
        continue;
      }

      const recognizedParts: string[] = [];
      if (studentText) {
        recognizedParts.push(studentText);
      }

      for (let i = 0; i < studentImagePaths.length; i += 1) {
        const imagePath = studentImagePaths[i];
        const imageBase64 = await downloadHomeworkImageAsBase64(supabase, imagePath);
        const recognized = await recognizeHomeworkPhoto(imageBase64, subject, { strict: true });
        const normalizedRecognized = normalizeText(recognized.recognized_text);
        if (normalizedRecognized) {
          recognizedParts.push(normalizedRecognized);
        }
      }

      const recognizedText = recognizedParts.length > 0 ? recognizedParts.join("\n\n") : "[неразборчиво]";
      const checkResult = await checkHomeworkAnswer(
        recognizedText,
        effectiveTaskText,
        task.correct_answer,
        task.solution_steps,
        subject,
        { strict: true, rubricText: task.rubric_text },
      );

      const aiScore = checkResult.score >= 0.5 ? maxScore : 0;
      const formattedFeedback = formatAiFeedback(effectiveTaskText, checkResult.feedback);

      taskResults.push({
        task_id: task.id,
        order_num: task.order_num,
        max_score: maxScore,
        ai_score: aiScore,
        is_correct: checkResult.is_correct,
        confidence: checkResult.confidence,
        feedback: formattedFeedback,
        error_type: checkResult.error_type,
        recognized_text: recognizedText,
      });
    } catch (error) {
      console.error("homework_ai_check_task_error", {
        submission_id: submissionId,
        task_id: task.id,
        order_num: task.order_num,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  for (const result of taskResults) {
    const { error: updateError } = await supabase
      .from("homework_tutor_submission_items")
      .update({
        recognized_text: result.recognized_text,
        ai_is_correct: result.is_correct,
        ai_confidence: result.confidence,
        ai_feedback: result.feedback,
        ai_error_type: result.error_type,
        ai_score: result.ai_score,
      })
      .eq("submission_id", submissionId)
      .eq("task_id", result.task_id);

    if (updateError) {
      throw new Error(`Failed to persist AI result for task ${result.task_id}: ${updateError.message}`);
    }
  }

  const totalScore = taskResults.reduce((sum, task) => sum + task.ai_score, 0);
  const totalMaxScore = taskResults.reduce((sum, task) => sum + task.max_score, 0);

  console.log("homework_ai_check_success", {
    submission_id: submissionId,
    assignment_id: assignment.id,
    total_score: totalScore,
    total_max_score: totalMaxScore,
    task_count: taskResults.length,
  });

  return {
    submission_id: submissionId,
    assignment_id: assignment.id,
    assignment_title: assignment.title,
    subject,
    total_score: totalScore,
    total_max_score: totalMaxScore,
    task_results: taskResults,
  };
}
