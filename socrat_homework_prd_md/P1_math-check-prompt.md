## P1 MATH_CHECK_PROMPT
**Цель**: единый строгий JSON‑ответ для проверки математика/физика.

### Требования
- Вход: `task_text`, `correct_answer`, `recognized_text`, опционально `solution_steps`, `max_score`.
- Выход: **только JSON**.
- `feedback_student`: без готового решения, только намёк.

### JSON schema
```json
{
  "is_correct": true,
  "confidence": 0.0,
  "score": 0,
  "error_type": "correct|calculation|concept|formatting|incomplete",
  "feedback_student": "...",
  "feedback_tutor": "...",
  "error_step": "..."
}
```

### Guardrails
- Запрет на выдачу полного решения.
- Если `recognized_text` содержит `[неразборчиво]` → снижать confidence.

---
