

## Plan: Add French & Chemistry to subjects, ensure all Russian labels

### Problem
1. Homework creation dropdown (`/tutor/homework/create`) only has 6 subjects — missing French and Chemistry
2. Student-facing views need all subjects displayed in Russian
3. Some places may show English IDs instead of Russian labels

### Changes

#### 1. `src/lib/tutorHomeworkApi.ts` (line 7)
Expand `HomeworkSubject` type to include `'french'` and `'chemistry'`:
```ts
export type HomeworkSubject = 'math' | 'physics' | 'history' | 'social' | 'english' | 'cs' | 'french' | 'chemistry';
```

#### 2. `src/components/tutor/homework-create/types.ts` (lines 5-17)
Add French and Chemistry to both `SUBJECTS` array and `SUBJECT_LABELS_MAP`:
```ts
export const SUBJECTS = [
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
  { value: 'history', label: 'История' },
  { value: 'social', label: 'Обществознание' },
  { value: 'english', label: 'Английский' },
  { value: 'cs', label: 'Информатика' },
  { value: 'french', label: 'Французский' },
  { value: 'chemistry', label: 'Химия' },
];

export const SUBJECT_LABELS_MAP = {
  math: 'Математика', physics: 'Физика', history: 'История',
  social: 'Обществознание', english: 'Английский', cs: 'Информатика',
  french: 'Французский', chemistry: 'Химия',
};
```

#### 3. `src/types/homework.ts` (lines 1-42)
Add `french` and `chemistry` to the canonical `SUBJECTS` array (which feeds `SUBJECT_NAME_MAP` and `getSubjectLabel`). Also add `french` to `LEGACY_SUBJECT_LABELS` as a fallback. This ensures student-facing pages (`StudentHomework.tsx`, `GuidedHomeworkWorkspace.tsx`) and tutor results pages all show Russian labels for the new subjects.

Add to SUBJECTS array:
```ts
{ id: 'french', name: 'Французский язык', emoji: '🇫🇷', category: 'humanities' },
```
(Chemistry already exists as `{ id: 'chemistry', name: 'Химия', emoji: '🧪', category: 'natural' }`)

Add to LEGACY_SUBJECT_LABELS:
```ts
french: 'Французский язык',
chemistry: 'Химия',
```

This covers all UI touchpoints since `getSubjectLabel()` is the single source of truth used by student list, student workspace header, tutor homework list, and tutor results header.

