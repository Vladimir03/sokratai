#!/usr/bin/env bash
#
# Тонкий стаб для /usr/local/bin/deploy-sokratai.
#
# Тело деплоя живёт В РЕПО: /opt/sokratai/scripts/deploy/deploy.sh — так оно
# ревьюится, диффится и откатывается вместе с кодом, который от него зависит.
# Стаб решает проблему «курица-яйцо» (git pull внутри скрипта, который сам
# обновляется): он делает pull и передаёт управление свежему телу через exec.
#
# СЛЕДСТВИЕ: после разовой установки правка логики деплоя НЕ требует ops-шага —
# следующий запуск `deploy-sokratai` сам подтянет новое тело из main.
# Переустанавливать стаб нужно только если менялся ОН САМ (что бывает ~никогда).
#
# Установка (разово, из-под root на VPS):
#   cd /opt/sokratai && git pull --ff-only
#   install -m 0755 scripts/deploy/deploy-sokratai.stub.sh /usr/local/bin/deploy-sokratai
#
set -euo pipefail

REPO=/opt/sokratai
BODY=scripts/deploy/deploy.sh
BRANCH=main
LOCKFILE=/var/lock/deploy-sokratai.lock

die() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

# ─── Lock БЕРЁТСЯ ДО git pull (ревью 5.6 P1) ────────────────────────────────
# Раньше lock брался только в теле, ПОСЛЕ pull'а стаба. Второй запуск успевал
# сделать `git pull` while первый был в середине `npm ci`/build → рабочее дерево
# менялось под сборкой, и в прод мог уехать смешанный bundle, помеченный старым
# SHA. FD 9 наследуется через exec, тело его НЕ переоткрывает (иначе потеряет
# блокировку) — см. DEPLOY_LOCK_HELD.
exec 9>"$LOCKFILE"
flock -n 9 || die "деплой уже идёт (lock $LOCKFILE занят)"
export DEPLOY_LOCK_HELD=1

cd "$REPO"

# ─── Деплой только с чистого main (ревью 5.6 P1) ────────────────────────────
# `git pull --ff-only` запрещает не-fast-forward merge, но НЕ проверяет ни имя
# ветки, ни чистоту дерева. Если на VPS осталась feature-ветка с upstream или
# локальные правки — pull успешно завершится, и в прод уедет feature/dirty-код,
# а лог сообщит только SHA.
current_branch=$(git rev-parse --abbrev-ref HEAD)
[ "$current_branch" = "$BRANCH" ] || die "HEAD на «$current_branch», а не «$BRANCH» — деплой остановлен (проверь, что оставили на VPS)"

dirty=$(git status --porcelain --untracked-files=no)
if [ -n "$dirty" ]; then
  printf '\nЛокальные изменения в %s:\n%s\n' "$REPO" "$dirty" >&2
  die "рабочее дерево не чистое — деплой остановлен"
fi

git pull --ff-only origin "$BRANCH"
# Тело не должно тянуть повторно (и не должно переоткрывать lock).
export DEPLOY_PULLED=1

[ -f "$BODY" ] || die "нет $REPO/$BODY — деплой остановлен"

# Синтаксис-гейт: битый скрипт не должен добраться до прода.
bash -n "$BODY" || die "синтаксическая ошибка в $BODY — деплой остановлен"

exec bash "$BODY" "$@"
