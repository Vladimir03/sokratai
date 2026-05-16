# Mock Exams v1 — ChatGPT-5.5 Code Review Fixes (TASK-15)

**Created:** 2026-05-14
**Status:** ✅ Landed (commit `c98c391`)
**Trigger:** ChatGPT-5.5 static code review после TASK-10..14. 5 findings: 2 P1 + 3 P2.

## 0. Job Context

- **Jobs:** R4 (репетитор видит корректные данные) + S2 (ученик решает в стабильных условиях)
- **Wedge alignment:** перед расширением пилота на 5+ репетиторов нужна defensive concurrency + anti-leak hardening + mobile-safe rendering. Review-driven cleanup.

## 1. Problem

ChatGPT-5.5 (static inspection, без runtime tests) обнаружил 5 P1/P2 issues в student-side flow:

**P1 #1 — Bulk upload lost-update race**: `handleUploadPhoto` для `kind='part2_bulk'` делал `SELECT` → append в JS → `UPDATE` без CAS guard. Два concurrent upload'а могли overwrite друг друга — потеря фото.

**P1 #2 — Anti-leak boundary weakness**: `handleGetResult` грузил `solution_text` для **всех** post-submit attempts в process memory, потом гейтил по `isApproved` при сериализации. Wire leak нет, но defense-in-depth pattern violated (CLAUDE.md §15 «поля отсутствуют в памяти процесса до approval»).

**P2 #3 — KIM 14 table mobile**: `<table w-full border-collapse>` без overflow-x wrapper. 2-row × 11-col t/q table сжимается на iPhone X вместо horizontal scroll.

**P2 #4 — PDF accept mismatch**: bulk upload `<input accept="image/*,.pdf">`, backend `ALLOWED_PHOTO_MIME` rejects PDF. False UI affordance.

**P2 #5 — Bulk photos missing on result**: result page возвращал только `mock_exam_attempt_part2_solutions.photo_url` (per-KIM legacy slots). После Phase 5 «9 → 1 bulk» actual photos в `attempts.part2_bulk_photo_urls` — на result page ученик не видел что он загрузил.

## 2. Solution

### 2.1 CAS retry для bulk upload (P1 #1)

**File:** [supabase/functions/mock-exam-student-api/index.ts](supabase/functions/mock-exam-student-api/index.ts)

Pattern:
```ts
const MAX_CAS_RETRIES = 3;
for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
  const { data: cur } = await db.from(...).select("part2_bulk_photo_urls")...;
  const rawCurrent = cur?.part2_bulk_photo_urls ?? null;
  const existing = parseBulkDualFormat(rawCurrent);
  if (existing.length >= MAX_PART2_BULK_PHOTOS) { rollback + 409; break; }
  const next = [...existing, ref];
  const serialized = next.length === 1 ? next[0] : JSON.stringify(next);
  // CAS: UPDATE WHERE part2_bulk_photo_urls IS [rawCurrent]
  const casQuery = rawCurrent === null
    ? updateQuery.is("part2_bulk_photo_urls", null)
    : updateQuery.eq("part2_bulk_photo_urls", rawCurrent);
  const { data: updated } = await casQuery.select("id");
  if (updated && updated.length > 0) { success = true; break; }
  // 0 rows → race → retry
}
if (!success) {
  await db.storage.from(bucket).remove([path]).catch(() => null);  // rollback orphan
  return 500;
}
```

Invariant: storage rollback на final failure предотвращает orphaned blob'ы.

### 2.2 State-aware task SELECT (P1 #2)

**File:** [supabase/functions/mock-exam-student-api/index.ts](supabase/functions/mock-exam-student-api/index.ts) — `handleGetResult`

Перед SELECT — compute `isApproved`/`isManualEntered`/`isPostSubmit`. SELECT теперь:
```ts
const taskSelect = isApproved
  ? "kim_number, part, order_num, task_text, task_image_url, " +
    "correct_answer, check_mode, max_score, solution_text, topic"
  : "kim_number, part, correct_answer, check_mode, max_score";
```

Pre-approval `solution_text` / `task_text` / `topic` **не загружаются в process memory** — defense-in-depth. Если кто-то добавит новое поле в response shape, pre-approval серилизация невозможна — нечего сериализовать.

### 2.3 Markdown table mobile wrapper (P2 #3)

**File:** [src/components/student/mock-exam/MarkdownTaskText.tsx](src/components/student/mock-exam/MarkdownTaskText.tsx)

`tableComponents.table`:
```tsx
<div className="my-3 -mx-2 overflow-x-auto touch-pan-x px-2 sm:mx-0 sm:px-0">
  <table className="min-w-max border-collapse overflow-hidden rounded-md border border-slate-200 text-sm">
    {children}
  </table>
</div>
```

Доп. `whitespace-nowrap` на `<th>` и `<td>` чтобы ячейки не сжимались. `touch-pan-x` критичен для iOS Safari (см. `.claude/rules/80-cross-browser.md`).

