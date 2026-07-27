#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "supabase", "config.toml");
const functionsDir = path.join(root, "supabase", "functions");
const workflowPath = path.join(root, ".github", "workflows", "deploy-supabase-functions.yml");

// Функции, которые деплоятся ВНЕ GitHub-workflow — Lovable-синком на push.
// Список ОБЯЗАТЕЛЕН, а не «для удобства»: без него проверка «config not in
// deploy» печатала бы 13 строк шума на чистом репозитории, а шумный отчёт
// читается как «здесь всегда шумит» — и настоящий дрейф в нём утонет. Ровно
// та же ловушка, что и у регэкспа `parseWorkflowDeploys` (фикс 2026-07-26).
//
// Проверено вживую 2026-07-27: каждое имя ниже ответило на OPTIONS
// задеплоенным статусом, ни одного 404 (`node scripts/check-edge-deploy.mjs`).
// Добавлять сюда — только осознанно: запись означает «GitHub Actions эту
// функцию не деплоит, и это ожидаемо». Если не уверен — НЕ добавляй, а впиши
// функцию в workflow (rule 96 #11); незадеплоенная функция даёт 404 на все
// вызовы, а клиент показывает «Failed to send a request to the Edge Function».
const DEPLOYED_OUTSIDE_WORKFLOW = new Set([
  "admin-analytics",
  "admin-ceo-dashboard",
  "admin-crm",
  "admin-homework",
  "admin-mock-exams",
  "assign-tutor-role",
  "ceo-telegram-digest",
  "claim-invite",
  "lesson-auto-debit",
  "mcp",
  "notify-booking",
  "payment-reminder",
  "process-email-queue",
  "public-homework-share",
  "telegram-scheduled-broadcast",
  "telegram-webapp-recent-solutions",
  "tutor-referral-announce",
]);

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function listFunctionDirs(dirPath) {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // `_shared` и прочие `_`-каталоги — общие модули, а не функции: деплоить и
    // объявлять в config нечего. Та же конвенция, что в check-edge-deploy.mjs.
    // Без фильтра `_shared` вечно висел бы в «only in functions dir», а
    // отчёт должен быть ПУСТЫМ в норме — тогда любая строка означает дрейф.
    .filter((name) => !name.startsWith("_"))
    .sort();
}

function parseConfigFunctions(text) {
  const map = new Map();
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fnMatch = line.match(/^\[functions\.([a-z0-9-]+)\]$/i);
    if (fnMatch) {
      current = fnMatch[1];
      map.set(current, null);
      continue;
    }

    const jwtMatch = line.match(/^verify_jwt\s*=\s*(true|false)$/i);
    if (current && jwtMatch) {
      map.set(current, jwtMatch[1].toLowerCase() === "true");
    }
  }

  return map;
}

function parseWorkflowDeploys(text) {
  const map = new Map();
  // ФЛАГ ИЩЕМ ДО КОНЦА СТРОКИ, а не сразу после имени (фикс 2026-07-26).
  // Прежний `([a-z0-9-]+)(?:\s+--no-verify-jwt)?` требовал флаг ВПЛОТНУЮ к
  // имени, тогда как реальная команда — `deploy <name> --project-ref "$REF"
  // --no-verify-jwt`. Опциональная группа не матчилась никогда, и проверка
  // объявляла ЛОЖНЫЙ дрейф для КАЖДОЙ публичной функции (client-error-report,
  // email-verify, все oauth-*, telegram-*). Отчёт из 20 фантомных строк
  // читается как «здесь всегда шумит» — и настоящий дрейф в нём утонул бы.
  const regex = /supabase functions deploy\s+([a-z0-9-]+)([^\n]*)/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const args = match[2] ?? "";
    map.set(name, args.includes("--no-verify-jwt"));
  }

  return map;
}

