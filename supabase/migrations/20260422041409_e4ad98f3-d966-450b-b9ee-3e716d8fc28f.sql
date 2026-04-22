UPDATE kb_tasks
SET attachment_url = REPLACE(attachment_url, '.svg', '.png'),
    updated_at = NOW()
WHERE attachment_url ILIKE '%demidova2025/z1_%.svg%';

UPDATE homework_tutor_tasks
SET task_image_url = REPLACE(task_image_url, '.svg', '.png')
WHERE task_image_url ILIKE '%demidova2025/z1_%.svg%';