### 2.4 Bulk upload accept invariant (P2 #4)

**File:** [src/pages/student/StudentMockExam.tsx](src/pages/student/StudentMockExam.tsx)

`<input accept="image/*">` — drop `.pdf`. Matches backend `ALLOWED_PHOTO_MIME` exactly.

При расширении на PDF (Phase 3+): расширить `ALLOWED_PHOTO_MIME` server-side + добавить inline-конвертацию для AI grader + UI accept.

### 2.5 Bulk photos на result page (P2 #5)

**Backend** `handleGetResult` ([mock-exam-student-api/index.ts](supabase/functions/mock-exam-student-api/index.ts)):
- `SELECT_COLS += part2_bulk_photo_urls`
- Resolve dual-format → signed URL array
- Return `attempt.part2_bulk_photo_urls: string[]`

**Frontend types** [studentMockExamApi.ts](src/lib/studentMockExamApi.ts): добавить `part2_bulk_photo_urls: string[]` в `StudentMockExamResultView.attempt`.

**Frontend render** [StudentMockExamResult.tsx](src/pages/student/StudentMockExamResult.tsx): новый компонент `Part2BulkPhotosGallery`:
- Collapsible `<details>` (touch-manipulation summary)
- Header: «Загруженные фото решений Части 2» + counter chip
- Grid 2-4 cols thumbnails (aspect-square, object-cover)
- Click thumbnail → open signed URL in new tab
- Number badge bottom-right per photo
- Rendered для **pending** (collapsed by default — ученик уже знает что загрузил) и **approved** (expanded — связано с Часть 2 review cards)

## 3. Acceptance Criteria

- **AC-T15-1 (CAS race)**: 5 concurrent bulk uploads с одного клиента (DevTools rapid trigger) → все 5 refs persist'ятся в `attempts.part2_bulk_photo_urls`. Никаких lost writes. CAS retry logs visible в edge function logs (`mock_exam_bulk_cas_retry`).
- **AC-T15-2 (CAS rollback)**: при искусственном persistence failure storage object очищается (no orphan).
- **AC-T15-3 (Anti-leak hardening)**: SQL `EXPLAIN` или edge function logs показывают что `handleGetResult` для `status='submitted'` НЕ запрашивает `solution_text` / `task_text` / `topic` columns. Pre-approval response shape не содержит этих полей.
- **AC-T15-4 (Mobile table)**: iPhone X DevTools (390×844) — KIM 14 page показывает таблицу t/q с horizontal scroll, не сжимается под viewport.
- **AC-T15-5 (PDF accept)**: bulk upload `<input>` в DOM — `accept="image/*"`. На mobile file picker не показывает PDF.
- **AC-T15-6 (Bulk photos result)**:
  - Pending state (`submitted`/`ai_checking`/`awaiting_review`): collapsible card «Загруженные фото решений Части 2» виден (collapsed).
  - Approved state: тот же компонент рендерится expanded, под итоговым «Часть 2 проверено».
  - Click thumbnail → signed URL в new tab.

## 4. Out of scope (deferred)

- `topic` removal из taking endpoint payload (Open Question от ChatGPT) — minor leak, AC-P5 ограничен taking page. Defer to next sprint если решим harden.
- Fallback Part 1 upload formal deprecation — UI uploader убран в TASK-13, backend route остался + tutor видит файл в review. Решение: либо restore student-side fallback uploader, либо deprecate route + cleanup.
- `solution_text` / `topic` теперь в render-cycle если `isApproved` → анализ что в reality post-approval shows на странице (не sensitive — value-proposition).

## 5. Files (landed)

| File | Type | Change |
|---|---|---|
| `supabase/functions/mock-exam-student-api/index.ts` | MODIFY | CAS retry для bulk upload + state-aware task SELECT |
| `src/components/student/mock-exam/MarkdownTaskText.tsx` | MODIFY | overflow-x-auto wrapper + whitespace-nowrap |
| `src/pages/student/StudentMockExam.tsx` | MODIFY | bulk upload `accept="image/*"` |
| `src/lib/studentMockExamApi.ts` | MODIFY | `part2_bulk_photo_urls: string[]` в Result type |
| `src/pages/student/StudentMockExamResult.tsx` | MODIFY | `Part2BulkPhotosGallery` компонент + mount |
| `docs/delivery/features/mock-exams-v1-pilot-polish/review-fixes-spec.md` | NEW | этот документ |

## 6. Verification

1. `npx tsc --noEmit` ✅ clean
2. `npm run build` ✅ 47s
3. `npm run smoke-check` ✅ all assertions OK
4. Lovable Cloud auto-redeploys edge functions + frontend ~1-2 мин после push
5. Production deploy: `deploy-sokratai`

## 7. Rollback

- Frontend: `git revert <hash> && deploy-sokratai` (~3 мин)
- Backend edge functions: Lovable Studio → rollback prior deployment
- Никаких миграций — schema unchanged
