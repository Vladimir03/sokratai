# KB Knowledge Base — Tasks

Spec: docs/kb/kb-tech-spec.md
Design ref: docs/kb/kb-design-ref.jsx

## Task 1: Database migration
Implement BLOCK 3 (3.1 + 3.2) from spec.
Create supabase/migrations/20260312_kb_knowledge_base.sql

## Task 2: RLS policies
Implement BLOCK 5 (5.1–5.3) from spec.
Add to the same migration file.

## Task 3: Seed data
Implement BLOCK 3 (3.4) from spec.
Create supabase/migrations/20260312_kb_seed_physics.sql

## Task 4: TypeScript types
Create src/types/kb.ts with types from BLOCK 3.

## Task 5: Data hooks
Create src/hooks/useKnowledgeBase.ts and src/hooks/useFolders.ts

## Task 6: Design tokens
Implement BLOCK 1 (1.1) — extend tailwind.config.ts

## Task 7: UI primitives
Implement BLOCK 1 (1.2) — components in src/components/kb/ui/

## Task 8: Main page with tabs
Implement BLOCK 2 (2.1, 2.2) — KnowledgeBasePage with tab switcher

## Task 9: Catalog screens
Implement BLOCK 2 (2.3, 2.4) — TopicCard, CatalogTopicPage

## Task 10: Folder system
Implement BLOCK 2 (2.5, 2.6, 2.7) — FolderCard, FolderScreen, CopyToFolderModal

## Task 11: TaskCard + MaterialCard
Implement BLOCK 2 (2.8, 2.9)

## Task 12: Create task modal
Implement BLOCK 2 (2.10)

## Task 13: Global search
Implement BLOCK 4 (4.1–4.3)

## Task 14: HW draft store
Implement BLOCK 6 (6.1, 6.2) — Zustand store with snapshots

**Status:** Zustand store (`hwDraftStore`) реализован для Flow B (KB-страницы → HWDrawer).
Flow A (визард ДЗ) использует локальный React state, а не глобальный store.

## Task 15: HW Drawer
Implement BLOCK 6 (6.3) — with snapshot editing

**Status:** `HWDrawer` (`src/components/kb/HWDrawer.tsx`) реализован для Flow B.
Для Flow A реализован `KBPickerSheet` (`src/components/tutor/KBPickerSheet.tsx`) —
inline Sheet из визарда, другая архитектура (локальный state, batch callback).

## Task 16: HW integration
Implement BLOCK 6 (6.4–6.6) — "В ДЗ" button, save logic

**Status (2026-03-14):** Реализовано через `KBPickerSheet` + `TutorHomeworkCreate.tsx`:
- «В ДЗ» кнопка в `PickerTaskCard` → `onAddTasks` callback
- Конвертер `kbTaskToDraftTask` с полями провенанса (`kb_task_id`, `kb_source`, `kb_snapshot_*`) — живёт в `src/components/tutor/homework-create/HWTasksSection.tsx` (перенесён из `TutorHomeworkCreate.tsx` в Phase 1 рефакторинга, 2026-03-16)
- Post-submit insert в `homework_kb_tasks` с FK retry pattern
- `SourceBadge` + attachment warning badge в TaskEditor
- Snapshot-семантика: финальный текст, не KB-оригинал; `snapshot_edited` для text + answer
- Реализация отличается от спеки: inline Sheet вместо navigate + `?hw=draft`
- См. `docs/features/specs/tutor-kb-picker-drawer.md`