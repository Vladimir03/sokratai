import { createClient } from "npm:@supabase/supabase-js@2";
import {
  checkHomeworkAnswer,
  recognizeHomeworkPhoto,
  type HomeworkAiErrorType,
  type HomeworkSubject,
} from "./vision_checker.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const HOMEWORK_IMAGES_BUCKET = "homework-images";
const HOMEWORK_TASK_IMAGES_BUCKET = "homework-task-images";
const HOMEWORK_TASK_IMAGE_FALLBACK_BUCKET = "chat-images";
const AI_FEEDBACK_TASK_MAX_LEN = 450;
const AI_FEEDBACK_COMMENT_MAX_LEN = 280;
const AI_FEEDBACK_CONDITION_LABEL = "Условие задачи:";
const AI_FEEDBACK_COMMENT_LABEL = "Краткий комментарий:";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for homework handler");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export interface HomeworkTaskRow {
  id: string;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  rubric_text: string | null;
  max_score: number;
}

export interface ReviewContextItem {
  task_id: string;
  order_num: number;
  task_text: string;
  student_text: string | null;
  ai_feedback: string;
  ai_error_type: string;
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

export interface SaveHomeworkPhotoAnswerInput {
  assignmentId: string;
  submissionId: string;
  taskId: string;
  telegramFileId: string;
  telegramBotToken: string;
  studentId: string;
}

export interface SaveHomeworkPhotoAnswerResult {
  image_paths: string[];
  added_path: string;
}

export type HomeworkPhotoSaveErrorCode =
  | "TELEGRAM_GET_FILE_FAILED"
  | "TELEGRAM_DOWNLOAD_FAILED"
  | "HOMEWORK_IMAGE_UPLOAD_FAILED"
  | "SUBMISSION_ITEM_UPDATE_FAILED"
  | "MAX_IMAGES_REACHED"
  | "HOMEWORK_BUCKET_NOT_FOUND";

export class HomeworkPhotoSaveError extends Error {
  code: HomeworkPhotoSaveErrorCode;

  constructor(code: HomeworkPhotoSaveErrorCode, message: string) {
    super(message);
    this.name = "HomeworkPhotoSaveError";
    this.code = code;
  }
}

export function getHomeworkPhotoSaveErrorCode(error: unknown): HomeworkPhotoSaveErrorCode | null {
  if (error instanceof HomeworkPhotoSaveError) {
    return error.code;
  }
  return null;
}

function isHomeworkSubject(value: string): value is HomeworkSubject {
  return value === "math" || value === "physics" || value === "history" || value === "social" || value === "english" || value === "cs";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function extractAiFeedbackComment(feedback: string | null | undefined): string {
  const normalized = normalizeText(feedback);
  if (!normalized) return "";

  const labelIndex = normalized.indexOf(AI_FEEDBACK_COMMENT_LABEL);
  if (labelIndex === -1) {
    return normalized;
  }

  return normalizeText(normalized.slice(labelIndex + AI_FEEDBACK_COMMENT_LABEL.length));
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

function isBucketNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("bucket not found");
}

async function fetchTelegramFilePath(fileId: string, telegramBotToken: string): Promise<string> {
  const response = await fetch(
    `https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Telegram getFile failed with ${response.status}: ${text}`);
  }

  const payload = await response.json();
  const filePath = payload?.result?.file_path;
  if (!payload?.ok || typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Telegram getFile returned invalid payload");
  }

  return filePath;
}

async function downloadTelegramFileBytes(filePath: string, telegramBotToken: string): Promise<Uint8Array> {
  const response = await fetch(`https://api.telegram.org/file/bot${telegramBotToken}/${filePath}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Telegram file download failed with ${response.status}: ${text}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function uploadHomeworkImage(
  bucket: string,
  objectPath: string,
  bytes: Uint8Array,
  studentId: string,
): Promise<void> {
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, bytes, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload homework image: ${uploadError.message}`);
  }

  const { error: ownerError } = await supabase
    .schema("storage")
    .from("objects")
    .update({ owner: studentId })
    .eq("bucket_id", bucket)
    .eq("name", objectPath);

  if (ownerError) {
    console.warn("homework_photo_owner_update_failed", {
      bucket,
      object_path: objectPath,
      student_id: studentId,
      error: ownerError.message,
    });
  }
}

export function buildHomeworkStoragePath(assignmentId: string, submissionId: string, taskId: string): string {
  return `homework/${assignmentId}/${submissionId}/${taskId}/${crypto.randomUUID()}.jpg`;
}

