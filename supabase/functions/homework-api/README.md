# homework-api — Edge Function

REST API for managing `homework_tutor_*` entities from the tutor dashboard.

## Base URL

```
https://<project-ref>.supabase.co/functions/v1/homework-api
```

## Authentication

All requests require a valid Supabase JWT in the `Authorization: Bearer <token>` header.
The authenticated user must have a record in the `tutors` table.

## CORS

Allowed origins are configured via `HOMEWORK_API_ALLOWED_ORIGINS` env var (comma-separated).
Fallback allowlist: `https://sokratai.ru`, `https://sokratai.lovable.app`, `http://localhost:8080`, `http://localhost:5173`.

## Error Format

All errors return a consistent JSON structure:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "title is required (non-empty string)",
    "details": null
  }
}
```

HTTP status codes: `400` (bad input), `401` (unauthorized), `403` (forbidden/not owner), `404` (not found), `500` (server error).

---

## Endpoints

### 1. POST /assignments

Create a new homework assignment with tasks.

**Request:**
```json
{
  "title": "Квадратные уравнения",
  "subject": "math",
  "topic": "Алгебра",
  "description": "Решить 5 уравнений",
  "deadline": "2026-03-01T23:59:00Z",
  "tasks": [
    {
      "order_num": 1,
      "task_text": "Решите x^2 - 5x + 6 = 0",
      "correct_answer": "x=2, x=3",
      "max_score": 2
    },
    {
      "task_text": "Решите 2x^2 + 3x - 5 = 0",
      "max_score": 3
    }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Non-empty |
| `subject` | string | yes | `math\|physics\|history\|social\|english\|cs` |
| `topic` | string | no | |
| `description` | string | no | |
| `deadline` | string (ISO) | no | |
| `tasks` | array | yes | Min 1 task |
| `tasks[].order_num` | int | no | Auto-assigned 1..N if omitted |
| `tasks[].task_text` | string | yes | Non-empty |
| `tasks[].task_image_url` | string | no | Рекомендуемый формат: `storage://{bucket}/{objectPath}` |
| `tasks[].correct_answer` | string | no | |
| `tasks[].max_score` | int | no | Default: 1 |

**Response (201):**
```json
{ "assignment_id": "uuid" }
```

---

### 2. GET /assignments?status=draft|active|closed|all

List tutor's assignments with aggregate stats.

**Query params:**
- `status` — filter by status. Default: `all`.

**Response (200):**
```json
[
  {
    "id": "uuid",
    "title": "Квадратные уравнения",
    "subject": "math",
    "topic": "Алгебра",
    "deadline": "2026-03-01T23:59:00Z",
    "status": "active",
    "created_at": "2026-02-16T10:00:00Z",
    "assigned_count": 5,
    "submitted_count": 3,
    "avg_score": 72.5
  }
]
```

| Field | Notes |
|---|---|
| `assigned_count` | Number of students assigned |
| `submitted_count` | Submissions with status `submitted\|ai_checked\|tutor_reviewed` |
| `avg_score` | Average `(total_score/total_max_score)*100`, null if no scores |

---

### 3. GET /assignments/:id

Get full assignment details including tasks, assigned students, and submission summary.

**Response (200):**
```json
{
  "assignment": { "id": "uuid", "title": "...", "subject": "math", "..." : "..." },
  "tasks": [
    { "id": "uuid", "order_num": 1, "task_text": "...", "max_score": 2 }
  ],
  "assigned_students": [
    { "student_id": "uuid", "name": "Иван", "notified": true, "notified_at": "2026-02-16T12:00:00Z" }
  ],
  "submissions_summary": {
    "total": 5,
    "by_status": { "submitted": 2, "ai_checked": 1, "tutor_reviewed": 2 },
    "avg_percent": 75.5
  }
}
```

---

### 4. PUT /assignments/:id

Update assignment metadata and/or replace tasks list.

**Request:**
```json
{
  "title": "Updated title",
  "deadline": "2026-04-01T23:59:00Z",
  "tasks": [
    { "id": "existing-task-uuid", "task_text": "Updated text", "max_score": 3 },
    { "task_text": "New task", "max_score": 1 }
  ]
}
```

**Task update behavior (replace list):**
- If `tasks` is omitted — only assignment metadata is updated.
- If `tasks` is provided and **submissions exist** — only existing tasks can be updated (by `id`). Adding or removing tasks returns `400 DESTRUCTIVE_CHANGE`.
- If `tasks` is provided and **no submissions** — full replace: update existing (by `id`), insert new, delete omitted.

**Response (200):**
```json
{ "ok": true }
```

---

### 5. POST /assignments/:id/assign

Assign students to a homework assignment.

**Request:**
```json
{
  "student_ids": ["uuid-1", "uuid-2"]
}
```

**Behavior:**
- All `student_ids` must belong to the tutor (via `tutor_students` table).
- Students without Telegram linkage are still assigned to homework (site cabinet access remains available).
- Upsert: re-assigning an already assigned student is a no-op.
- Auto-activation: if assignment is `draft`, API forces status to `active` right after successful assign.

**Response (200):**
```json
{
  "added": 2,
  "assignment_status": "active",
  "students_without_telegram": ["uuid-2"],
  "students_without_telegram_names": ["Иван"]
}
```

**Error (403):**
```json
{
  "error": {
    "code": "INVALID_STUDENTS",
    "message": "Some student_ids are not your students",
    "details": { "invalid_student_ids": ["uuid-3"] }
  }
}
```

### 6. POST /assignments/:id/notify

Send Telegram notifications to assigned students who haven't been notified yet.

**Request:**
```json
{
  "message_template": "Custom message text (optional)"
}
```

**Behavior:**
- Only sends to students with `notified=false`.
- Uses `TELEGRAM_BOT_TOKEN` to call Telegram Bot API directly.
- Chat id resolution:
  - primary: `profiles.telegram_user_id`
  - fallback: `telegram_sessions.telegram_user_id` by `user_id`
- After successful send: sets `notified=true`, `notified_at=now()`.
- Idempotent: repeated calls won't re-send to already notified students.
- Failed deliveries are returned as `failed_student_ids` for UI diagnostics.
- Custom `message_template` is sent as plain text (without Markdown parse mode) to avoid parse errors.

**Response (200):**
```json
{
  "sent": 3,
  "failed": 1,
  "failed_student_ids": ["uuid-student-1"],
  "failed_by_reason": {
    "uuid-student-1": "missing_telegram_link"
  }
}
```

---

### 7. GET /assignments/:id/results

Get detailed results and analytics for an assignment.

**Response (200):**
```json
{
  "summary": {
    "avg_score": 72.5,
    "distribution": { "0-24": 1, "25-49": 0, "50-74": 2, "75-100": 3 },
    "common_error_types": [
      { "type": "calculation", "count": 5 },
      { "type": "concept", "count": 2 }
    ]
  },
  "per_student": [
    {
      "student_id": "uuid",
      "name": "Иван",
      "status": "ai_checked",
      "total_score": 7,
      "total_max_score": 10,
      "percent": 70.0,
      "submission_id": "uuid",
      "top_error_types": [{ "type": "calculation", "count": 2 }],
      "submission_items": [
        {
          "task_id": "uuid",
          "task_order_num": 1,
          "task_text": "Решите x² - 5x + 6 = 0",
          "max_score": 2,
          "student_text": "x=2, x=3",
          "student_image_urls": ["homework/uuid/uuid/uuid/file.jpg"],
          "recognized_text": "x=2, x=3",
          "ai_is_correct": true,
          "ai_confidence": 0.95,
          "ai_feedback": "Решение верное",
          "ai_error_type": "correct",
          "ai_score": 2,
          "tutor_override_correct": null,
          "tutor_comment": null
        }
      ]
    }
  ],
  "per_task": [
    {
      "task_id": "uuid",
      "order_num": 1,
      "max_score": 2,
      "avg_score": 1.5,
      "correct_rate": 60.0,
      "error_type_histogram": [{ "type": "calculation", "count": 3 }]
    }
  ]
}
```

---

### 8. POST /submissions/:id/review

Submit tutor review for a student's submission.

**Request:**
```json
{
  "items": [
    {
      "task_id": "uuid",
      "tutor_override_correct": true,
      "tutor_comment": "Хорошая работа",
      "tutor_score": 2
    },
    {
      "task_id": "uuid-2",
      "tutor_override_correct": false,
      "tutor_comment": "Ошибка в знаке",
      "tutor_score": 0
    }
  ],
  "status": "tutor_reviewed"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array | yes | Min 1 item |
| `items[].task_id` | UUID | yes | |
| `items[].tutor_override_correct` | boolean | no | |
| `items[].tutor_comment` | string | no | |
| `items[].tutor_score` | int (>=0) | no | Stored in `ai_score` column |
| `status` | string | no | Default: `tutor_reviewed` |

**Score logic:**
- If `tutor_score` is provided, it's written to `ai_score`.
- If only `tutor_override_correct` is provided (no `tutor_score`), score is auto-calculated: `max_score` if correct, `0` if not.
- Submission `total_score` / `total_max_score` are recalculated from all items.

**Response (200):**
```json
{ "ok": true }
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes | For user auth verification |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | For DB operations (bypasses RLS) |
| `TELEGRAM_BOT_TOKEN` | yes | For sending notifications |
| `HOMEWORK_API_ALLOWED_ORIGINS` | no | Comma-separated CORS origins |

## Observability

Structured logs emitted:
- `homework_api_request_start` — route, method
- `homework_api_request_success` — route, tutor_id, relevant IDs
- `homework_api_request_error` — route, error message

## Tables Used

- `homework_tutor_assignments` — assignment metadata
- `homework_tutor_tasks` — individual tasks within assignments
- `homework_tutor_submissions` — student submissions
- `homework_tutor_submission_items` — per-task submission data + AI/tutor scores
- `homework_tutor_student_assignments` — student-to-assignment links with notification status
- `tutors` — tutor profile lookup
- `tutor_students` — verifying student ownership
- `profiles` — student names
- `telegram_sessions` — Telegram user ID lookup for notifications
