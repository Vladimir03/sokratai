System components:

Frontend
- TutorHomeworkCreate.tsx
- TutorHomeworkDetail.tsx
- StudentHomeworkList.tsx
- StudentHomeworkPage.tsx

Backend
- homework-api edge function

Database
homework_tutor_assignments
homework_tutor_tasks
homework_tutor_student_assignments
homework_tutor_submissions
homework_tutor_submission_items

Submission flow

studentHomeworkApi
createAttempt
submitAnswer
finalizeAttempt

Supported answer types

text
image
pdf

Storage

bucket: homework-submissions

structure:

homework-submissions/
studentId/
assignmentId/
submissionId/
taskId/
file

homework_tutor_submission_items

id
submission_id
task_id
answer_type
answer_text
file_url
ai_score
tutor_score
feedback