export async function ensureSubmissionItemsForTasks(submissionId: string, taskIds: string[]): Promise<void> {
  const uniqueTaskIds = [...new Set(taskIds.filter((taskId) => typeof taskId === "string" && taskId.length > 0))];
  if (uniqueTaskIds.length === 0) {
    return;
  }

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

export async function saveHomeworkTextAnswer(
  submissionId: string,
  taskId: string,
  text: string,
): Promise<void> {
  const value = normalizeText(text);

  const { error } = await supabase
    .from("homework_tutor_submission_items")
    .upsert(
      {
        submission_id: submissionId,
        task_id: taskId,
        student_text: value || null,
      },
      { onConflict: "submission_id,task_id" },
    );

  if (error) {
    throw new Error(`Failed to save homework text answer: ${error.message}`);
  }
}

export async function saveHomeworkPhotoAnswer(
  input: SaveHomeworkPhotoAnswerInput,
): Promise<SaveHomeworkPhotoAnswerResult> {
  const { assignmentId, submissionId, taskId, telegramFileId, telegramBotToken, studentId } = input;
  console.log("homework_photo_save_start", { assignmentId, submissionId, taskId, studentId });

  try {
    if (!telegramBotToken) {
      throw new HomeworkPhotoSaveError(
        "TELEGRAM_GET_FILE_FAILED",
        "Missing telegram bot token for homework photo upload",
      );
    }

    await ensureSubmissionItemsForTasks(submissionId, [taskId]);

    const { data: existingItem, error: itemError } = await supabase
      .from("homework_tutor_submission_items")
      .select("student_image_urls")
      .eq("submission_id", submissionId)
      .eq("task_id", taskId)
      .maybeSingle();

    if (itemError) {
      throw new HomeworkPhotoSaveError(
        "SUBMISSION_ITEM_UPDATE_FAILED",
        `Failed to load submission item before photo upload: ${itemError.message}`,
      );
    }

    const existingPaths = Array.isArray(existingItem?.student_image_urls)
      ? existingItem.student_image_urls.filter((v): v is string => typeof v === "string")
      : [];

    if (existingPaths.length >= 4) {
      throw new HomeworkPhotoSaveError("MAX_IMAGES_REACHED", "MAX_IMAGES_REACHED");
    }

    let filePath: string;
    try {
      filePath = await fetchTelegramFilePath(telegramFileId, telegramBotToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HomeworkPhotoSaveError("TELEGRAM_GET_FILE_FAILED", message);
    }

    let bytes: Uint8Array;
    try {
      bytes = await downloadTelegramFileBytes(filePath, telegramBotToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HomeworkPhotoSaveError("TELEGRAM_DOWNLOAD_FAILED", message);
    }

    const objectPath = buildHomeworkStoragePath(assignmentId, submissionId, taskId);

    try {
      await uploadHomeworkImage(HOMEWORK_IMAGES_BUCKET, objectPath, bytes, studentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code: HomeworkPhotoSaveErrorCode = isBucketNotFoundMessage(message)
        ? "HOMEWORK_BUCKET_NOT_FOUND"
        : "HOMEWORK_IMAGE_UPLOAD_FAILED";
      throw new HomeworkPhotoSaveError(code, message);
    }

    const nextPaths = [...existingPaths, objectPath];
    const { error: updateError } = await supabase
      .from("homework_tutor_submission_items")
      .update({ student_image_urls: nextPaths })
      .eq("submission_id", submissionId)
      .eq("task_id", taskId);

    if (updateError) {
      throw new HomeworkPhotoSaveError(
        "SUBMISSION_ITEM_UPDATE_FAILED",
        `Failed to update submission item with uploaded image: ${updateError.message}`,
      );
    }

    console.log("homework_photo_save_success", {
      assignmentId,
      submissionId,
      taskId,
      studentId,
      images_count: nextPaths.length,
    });

    return {
      image_paths: nextPaths,
      added_path: objectPath,
    };
  } catch (error) {
    console.error("homework_photo_save_error", {
      assignment_id: assignmentId,
      submission_id: submissionId,
      task_id: taskId,
      student_id: studentId,
      error_code: getHomeworkPhotoSaveErrorCode(error),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function downloadHomeworkImageAsBase64(objectPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(HOMEWORK_IMAGES_BUCKET).download(objectPath);
  if (error || !data) {
    throw new Error(`Failed to download homework image from storage: ${error?.message ?? "unknown error"}`);
  }

  const buffer = await data.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

async function downloadTaskImageAsBase64(taskImageRef: string): Promise<string> {
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

function resolveTaskMaxScore(maxScore: number): number {
  if (!Number.isFinite(maxScore)) return 1;
  const rounded = Math.round(maxScore);
  return rounded < 0 ? 0 : rounded;
}

export async function runHomeworkAiCheck(submissionId: string): Promise<HomeworkAiCheckSummary> {
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
    .select("id, order_num, task_text, task_image_url, correct_answer, rubric_text, max_score")
    .eq("assignment_id", assignment.id)
    .order("order_num", { ascending: true });

  if (tasksError) {
    throw new Error(`Failed to load homework tasks for AI check: ${tasksError.message}`);
  }

  const typedTasks = (tasks ?? []) as HomeworkTaskRow[];
  if (typedTasks.length === 0) {
    throw new Error("Cannot run AI check: assignment has no tasks");
  }

  await ensureSubmissionItemsForTasks(submissionId, typedTasks.map((task) => task.id));

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
          const taskImageBase64 = await downloadTaskImageAsBase64(task.task_image_url);
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
        const reason = !hasTaskText
          ? "empty_task_text"
          : "no_student_answer";
        console.log("homework_ai_context_insufficient", {
          submission_id: submissionId,
          task_id: task.id,
          order_num: task.order_num,
          reason,
          has_task_text: hasTaskText,
          has_student_text: hasStudentText,
          has_student_images: hasStudentImages,
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
        const imageBase64 = await downloadHomeworkImageAsBase64(imagePath);
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

export async function createSubmissionForAttempt(
  assignmentId: string,
  studentId: string,
  telegramChatId: number,
): Promise<{ submissionId: string }> {
  const { data, error } = await supabase
    .from("homework_tutor_submissions")
    .insert({
      assignment_id: assignmentId,
      student_id: studentId,
      telegram_chat_id: telegramChatId,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create submission: ${error?.message ?? "unknown"}`);
  }

  return { submissionId: data.id };
}

// ─── Feature 6: Socratic dialog ──────────────────────────────────────────────

export async function loadSubmissionItemsWithErrors(
  submissionId: string,
): Promise<ReviewContextItem[]> {
  const { data, error } = await supabase
    .from("homework_tutor_submission_items")
    .select("task_id, student_text, ai_feedback, ai_error_type, ai_is_correct, homework_tutor_tasks!inner(order_num, task_text)")
    .eq("submission_id", submissionId)
    .eq("ai_is_correct", false);

  if (error) {
    throw new Error(`Failed to load submission items for review: ${error.message}`);
  }

  return ((data ?? []) as unknown as Array<{
    task_id: string;
    student_text: string | null;
    ai_feedback: string | null;
    ai_error_type: string | null;
    homework_tutor_tasks: { order_num: number; task_text: string };
  }>)
    .map((row) => ({
      task_id: row.task_id,
      order_num: row.homework_tutor_tasks.order_num,
      task_text: shortenText(normalizeText(row.homework_tutor_tasks.task_text), 500),
      student_text: row.student_text ? shortenText(normalizeText(row.student_text), 500) : null,
      ai_feedback: shortenText(extractAiFeedbackComment(row.ai_feedback ?? ""), 300),
      ai_error_type: row.ai_error_type ?? "incomplete",
    }))
    .sort((a, b) => a.order_num - b.order_num);
}

export async function generateSocraticQuestion(
  item: ReviewContextItem,
  exchangeCount: number,
  subject: string,
): Promise<string> {
  const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
  const LOVABLE_MODEL = "google/gemini-3-flash-preview";
  const apiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!apiKey) {
    return "Подумай ещё раз над своим решением. В чём именно может быть ошибка?";
  }

  const isLastExchange = exchangeCount >= 4;
  const systemPrompt = [
    "Ты Сократический наставник. Помогаешь ученику самостоятельно найти ошибку в решении.",
    "НЕЛЬЗЯ давать правильный ответ или решение. Только задавай направляющие вопросы.",
    "Один вопрос за раз, короткий (1-2 предложения).",
    isLastExchange ? "Это последний вопрос в диалоге — заверши разбор и пригласи пересдать." : "",
  ].filter(Boolean).join("\n");

  const userPrompt = [
    `Предмет: ${subject}`,
    `Задача: ${item.task_text}`,
    `Ответ ученика: ${item.student_text ?? "[нет текста]"}`,
    `AI-фидбек о ошибке: ${item.ai_feedback}`,
    `Тип ошибки: ${item.ai_error_type}`,
    `Обмен ${exchangeCount + 1} из 5.`,
    "Задай один направляющий вопрос без раскрытия ответа.",
  ].join("\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(LOVABLE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.6,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return "Подумай ещё раз — в каком шаге решения могла закрасться ошибка?";
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
  } catch {
    // fallback below
  } finally {
    clearTimeout(timeoutId);
  }

  return "Подумай ещё раз — в каком шаге решения могла закрасться ошибка?";
}

// ─── Feature 7: PDF document answer ──────────────────────────────────────────

export interface SaveHomeworkDocumentAnswerInput {
  assignmentId: string;
  submissionId: string;
  taskId: string;
  telegramFileId: string;
  telegramBotToken: string;
  studentId: string;
  mimeType: string;
}

export async function saveHomeworkDocumentAnswer(
  input: SaveHomeworkDocumentAnswerInput,
): Promise<SaveHomeworkPhotoAnswerResult> {
  const { assignmentId, submissionId, taskId, telegramFileId, telegramBotToken, studentId, mimeType } = input;
  console.log("homework_document_save_start", { assignmentId, submissionId, taskId, studentId, mimeType });

  try {
    await ensureSubmissionItemsForTasks(submissionId, [taskId]);

    const { data: existingItem, error: itemError } = await supabase
      .from("homework_tutor_submission_items")
      .select("student_image_urls")
      .eq("submission_id", submissionId)
      .eq("task_id", taskId)
      .maybeSingle();

    if (itemError) {
      throw new HomeworkPhotoSaveError(
        "SUBMISSION_ITEM_UPDATE_FAILED",
        `Failed to load submission item before document upload: ${itemError.message}`,
      );
    }

    const existingPaths = Array.isArray(existingItem?.student_image_urls)
      ? existingItem.student_image_urls.filter((v): v is string => typeof v === "string")
      : [];

    if (existingPaths.length >= 4) {
      throw new HomeworkPhotoSaveError("MAX_IMAGES_REACHED", "MAX_IMAGES_REACHED");
    }

    let filePath: string;
    try {
      filePath = await fetchTelegramFilePath(telegramFileId, telegramBotToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HomeworkPhotoSaveError("TELEGRAM_GET_FILE_FAILED", message);
    }

    let bytes: Uint8Array;
    try {
      bytes = await downloadTelegramFileBytes(filePath, telegramBotToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HomeworkPhotoSaveError("TELEGRAM_DOWNLOAD_FAILED", message);
    }

    // Determine file extension from mimeType
    let ext = "bin";
    if (mimeType === "application/pdf") ext = "pdf";
    else if (mimeType === "image/jpeg") ext = "jpg";
    else if (mimeType === "image/png") ext = "png";

    const objectPath = `homework/${assignmentId}/${submissionId}/${taskId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(HOMEWORK_IMAGES_BUCKET)
      .upload(objectPath, bytes, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      const code: HomeworkPhotoSaveErrorCode = isBucketNotFoundMessage(uploadError.message)
        ? "HOMEWORK_BUCKET_NOT_FOUND"
        : "HOMEWORK_IMAGE_UPLOAD_FAILED";
      throw new HomeworkPhotoSaveError(code, uploadError.message);
    }

    const nextPaths = [...existingPaths, objectPath];
    const { error: updateError } = await supabase
      .from("homework_tutor_submission_items")
      .update({ student_image_urls: nextPaths })
      .eq("submission_id", submissionId)
      .eq("task_id", taskId);

    if (updateError) {
      throw new HomeworkPhotoSaveError(
        "SUBMISSION_ITEM_UPDATE_FAILED",
        `Failed to update submission item with document: ${updateError.message}`,
      );
    }

    console.log("homework_document_save_success", {
      assignmentId, submissionId, taskId, studentId, files_count: nextPaths.length,
    });

    return { image_paths: nextPaths, added_path: objectPath };
  } catch (error) {
    console.error("homework_document_save_error", {
      assignment_id: assignmentId, submission_id: submissionId, task_id: taskId,
      student_id: studentId, mimeType,
      error_code: getHomeworkPhotoSaveErrorCode(error),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function formatHomeworkResultsMessage(summary: HomeworkAiCheckSummary): string {
  const sortedTasks = [...summary.task_results].sort((a, b) => a.order_num - b.order_num);
  const lines: string[] = [];

  lines.push("📊 <b>Проверка домашки завершена</b>");
  lines.push(`📚 <b>${escapeHtml(summary.assignment_title)}</b>`);
  lines.push(`Итого: <b>${summary.total_score}/${summary.total_max_score}</b>`);
  lines.push("");

  for (const task of sortedTasks) {
    const marker = task.is_correct ? "✅" : "❌";
    lines.push(`${marker} Задача ${task.order_num}: <b>${task.ai_score}/${task.max_score}</b>`);

    const safeFeedback = escapeHtml(normalizeText(task.feedback));
    if (safeFeedback) {
      lines.push(safeFeedback);
    }
    lines.push("");
  }

  lines.push("Нажми кнопку ниже, чтобы перейти в режим разбора ошибок.");
  return lines.join("\n").trim();
}
