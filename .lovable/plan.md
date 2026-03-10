

## Problem

`getStudentSubmissions()` (line 288) orders by `created_at`, but the `homework_tutor_submissions` table has no `created_at` column — only `submitted_at`. This causes a database error when opening any individual homework assignment, showing "Не удалось загрузить задание".

This is the same bug pattern fixed earlier in `listStudentAssignments` but missed in `getStudentSubmissions`.

## Fix

**File**: `src/lib/studentHomeworkApi.ts`, line 288

Change `.order('created_at', { ascending: false })` → `.order('submitted_at', { ascending: false })`

One-line fix. No other changes needed.

