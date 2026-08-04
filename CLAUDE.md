# CLAUDE.md

@AGENTS.md

**`AGENTS.md` (imported above) is the canonical source of truth — read it first.** `.claude/rules/*` hold domain depth (index in AGENTS.md). This file adds only Claude-Code-specific notes.

## Claude Code workflow
- Use **plan mode** for any multi-file feature before editing.
- Delegate read-heavy exploration to subagents (`Explore`, `Plan`, `kb-explorer`) — keep the main thread clean. The "grep ALL write-sites" discipline (AGENTS.md → dual write-path) is ideal subagent work.
- **Verify previewable UI before deploy** with `preview_*` tools (`preview_start` → `preview_snapshot`/`screenshot` → `preview_resize` for iOS). We ship Safari/iOS bugs often (rule 80) — catch them here; never ask the user to check manually.
- Enabled plugins/skills: `code-review`, `frontend-design`, `code-simplifier`, `claude-md-management`, `context7`. Project skill: `sokratai-formula-loader` (trainer content).
- **Независимое ревью — Codex через MCP** (`.mcp.json` → сервер `codex`, инструменты `codex` / `codex-reply`; роль «Codex / review agent» в AGENTS.md). Логин — подписка ChatGPT (`codex login status` → «Logged in using ChatGPT»), API-ключ НЕ нужен. Запускается в `sandbox_mode="read-only"`: ревьюер читает и рассуждает, но не правит — правки делаем сами, осознанно.
  - Из терминала то же самое: `codex exec --sandbox read-only - < prompt.md`, либо `codex review --base <sha>` (⚠️ `--base` НЕ комбинируется с кастомным промптом).
  - **Модель пинится в `~/.codex/config.toml`** (сейчас `gpt-5.6-sol`, effort `high`). Устаревший CLI падает на неизвестной модели ДО чтения диффа — лечится `npm i -g @openai/codex@latest`.
  - ⚠️ **Вердикт ищи в САМОМ конце вывода.** Промпт отражается в лог целиком, поэтому grep по «P0 / APPROVE» ловит твой же текст и создаёт иллюзию находок (обжёгся 2026-08-04).
  - Ревьюер под read-only **не может прогнать тесты** — его выводы проверяй сам. Он бывает прав по сути и неточен в деталях.

## Memory
File-based memory at `~/.claude/projects/…/memory/` — one fact per file + `MEMORY.md` index. Prefer memory for cross-session facts over bloating this file; run `consolidate-memory` to dedup.

## After frontend changes
Add the **"🚀 Deploy needed"** block (rule 95) — `sokratai.ru` does NOT auto-update; it needs `deploy-sokratai` on the VPS.

## Where detail lives
- Durable rules → `AGENTS.md` + `.claude/rules/*`.
- Feature history / round-by-round fixes / commit archaeology → `docs/delivery/features/<feature>/` + `~/.claude/plans/`. Not duplicated in always-loaded context.
