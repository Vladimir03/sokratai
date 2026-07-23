#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Гард «схема прода = схема репо» — инцидент «не сохраняется шаблон ДЗ» (2026-07-23).
//
// Класс бага: «миграция лежит в репо, но в прод не доехала». Файл
// 20260525120000_unify_homework_templates_subject_check.sql пролежал два месяца,
// Lovable молча пропустил его при синке, и CHECK на
// homework_tutor_templates.subject остался легаси-списком из шести значений.
// Итог: INSERT шаблона с subject вне списка падал 23514 → generic 500 → тихий
// тост. Сломаны были ВСЕ пути создания шаблона у 13 репетиторов
// (химия / французский / математика / русский) — нашли только по жалобе.
//
// Проверяет: оба subject-CHECK (templates + assignments) равны между собой И
// равны ожидаемому множеству из ЕДИНОГО РЕЕСТРА (канонические ∪ легаси).
//
// Режимы:
//   • по умолчанию — best-effort: нет сети / RPC недоступна → warn + exit 0
//     (локальный `npm run smoke-check` не должен падать оффлайн);
//   • `SMOKE_DB_STRICT=1` — fail-closed: любая невозможность проверить = exit 1.
//     Так гоняется job `prod-schema-guard` на push в main. Иначе ровно тот класс
//     бага, ради которого гард написан, оставался бы вечно-зелёным.
//
// Креды: env (`VITE_SUPABASE_URL` + publishable/service key), а при их отсутствии —
// публичные константы из `src/lib/supabaseClient.ts` (anon-ключ по определению
// публичный, он в отгружаемом бандле) → strict работает БЕЗ секретов в CI.
// Читает только DDL двух констрейнтов через `hw_subject_check_defs()`
// (миграция 20260723150000) — никаких пользовательских данных.
// ══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = process.cwd();
const STRICT = process.env.SMOKE_DB_STRICT === "1";

let failed = false;

function fail(message) {
  console.error(`ERROR: ${message}`);
  failed = true;
}
function warn(message) {
  console.log(`WARN: ${message}`);
}
function ok(message) {
  console.log(`OK: ${message}`);
}

