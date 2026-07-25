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

cd "$REPO"
git pull --ff-only

[ -f "$BODY" ] || { echo "❌ нет $REPO/$BODY — деплой остановлен" >&2; exit 1; }

# Синтаксис-гейт: битый скрипт не должен добраться до прода.
bash -n "$BODY" || { echo "❌ синтаксическая ошибка в $BODY — деплой остановлен" >&2; exit 1; }

exec bash "$BODY" "$@"
