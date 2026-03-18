

## Problem

Two bugs:

1. **`topic_id` and `subtopic_id` are never saved** — `EditTaskModal.handleSave` builds the `UpdateKBTaskInput` object but never includes `topic_id` or `subtopic_id`. The type `UpdateKBTaskInput` also lacks these fields.

2. **Moderator tasks in "сократ" folder don't auto-publish to catalog** — The DB trigger `trg_fn_kb_after_update_moderation` already handles this: when a task in a "сократ" folder tree gets a `topic_id` set (and belongs to a moderator), it calls `kb_publish_task`. So fixing bug #1 will automatically fix bug #2 — no additional code needed.

## Plan

### 1. Add `topic_id` and `subtopic_id` to `UpdateKBTaskInput` (src/types/kb.ts)

Add two optional fields to the interface:
```ts
topic_id?: string | null;
subtopic_id?: string | null;
```

### 2. Include `topic_id` and `subtopic_id` in save payload (src/components/kb/EditTaskModal.tsx)

In `handleSave`, add these two fields to the `input` object (around line 147):
```ts
topic_id: topicId || null,
subtopic_id: subtopicId || null,
```

That's it — two small edits. The existing DB triggers handle catalog publication automatically when a moderator's task in the "сократ" folder tree gets a `topic_id` assigned.

