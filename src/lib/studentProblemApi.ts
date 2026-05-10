import { requestStudentHomeworkApi } from '@/lib/studentHomeworkApi';
import type {
  CheckAnswerResponse,
  HomeworkThread,
  StudentAssignmentStatus,
} from '@/types/homework';

// ─── Types ──────────────────────────────────────────────────────────────────
//
// Wire-format types for the Phase 1 student-side problem screen endpoints.
// Spec: docs/delivery/features/student-homework-problem-screen/spec.md §5.

export interface StudentProblemAssignment {
  id: string;
  title: string;
  subject: string;
  deadline: string | null;
  status: StudentAssignmentStatus;
}

/**
 * Single-task shape returned by `GET /student/problem/:hwId/:taskId`.
 * Whitelisted, anti-leak (no `solution_text` / `rubric_*`). Mirrors the
 * server-side SELECT in `homework-api/index.ts::handleGetStudentProblem`.
 */
export interface StudentProblemTask {
  id: string;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  max_score: number;
  check_format: 'short_answer' | 'detailed_solution';
  task_kind: 'numeric' | 'extended' | 'proof';
}

export interface StudentProblemStudent {
  id: string;
  display_name: string | null;
}

export interface StudentProblemResponse {
  assignment: StudentProblemAssignment;
  task: StudentProblemTask;
  /** Total number of tasks in the assignment — drives step indicator. */
  task_total: number;
  /** Computed final_score for this task (override > earned > ai > status). */
  task_score: number;
  /** Hydrated thread for the assignment (with task_states + messages). */
  thread: HomeworkThread | null;
  student: StudentProblemStudent;
  /** task_state.hint_count for the target task. */
  hints_used: number;
}

/**
 * Body of `POST /student/problem/:hwId/:taskId/submission`.
 *
 * `task_kind` drives required-field semantics:
 *   - `numeric`   → `numeric` required, `photos`/`text` optional
 *   - `extended`  → `numeric` + `photos[≥1]` required (default)
 *   - `proof`     → `photos[≥1]` required, `numeric` ignored
 *
 * Backend synthesises `answer = "Числовой ответ: ${numeric}\n${text}"` and
 * routes through the existing `handleCheckAnswer` pipeline.
 */
export interface SubmitSolutionPayload {
  /** Canonical "1.4" or "1,4" — backend normalises locale-specific commas. */
  numeric: string;
  /** `storage://...` refs after upload via `uploadStudentThreadImage`. */
  photos: string[];
  /** Optional reasoning. Empty string is acceptable. */
  text: string;
}

// ─── API ────────────────────────────────────────────────────────────────────

export async function getStudentProblem(
  hwId: string,
  taskId: string,
): Promise<StudentProblemResponse> {
  return requestStudentHomeworkApi<StudentProblemResponse>(
    `/student/problem/${encodeURIComponent(hwId)}/${encodeURIComponent(taskId)}`,
  );
}

/**
 * Submit a single-shot solution. Returns the canonical
 * `CheckAnswerResponse` shape so the verdict overlay can reuse the existing
 * verdict-handling code paths from chat-side `checkAnswer`.
 */
export async function submitSolution(
  hwId: string,
  taskId: string,
  payload: SubmitSolutionPayload,
): Promise<CheckAnswerResponse> {
  return requestStudentHomeworkApi<CheckAnswerResponse>(
    `/student/problem/${encodeURIComponent(hwId)}/${encodeURIComponent(taskId)}/submission`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}