/** strict → падаем; иначе — предупреждаем и выходим без проверки. */
function gap(message) {
  if (STRICT) {
    fail(`${message} (SMOKE_DB_STRICT=1 — гард обязан отработать)`);
  } else {
    warn(`${message} — проверка пропущена`);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Ожидаемое множество = ЕДИНЫЙ РЕЕСТР (канонические + легаси).
 *
 * Грузим модуль через esbuild, а не регэкспом по исходнику (паттерн
 * scripts/test-*.mjs): регулярка ломалась бы от любого рефакторинга литерала и
 * молча превращала гард в no-op — ровно то, чего мы избегаем.
 */
async function loadRegistry() {
  const entry = fileURLToPath(new URL("../src/lib/subjects/registry.ts", import.meta.url));
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64");
  return import(dataUrl);
}

function resolveCredentials() {
  let url = process.env.VITE_SUPABASE_URL || null;
  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    null;
  if (!url || !key) {
    const client = readText(path.join(rootDir, "src", "lib", "supabaseClient.ts"));
    const urlMatch = client.match(/const SUPABASE_URL\s*=\s*'([^']+)'/);
    const keyMatch = client.match(/'(eyJ[A-Za-z0-9_.-]{40,})'/);
    url = url || (urlMatch ? urlMatch[1] : null);
    key = key || (keyMatch ? keyMatch[1] : null);
  }
  return { url, key };
}

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Один запрос с жёстким таймаутом. Без него job мог висеть до системного
 * таймаута undici: CI ходит из GitHub-runner на Selectel-VPS в Москве, и
 * «долго не отвечает» — реальный сценарий (rule 95).
 */
async function fetchOnce(url, key) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/hw_subject_check_defs`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      // AbortSignal.timeout есть в Node 18+; в браузер этот скрипт не попадает,
      // поэтому Safari-ограничение (rule 80) неприменимо.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { res, transportError: null };
  } catch (error) {
    return { res: null, transportError: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Ретраим transport-сбои И 429/5xx (RU-DPI рвёт соединение вероятностно;
 * PostgREST может отдать 503 на рестарте). Плюс это окно ожидания СХОДИМОСТИ
 * схемы: job на push стартует раньше, чем Lovable успевает применить миграцию,
 * и мгновенный red был бы ложным. Дрейф (валидный ответ с расхождением) НЕ
 * ретраится — он не «сойдётся» сам.
 */
async function fetchCheckDefs(url, key) {
  let last = { res: null, transportError: "не выполнено ни одной попытки" };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    last = await fetchOnce(url, key);
    const retriable =
      last.transportError !== null ||
      (last.res && (last.res.status === 429 || last.res.status >= 500));
    if (!retriable) return last;
    if (attempt < MAX_ATTEMPTS) {
      warn(
        `попытка ${attempt}/${MAX_ATTEMPTS} не удалась ` +
          `(${last.transportError ?? `HTTP ${last.res.status}`}) — повтор через ${RETRY_DELAY_MS / 1000}с`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
  return last;
}

const registry = await loadRegistry();
const canonicalSubjects = [...(registry.SUBJECT_IDS ?? [])];
const legacySubjects = [...(registry.LEGACY_SUBJECT_IDS ?? [])];
if (canonicalSubjects.length === 0) {
  fail("реестр предметов пуст — гард был бы no-op");
} else {
  ok(`реестр: ${canonicalSubjects.length} канонических + ${legacySubjects.length} легаси`);

  const { url, key } = resolveCredentials();
  if (!url || !key) {
    gap("нет ни env-креды, ни констант в src/lib/supabaseClient.ts");
  } else {
    const { res, transportError } = await fetchCheckDefs(url, key);
    if (transportError) {
      gap(`сеть недоступна (${transportError})`);
    } else if (!res.ok) {
      gap(
        `HTTP ${res.status} — RPC hw_subject_check_defs недоступна ` +
          "(миграция 20260723150000 не применена или ключ без прав)",
      );
    } else {
      const defs = await res.json();
      // Значения внутри CHECK — любые строковые литералы, не только [a-z_].
      const parseSubjects = (definition) =>
        new Set(Array.from(String(definition).matchAll(/'([^']+)'::text/g)).map((m) => m[1]));
      const byName = new Map(
        (Array.isArray(defs) ? defs : []).map((r) => [r.constraint_name, parseSubjects(r.definition)]),
      );
      const tplSet = byName.get("homework_tutor_templates_subject_check");
      const asgSet = byName.get("homework_tutor_assignments_subject_check");

      if (!tplSet || !asgSet || tplSet.size === 0 || asgSet.size === 0) {
        gap("не удалось распарсить определения констрейнтов");
      } else {
        const onlyInAssignments = [...asgSet].filter((s) => !tplSet.has(s));
        const onlyInTemplates = [...tplSet].filter((s) => !asgSet.has(s));
        if (onlyInAssignments.length > 0 || onlyInTemplates.length > 0) {
          fail(
            "subject CHECK drift: homework_tutor_templates_subject_check ≠ " +
              "homework_tutor_assignments_subject_check " +
              `(только в assignments: ${onlyInAssignments.join(", ") || "—"}; ` +
              `только в templates: ${onlyInTemplates.join(", ") || "—"}). ` +
              "Скорее всего миграция не доехала до прода — сохранение шаблонов сломано " +
              "для расходящихся предметов (см. .claude/rules/40-homework-system.md).",
          );
        }
        const expected = new Set([...canonicalSubjects, ...legacySubjects]);
        const missing = [...expected].filter((s) => !tplSet.has(s));
        const unexpected = [...tplSet].filter((s) => !expected.has(s));
        if (missing.length > 0) {
          fail(
            `subject CHECK не покрывает ожидаемые предметы: ${missing.join(", ")}. ` +
              "Добавь миграцию, расширяющую ОБА CHECK (templates + assignments), иначе у " +
              "репетиторов этих предметов молча не сохраняются ДЗ/шаблоны.",
          );
        }
        // Варианты пробников: их CHECK валидирует ТОЛЬКО канонический набор
        // (легаси-значений в mock_exam_variants.subject не бывает), а edge
        // `mock-exam-tutor-api` теперь берёт список из того же реестра.
        const mockSet = byName.get("mock_exam_variants_subject_check");
        if (mockSet && mockSet.size > 0) {
          const mockMissing = canonicalSubjects.filter((s) => !mockSet.has(s));
          const mockUnexpected = [...mockSet].filter(
            (s) => !canonicalSubjects.includes(s) && !legacySubjects.includes(s),
          );
          if (mockMissing.length > 0 || mockUnexpected.length > 0) {
            fail(
              "mock_exam_variants_subject_check разошёлся с реестром " +
                `(не покрыто: ${mockMissing.join(", ") || "—"}; ` +
                `лишнее: ${mockUnexpected.join(", ") || "—"}). ` +
                "Репетитор не сможет создать вариант пробника по этому предмету.",
            );
          } else {
            ok(`mock_exam_variants CHECK покрывает реестр (${mockSet.size} значений)`);
          }
        }
        if (unexpected.length > 0) {
          fail(
            `subject CHECK содержит НЕОЖИДАННЫЕ значения: ${unexpected.join(", ")}. ` +
              "Добавь их в SUBJECT_REGISTRY или LEGACY_SUBJECTS (src/lib/subjects/registry.ts) — " +
              "молчаливое расширение словаря предметов запрещено.",
          );
        }
        if (!failed) {
          ok(
            `subject CHECK parity ok (${tplSet.size} значений в обоих констрейнтах = ` +
              `${canonicalSubjects.length} канонических + ${legacySubjects.length} легаси` +
              `${STRICT ? ", strict" : ""})`,
          );
        }
      }
    }
  }
}

// НЕ `process.exit()`: на Windows он рвёт ещё закрывающиеся сокеты undici →
// «Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)» и мусорный ненулевой
// код возврата поверх успешной проверки. Ставим код и даём Node выйти самому.
process.exitCode = failed ? 1 : 0;
