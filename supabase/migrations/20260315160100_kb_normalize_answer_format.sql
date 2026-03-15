-- Normalize answer_format from Russian literals to English codes
UPDATE kb_tasks SET answer_format = 'number'   WHERE answer_format = 'число';
UPDATE kb_tasks SET answer_format = 'text'     WHERE answer_format = 'выражение';
UPDATE kb_tasks SET answer_format = 'choice'   WHERE answer_format = 'выбор';
UPDATE kb_tasks SET answer_format = 'matching' WHERE answer_format = 'соответствие';
UPDATE kb_tasks SET answer_format = 'detailed' WHERE answer_format = 'развернутое решение';
