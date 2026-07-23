#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Генератор Deno-зеркала справочника предметов (2026-07-23).
//
// Источник правды — `src/lib/subjects/registry.ts`. Deno не может импортировать
// `src/`, поэтому edge-функциям нужен собственный модуль; но писать его руками
// = ровно тот класс бага, который мы чиним (словарь предметов был продублирован
// ≥9 раз, и расхождение с CHECK'ами БД два месяца ломало сохранение шаблонов).
// Здесь зеркало МАШИННОЕ, а smoke-гард §19 падает, если оно устарело.
//
//   Обновить:  npm run generate:subjects
//   Проверить: node scripts/generate-subjects.mjs --check   (exit 1 при дрейфе)
//
// Сгенерированный файл КОММИТИТСЯ: Lovable деплоит edge из репо.
// ══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = process.cwd();
const OUT_PATH = path.join(rootDir, "supabase", "functions", "_shared", "subjects.generated.ts");

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

const { SUBJECT_REGISTRY, LEGACY_SUBJECTS } = await loadRegistry();

const q = (s) => JSON.stringify(s);
const idList = (ids, indent = "  ") => ids.map((id) => `${indent}${q(id)},`).join("\n");

const canonicalIds = SUBJECT_REGISTRY.map((s) => s.id);
const legacyIds = LEGACY_SUBJECTS.map((s) => s.id);
const cefrIds = SUBJECT_REGISTRY.filter((s) => s.requiresCefr).map((s) => s.id);
const humanitiesIds = SUBJECT_REGISTRY.filter((s) => s.isHumanitiesWriting).map((s) => s.id);
// Легаси-id наследуют письменность канонического предмета (`rus` → `russian`).
const legacyHumanities = LEGACY_SUBJECTS.filter((l) => {
  const target = SUBJECT_REGISTRY.find((s) => s.id === l.alias);
  return target?.isHumanitiesWriting === true;
}).map((l) => l.id);

const labelEntries = [
  ...SUBJECT_REGISTRY.map((s) => `  ${q(s.id)}: ${q(s.name)},`),
  ...LEGACY_SUBJECTS.map((s) => `  ${q(s.id)}: ${q(s.name)},`),
].join("\n");

const dativeEntries = SUBJECT_REGISTRY.map((s) => `  ${q(s.id)}: ${q(s.dative)},`).join("\n");

const content = `// ⚠️ СГЕНЕРИРОВАННЫЙ ФАЙЛ — НЕ РЕДАКТИРОВАТЬ РУКАМИ.
//
// Источник: src/lib/subjects/registry.ts
// Обновить: npm run generate:subjects
//
// Deno-зеркало единого справочника предметов. Deno не импортирует src/, поэтому
// зеркало неизбежно — но оно машинное, а smoke-check §19 падает, если файл
// разошёлся с реестром. Ручная правка будет затёрта следующей генерацией.
//
// Добавляешь предмет → правь РЕЕСТР, потом \`npm run generate:subjects\`, потом
// миграцию на ОБА CHECK'а (homework_tutor_assignments + homework_tutor_templates),
// иначе ДЗ/шаблоны этого предмета молча не сохранятся (инцидент 2026-07-23).

/** Канонические id в порядке отображения. */
export const SUBJECT_IDS = [
${idList(canonicalIds)}
] as const;

/** Легаси-id: не предлагаются в UI, но валидны для UPDATE и живут в CHECK'ах БД. */
export const LEGACY_SUBJECT_IDS = [
${idList(legacyIds)}
] as const;

/** Иностранные языки: требуют уровень CEFR и политику языка фидбэка. */
export const SUBJECTS_REQUIRING_CEFR = new Set<string>([
${idList(cefrIds)}
]);

/** Развёрнутый ответ = текст (письмо/сочинение), а не численная задача. */
export const HUMANITIES_WRITING_SUBJECTS = new Set<string>([
${idList([...humanitiesIds, ...legacyHumanities])}
]);

/** id → русское название (включая легаси). */
export const SUBJECT_LABELS: Record<string, string> = {
${labelEntries}
};

/** id → дательный падеж («по …»). */
export const SUBJECT_DATIVE: Record<string, string> = {
${dativeEntries}
};

/** Название предмета; неизвестный id возвращается как есть. */
export function getSubjectLabelDeno(id: string | null | undefined): string {
  if (!id) return "";
  return SUBJECT_LABELS[id.trim().toLowerCase()] ?? id;
}
`;

const isCheck = process.argv.includes("--check");
const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : null;
// Сравниваем без учёта окончаний строк: git на Windows нормализует CRLF.
const normalize = (s) => s.replace(/\r\n/g, "\n");

if (isCheck) {
  if (existing === null) {
    console.error(`ERROR: ${path.relative(rootDir, OUT_PATH)} отсутствует — запусти npm run generate:subjects`);
    process.exitCode = 1;
  } else if (normalize(existing) !== normalize(content)) {
    console.error(
      `ERROR: ${path.relative(rootDir, OUT_PATH)} разошёлся с src/lib/subjects/registry.ts — ` +
        "запусти `npm run generate:subjects` и закоммить результат " +
        "(иначе edge-функции работают со СТАРЫМ словарём предметов).",
    );
    process.exitCode = 1;
  } else {
    console.log("OK: Deno-зеркало предметов совпадает с реестром");
  }
} else {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, content, "utf8");
  console.log(
    `OK: ${path.relative(rootDir, OUT_PATH)} обновлён ` +
      `(${canonicalIds.length} предметов + ${legacyIds.length} легаси)`,
  );
}
