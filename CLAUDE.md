# CLAUDE.md

@AGENTS.md

**`AGENTS.md` (imported above) is the canonical source of truth — read it first.** `.claude/rules/*` hold domain depth (index in AGENTS.md). This file adds only Claude-Code-specific notes.

## Claude Code workflow
- Use **plan mode** for any multi-file feature before editing.
- Delegate read-heavy exploration to subagents (`Explore`, `Plan`, `kb-explorer`) — keep the main thread clean. The "grep ALL write-sites" discipline (AGENTS.md → dual write-path) is ideal subagent work.
- **Verify previewable UI before deploy** with `preview_*` tools (`preview_start` → `preview_snapshot`/`screenshot` → `preview_resize` for iOS). We ship Safari/iOS bugs often (rule 80) — catch them here; never ask the user to check manually.
- Enabled plugins/skills: `code-review`, `frontend-design`, `code-simplifier`, `claude-md-management`, `context7`. Project skill: `sokratai-formula-loader` (trainer content).

## Memory
File-based memory at `~/.claude/projects/…/memory/` — one fact per file + `MEMORY.md` index. Prefer memory for cross-session facts over bloating this file; run `consolidate-memory` to dedup.

## After frontend changes
Add the **"🚀 Deploy needed"** block (rule 95) — `sokratai.ru` does NOT auto-update; it needs `deploy-sokratai` on the VPS.

## Where detail lives
- Durable rules → `AGENTS.md` + `.claude/rules/*`.
- Feature history / round-by-round fixes / commit archaeology → `docs/delivery/features/<feature>/` + `~/.claude/plans/`. Not duplicated in always-loaded context.