function fmtList(values) {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function report() {
  const config = parseConfigFunctions(readText(configPath));
  const dirs = listFunctionDirs(functionsDir);
  const deploy = parseWorkflowDeploys(readText(workflowPath));

  const configNames = [...config.keys()].sort();
  const deployNames = [...deploy.keys()].sort();

  const onlyInConfig = configNames.filter((name) => !dirs.includes(name));
  const onlyInDirs = dirs.filter((name) => !config.has(name));
  const deployNotInConfig = deployNames.filter((name) => !config.has(name));
  const deployNotInDirs = deployNames.filter((name) => !dirs.includes(name));

  // Обратное направление (rule 96 #11): функция объявлена в config и лежит в
  // репо, но её никто не деплоит — ни workflow, ни Lovable. Симптом пропуска:
  // 404 на КАЖДЫЙ вызов. Требуем наличие каталога, иначе сюда просочились бы
  // «only in config»-призраки (check-solutions / get-solution), у которых
  // деплоить попросту нечего.
  const configNotInDeploy = configNames.filter(
    (name) =>
      dirs.includes(name) &&
      !deploy.has(name) &&
      !DEPLOYED_OUTSIDE_WORKFLOW.has(name),
  );

  // Гниение allow-list'а. Запись протухает двумя способами: имя доехало до
  // workflow (исключение больше не нужно) либо функция исчезла из репо/конфига
  // (исключение мёртвое). Без этой проверки список тихо разъедется с
  // реальностью и начнёт ПРЯТАТЬ настоящий дрейф — ради чего он и заведён.
  const staleAllowlist = [...DEPLOYED_OUTSIDE_WORKFLOW]
    .filter(
      (name) => deploy.has(name) || !dirs.includes(name) || !config.has(name),
    )
    .sort();

  const policyMismatches = [];
  for (const name of deployNames) {
    if (!config.has(name)) continue;
    const configPolicy = config.get(name);
    const wfNoVerify = deploy.get(name);
    if (configPolicy === true && wfNoVerify === true) {
      policyMismatches.push(
        `${name}: config.verify_jwt=true vs workflow=--no-verify-jwt`,
      );
    }
    if (configPolicy === false && wfNoVerify === false) {
      policyMismatches.push(
        `${name}: config.verify_jwt=false vs workflow=default verify_jwt=true`,
      );
    }
  }

  console.log("=== Supabase Drift Check (report-only) ===");
  console.log("");
  console.log(`config functions: ${configNames.length}`);
  console.log(`functions dirs:   ${dirs.length}`);
  console.log(`workflow deploys: ${deployNames.length}`);
  // Печатаем размер исключения явно: сколько функций выведено из-под проверки
  // «config not in deploy». Зелёный отчёт не должен достигаться вычитанием —
  // читатель обязан видеть, что именно не покрыто (ср. check-edge-deploy.mjs).
  console.log(
    `outside workflow: ${DEPLOYED_OUTSIDE_WORKFLOW.size} (allow-listed: Lovable-синк)`,
  );
  console.log("");
  console.log(`only in config:        ${fmtList(onlyInConfig)}`);
  console.log(`only in functions dir: ${fmtList(onlyInDirs)}`);
  console.log(`deploy not in config:  ${fmtList(deployNotInConfig)}`);
  console.log(`deploy not in dir:     ${fmtList(deployNotInDirs)}`);
  console.log(`config not in deploy:  ${fmtList(configNotInDeploy)}`);
  console.log(`stale allowlist:       ${fmtList(staleAllowlist)}`);
  console.log("");
  console.log("policy mismatches:");
  if (policyMismatches.length === 0) {
    console.log("(none)");
  } else {
    for (const line of policyMismatches) {
      console.log(`- ${line}`);
    }
  }
  console.log("");
  console.log("Result: report-only (exit 0).");
}

try {
  report();
} catch (error) {
  console.error(`Drift check failed: ${error.message}`);
  process.exit(1);
}
