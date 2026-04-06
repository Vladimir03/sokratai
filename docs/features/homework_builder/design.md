System components:

Frontend
- TutorHomeworkCreate.tsx
- TutorHomeworkDetail.tsx
- TutorHomeworkResults.tsx
- StudentHomework.tsx
- StudentHomeworkDetail.tsx (guided chat overlay)

Backend
- homework-api edge function

Database
homework_tutor_assignments
homework_tutor_tasks
homework_tutor_student_assignments
homework_tutor_threads
homework_tutor_thread_messages
homework_tutor_task_states
homework_tutor_materials
homework_tutor_templates

Guided chat flow

studentHomeworkApi
- getStudentAssignment
- saveThreadMessage
- checkAnswer
- requestHint
- uploadStudentThreadImage

Supported attachment types

image (jpg, png, heic, webp)
pdf

Storage

bucket: homework-submissions

structure:

homework-submissions/
  studentId/
    assignmentId/
      threads/
        {taskOrder}/
          {fileId}.{ext}

homework_tutor_thread_messages

id
thread_id
role (user | assistant | system)
message_kind (answer | hint | question | system)
task_order
content
image_url (storage:// ref or null)
score
feedback
created_at
