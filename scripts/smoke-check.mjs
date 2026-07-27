#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const distAssetsDir = path.join(rootDir, "dist", "assets");
const srcDir = path.join(rootDir, "src");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.log(`WARN: ${message}`);
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function listFilesRecursive(dir, matcher) {
  const out = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!matcher || matcher(fullPath)) {
        out.push(fullPath);
      }
    }
  }

  return out;
}

function rel(filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function requireContains(filePath, snippet, failMessage, okMessage) {
  const content = readText(filePath);
  if (!content.includes(snippet)) {
    fail(failMessage);
  }
  ok(okMessage);
}

function requireMatches(filePath, pattern, failMessage, okMessage) {
  const content = readText(filePath);
  if (!pattern.test(content)) {
    fail(failMessage);
  }
  ok(okMessage);
}

function requireNotContains(filePath, snippet, failMessage, okMessage) {
  const content = readText(filePath);
  if (content.includes(snippet)) {
    fail(failMessage);
  }
  ok(okMessage);
}

function extractForbiddenHintRegexes(guidedAiContent) {
  const match = guidedAiContent.match(/const FORBIDDEN_HINT_PHRASES: RegExp\[\] = \[([\s\S]*?)\n\];/);
  if (!match) {
    fail("FORBIDDEN_HINT_PHRASES block not found in guided_ai.ts");
  }

  try {
    return Function(`"use strict"; return [${match[1]}];`)();
  } catch (error) {
    fail(`failed to parse FORBIDDEN_HINT_PHRASES from guided_ai.ts: ${String(error)}`);
  }
}

function validateHintContentSmoke(text, forbiddenRegexes) {
  const normalized = String(text ?? "").trim();
  for (const rx of forbiddenRegexes) {
    if (rx.test(normalized)) {
      return { ok: false, reason: `forbidden:${rx.source}` };
    }
  }

  if (normalized.length < 40) {
    return { ok: false, reason: "too_short" };
  }

  return { ok: true };
}

console.log("=== SokratAI Smoke Check (Static) ===");
console.log("");

console.log("1. Build artifact checks...");
if (!fs.existsSync(distAssetsDir)) {
  warn("dist/assets not found. Run `npm run build` before `npm run smoke-check` for chunk checks.");
} else {
  const distFiles = fs.readdirSync(distAssetsDir);
  const jsFiles = distFiles.filter((name) => name.endsWith(".js"));

  const mainBundle = jsFiles.find((name) => /^index-.*\.js$/.test(name));
  if (mainBundle) {
    const mainContent = readText(path.join(distAssetsDir, mainBundle));
    if (mainContent.includes("framer-motion")) {
      warn("framer-motion found in main bundle");
    } else {
      ok("framer-motion is not in main bundle");
    }
  } else {
    warn("main index chunk was not found");
  }

  const animationChunk = jsFiles.find((name) => /^animations-.*\.js$/.test(name));
  if (animationChunk) {
    const bytes = fs.statSync(path.join(distAssetsDir, animationChunk)).size;
    ok(`animations chunk exists (${Math.floor(bytes / 1024)}KB)`);
  } else {
    warn("animations chunk was not found");
  }

  const reactVendorChunk = jsFiles.find((name) => /^react-vendor-.*\.js$/.test(name));
  if (reactVendorChunk) {
    ok("react-vendor chunk exists");
  } else {
    warn("react-vendor chunk missing");
  }

  // Lookbehind-регэкспы в ЛЮБОМ собранном чанке — включая приехавшие из
  // ЗАВИСИМОСТЕЙ. Safari/WebKit < 16.4 кидает SyntaxError «Invalid regular
  // expression» (esbuild target safari15 конвертирует литералы в new RegExp →
  // падение в рантайме при рендере). Инцидент Глеба 2026-07-15: remark-gfm →
  // mdast-util-gfm-autolink-literal ронял экран задачи у всех учеников на
  // iOS ≤ 16.3. Для gfm использовать @/lib/markdown/remarkGfmSafe. Rule 80.
  const bundleLookbehindRe = /\(\?<[=!]/;
  const chunksWithLookbehind = jsFiles.filter((name) =>
    bundleLookbehindRe.test(readText(path.join(distAssetsDir, name))),
  );
  if (chunksWithLookbehind.length > 0) {
    for (const name of chunksWithLookbehind) {
      console.error(`  - dist/assets/${name}`);
    }
    fail(
      "regex lookbehind found in built chunks — breaks Safari < 16.4 (rule 80). " +
        "Источник: src или зависимость (как remark-gfm autolink-literal); для gfm — @/lib/markdown/remarkGfmSafe.",
    );
  }
  ok("no regex lookbehind in built chunks");
}
console.log("");

console.log("2. Cross-browser compatibility checks...");
let compatWarnings = 0;

const sourceFiles = listFilesRecursive(srcDir, (filePath) =>
  [".ts", ".tsx", ".css"].includes(path.extname(filePath)),
);

const filesWith100vh = sourceFiles.filter((filePath) => readText(filePath).includes("100vh"));
if (filesWith100vh.length > 0) {
  compatWarnings += 1;
  warn("100vh found (prefer 100dvh or -webkit-fill-available)");
  for (const filePath of filesWith100vh) {
    console.log(`  - ${rel(filePath)}`);
  }
}

const textFiles = sourceFiles.filter((filePath) => {
  const ext = path.extname(filePath);
  return ext === ".ts" || ext === ".tsx";
});

const smallInputPattern = /text-xs|text-\[1[0-3]px\]|font-size:\s*1[0-3]px/;
const inputTagPattern = /<input|<textarea|<select|<Input|<Textarea|<Select/;

const filesWithSmallInput = textFiles.filter((filePath) => {
  const content = readText(filePath);
  return smallInputPattern.test(content) && inputTagPattern.test(content);
});

if (filesWithSmallInput.length > 0) {
  compatWarnings += 1;
  warn("small input font-size found (<16px may auto-zoom in iOS Safari)");
  for (const filePath of filesWithSmallInput) {
    console.log(`  - ${rel(filePath)}`);
  }
}

// Lookbehind в исходниках — ЖЁСТКАЯ ошибка (не warn): Safari < 16.4 не
// поддерживает (rule 80), а vite-таргет safari15 лишь откладывает падение до
// рантайма (new RegExp). Инцидент Глеба 2026-07-15.
const srcLookbehindRe = /\(\?<[=!]/;
const filesWithLookbehind = textFiles.filter((filePath) =>
  srcLookbehindRe.test(readText(filePath)),
);
if (filesWithLookbehind.length > 0) {
  for (const filePath of filesWithLookbehind) {
    console.error(`  - ${rel(filePath)}`);
  }
  fail("regex lookbehind (?<= / (?<! found in src — breaks Safari < 16.4 (rule 80)");
}
ok("no regex lookbehind in src");

if (compatWarnings === 0) {
  ok("no compatibility warnings detected");
} else {
  warn(`${compatWarnings} compatibility warning(s) found (non-blocking)`);
}
console.log("");

console.log("3. Deleted legacy module guardrails...");

const deletedModules = [
  { pattern: /from\s+["']@\/pages\/Homework["']/, name: "pages/Homework (legacy)" },
  { pattern: /from\s+["']@\/pages\/HomeworkAdd["']/, name: "pages/HomeworkAdd (legacy)" },
  { pattern: /from\s+["']@\/pages\/HomeworkTaskList["']/, name: "pages/HomeworkTaskList (legacy)" },
  { pattern: /from\s+["']@\/pages\/HomeworkTaskDetail["']/, name: "pages/HomeworkTaskDetail (legacy)" },
  { pattern: /from\s+["']@\/components\/AddTaskDialog["']/, name: "components/AddTaskDialog (legacy)" },
  { pattern: /from\s+["']@\/components\/TaskContextBanner["']/, name: "components/TaskContextBanner (legacy)" },
];

let legacyImportFound = false;
for (const file of textFiles) {
  const content = readText(file);
  for (const mod of deletedModules) {
    if (mod.pattern.test(content)) {
      fail(`${rel(file)} imports deleted module ${mod.name}`);
      legacyImportFound = true;
    }
  }
}
if (!legacyImportFound) {
  ok("no imports of deleted legacy homework modules");
}
console.log("");

console.log("4. Auth flow guardrails...");
requireContains(
  path.join(rootDir, "src", "App.tsx"),
  'path="/tutor/login"',
  "route /tutor/login missing in src/App.tsx",
  "/tutor/login route exists",
);

requireContains(
  path.join(rootDir, "src", "pages", "Login.tsx"),
  'Link to="/tutor/login"',
  "student login does not link tutors to /tutor/login",
  "student login links tutors to /tutor/login",
);

requireMatches(
  path.join(rootDir, "src", "components", "TutorTelegramLoginButton.tsx"),
  /intended_role:\s*["']tutor["']/,
  "TutorTelegramLoginButton is missing intended_role=tutor",
  "TutorTelegramLoginButton sends intended_role=tutor",
);

requireNotContains(
  path.join(rootDir, "src", "pages", "RegisterTutor.tsx"),
  "upgrade_existing",
  "RegisterTutor still references upgrade_existing",
  "RegisterTutor has no upgrade_existing fallback",
);

requireNotContains(
  path.join(rootDir, "src", "pages", "RegisterTutor.tsx"),
  "authError.status === 422",
  "RegisterTutor still treats status 422 as email-exists marker",
  "RegisterTutor no longer treats 422 as email-exists",
);

console.log("");
console.log("5. Hint quality guardrails...");

const guidedAiPath = path.join(rootDir, "supabase", "functions", "homework-api", "guided_ai.ts");
const guidedAiContent = readText(guidedAiPath);
const forbiddenHintRegexes = extractForbiddenHintRegexes(guidedAiContent);

const livePilotPhrase = "Попробуй перечитать условие задачи и выделить ключевые данные";
const livePhraseCheck = validateHintContentSmoke(livePilotPhrase, forbiddenHintRegexes);
if (livePhraseCheck.ok) {
  fail("live pilot phrase still passes hint validator");
}
ok(`live pilot phrase is rejected (${livePhraseCheck.reason})`);

const validPhysicsHint = "По второму закону Ньютона ускорение бруска равно отношению силы к массе.";
const validPhysicsHintCheck = validateHintContentSmoke(validPhysicsHint, forbiddenHintRegexes);
if (!validPhysicsHintCheck.ok) {
  fail(`valid physics hint was rejected by smoke-check (${validPhysicsHintCheck.reason})`);
}
ok("content-specific physics hint passes validator");

console.log("");
console.log("6. AI image bucket whitelist invariant...");

const imageDomainsPath = path.join(rootDir, "supabase", "functions", "_shared", "image-domains.ts");
if (!fs.existsSync(imageDomainsPath)) {
  fail("supabase/functions/_shared/image-domains.ts is missing — required as single source of truth for AI image buckets");
}
const imageDomainsContent = readText(imageDomainsPath);
const bucketsBlockMatch = imageDomainsContent.match(
  /HOMEWORK_AI_BUCKETS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
);
if (!bucketsBlockMatch) {
  fail("HOMEWORK_AI_BUCKETS block not found in _shared/image-domains.ts");
}
const allowedBuckets = new Set(
  Array.from(bucketsBlockMatch[1].matchAll(/["']([a-z0-9_-]+)["']/gi)).map((m) => m[1]),
);
if (allowedBuckets.size === 0) {
  fail("HOMEWORK_AI_BUCKETS appears to be empty");
}
ok(`whitelist contains ${allowedBuckets.size} bucket(s): ${[...allowedBuckets].join(", ")}`);

// chat/index.ts must consume the shared module rather than redefining its own list
const chatIndexPath = path.join(rootDir, "supabase", "functions", "chat", "index.ts");
const chatIndexContent = readText(chatIndexPath);
if (!/from\s+["']\.\.\/_shared\/image-domains\.ts["']/.test(chatIndexContent)) {
  fail("chat/index.ts does not import from _shared/image-domains.ts (whitelist drift risk)");
}
ok("chat/index.ts imports the shared whitelist");

// Best-effort DB drift check: query distinct buckets actually referenced in
// homework_tutor_tasks. Requires VITE_SUPABASE_URL + a key with select access.
// If env is missing or RLS denies, skip with a warning — never block CI.
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  warn("DB bucket scan skipped (no VITE_SUPABASE_URL / publishable key in env)");
} else {
  const STORAGE_RX = /storage:\/\/([a-z0-9_-]+)\//gi;
  const collectBuckets = (rows, columns) => {
    const out = new Set();
    for (const row of rows ?? []) {
      for (const col of columns) {
        const value = row?.[col];
        if (typeof value !== "string") continue;
        for (const m of value.matchAll(STORAGE_RX)) {
          out.add(m[1].toLowerCase());
        }
      }
    }
    return out;
  };

  const queryUrl = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/homework_tutor_tasks?select=task_image_url,solution_image_urls,rubric_image_urls&or=(task_image_url.like.storage://*,solution_image_urls.like.storage://*,rubric_image_urls.like.storage://*)&limit=1000`;

  try {
    const res = await fetch(queryUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      warn(`DB bucket scan skipped (HTTP ${res.status} — RLS or key without read access)`);
    } else {
      const rows = await res.json();
      const usedBuckets = collectBuckets(Array.isArray(rows) ? rows : [], [
        "task_image_url",
        "solution_image_urls",
        "rubric_image_urls",
      ]);
      if (usedBuckets.size === 0) {
        ok("no storage:// refs found in homework_tutor_tasks (or none readable)");
      } else {
        const drift = [...usedBuckets].filter((b) => !allowedBuckets.has(b));
        if (drift.length > 0) {
          fail(
            `bucket drift: ${drift.join(", ")} found in homework_tutor_tasks but missing from HOMEWORK_AI_BUCKETS in _shared/image-domains.ts. Add them or AI will hallucinate on those tasks.`,
          );
        }
        ok(`DB bucket usage matches whitelist (${[...usedBuckets].join(", ")})`);
      }
    }
  } catch (error) {
    warn(`DB bucket scan skipped (fetch error: ${error instanceof Error ? error.message : String(error)})`);
  }
}

console.log("");

// ─── 7. Единый справочник предметов: реестр ↔ Deno-зеркало ──────────────────
//
// Phase 7 (2026-05-20) держал ЧЕТЫРЕ рукописные копии множества письменных
// гуманитарных предметов и сверял их регэкспами по исходникам. С 2026-07-23
// копий нет: единственный источник — src/lib/subjects/registry.ts, фронт зовёт
// его напрямую, edge читает СГЕНЕРИРОВАННОЕ _shared/subjects.generated.ts.
// Тест проверяет рантайм-эквивалентность (множества, порядок id, лейблы,
// дательный падеж, легаси-алиасы). Свежесть файла зеркала — секция 19,
// соответствие CHECK'ам прод-БД — секция 17.
console.log("7. Единый справочник предметов (реестр ↔ Deno-зеркало)...");
const subjectsRegistryTestPath = path.join(rootDir, "scripts", "test-subjects-registry.mjs");
if (!fs.existsSync(subjectsRegistryTestPath)) {
  fail("scripts/test-subjects-registry.mjs missing — справочник предметов без гарда");
}
const subjectsRegistryResult = spawnSync(process.execPath, [subjectsRegistryTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (subjectsRegistryResult.status !== 0) {
  console.error(subjectsRegistryResult.stdout ?? "");
  console.error(subjectsRegistryResult.stderr ?? "");
  fail("subjects registry parity FAILED — see node:test output above");
}
ok("реестр предметов = Deno-зеркало (множества, порядок, лейблы, алиасы)");

console.log("");
console.log("8. Homework constructor write-form query invariant (Phase 10, 2026-05-26)...");

// Phase 10 critical hotfix invariant: edit-mode useQuery в homework constructor
// (и future write-form pages) ОБЯЗАН иметь `refetchOnWindowFocus: false`. Default
// React Query setting `true` вызывает race condition с prefill effect —
// добавленные tutor'ом задачи теряются при tab switch (репорт Elena Ivanova
// 2026-05-26). Hard rule: пока user editing local form state, server data
// background-refetch'иться не должна. См. .claude/rules/40-homework-system.md + Phase 10 в
// ~/.claude/plans/1-functional-meteor.md.
//
// Pattern: ищем `useQuery({` в write-form pages и assert'им что в config
// есть `refetchOnWindowFocus: false`. Если кто-то добавит новый write-form
// useQuery без guard — smoke fail с явной инструкцией.

const writeFormPages = [
  // Pages with edit mode + local form state from server data:
  "src/pages/tutor/TutorHomeworkCreate.tsx",
];

const useQueryRe = /useQuery\s*\(\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\)/g;
const hasRefetchOffRe = /refetchOnWindowFocus\s*:\s*false/;
const hasQueryKeyRe = /queryKey\s*:/;

// Phase 10 (2026-05-26, ChatGPT-5.5 review P1 fix): strip comments перед regex
// чтобы избежать false-positive когда `refetchOnWindowFocus: false` фигурирует
// в комментарии (e.g. документация в JSDoc). Простая strip: line `//...` +
// block `/* ... */`. Не идеально (не парсит JSX, strings), но adequate как
// tripwire — для proper validation использовать AST parser в Phase 11+.
function stripComments(source) {
  // Remove block comments /* ... */ (non-greedy, multiline).
  let stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments // ... (до конца строки).
  stripped = stripped.replace(/\/\/[^\n]*/g, "");
  return stripped;
}

let writeFormViolations = 0;
for (const relativePath of writeFormPages) {
  const fullPath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    warn(`${relativePath} not found — write-form invariant skipped for this path`);
    continue;
  }
  const content = stripComments(fs.readFileSync(fullPath, "utf8"));

  // Find ВСЕ useQuery calls (могут быть несколько на странице — read lists +
  // edit query). Match только тех у которых есть queryKey (real useQuery, не
  // alias).
  const matches = [...content.matchAll(useQueryRe)];
  if (matches.length === 0) {
    warn(`${relativePath}: no useQuery calls found — skipped`);
    continue;
  }

  let pageViolations = 0;
  for (const match of matches) {
    const configBody = match[1];
    if (!hasQueryKeyRe.test(configBody)) continue; // не real useQuery
    if (!hasRefetchOffRe.test(configBody)) {
      // Извлечь короткий identifier для error message — обычно queryKey прямо
      // после `queryKey:` line.
      const keyMatch = configBody.match(/queryKey\s*:\s*\[([^\]]+)\]/);
      const keyHint = keyMatch ? keyMatch[1].trim().slice(0, 80) : "(unknown key)";
      fail(
        `${relativePath}: useQuery with queryKey [${keyHint}] missing 'refetchOnWindowFocus: false'.\n` +
          `  Write-form queries MUST disable focus refetch — иначе race condition с prefill effect\n` +
          `  уничтожит unsaved user edits при tab switch (Phase 10 hotfix invariant).\n` +
          `  См. .claude/rules/40-homework-system.md «Homework constructor QA».`,
      );
      pageViolations += 1;
    }
  }

  if (pageViolations === 0) {
    ok(`${relativePath}: all useQuery calls have refetchOnWindowFocus: false`);
  } else {
    writeFormViolations += pageViolations;
  }
}

if (writeFormViolations === 0 && writeFormPages.length > 0) {
  ok(`Write-form query invariant: all ${writeFormPages.length} page(s) compliant`);
}

console.log("");

// ─── 9. Criteria-breakdown template invariants (voice-speaking-mvp TASK-2/3) ─
// Sum-aggregation contract: language formats exposing a criteria template
// must be additive (Σ max = exam total); IELTS (average) must NOT expose one.
// Bundles the Deno subject-rubric graph via esbuild — runs as a subprocess
// because that test is async + needs the bundler. Catches the «methodology
// says N, template sums to M» regression class (review fix 2026-05-27, P1 #2).
console.log("9. Criteria-breakdown template invariants (voice-speaking-mvp)...");
const criteriaTestPath = path.join(rootDir, "scripts", "test-criteria-templates.mjs");
if (!fs.existsSync(criteriaTestPath)) {
  fail("scripts/test-criteria-templates.mjs missing — criteria template invariants unguarded");
}
const criteriaResult = spawnSync(process.execPath, [criteriaTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (criteriaResult.status !== 0) {
  console.error(criteriaResult.stdout ?? "");
  console.error(criteriaResult.stderr ?? "");
  fail("criteria template invariants FAILED — see node:test output above");
}
ok("criteria template invariants pass (sum totals + IELTS disabled + non-language null)");

// ─── 10. Score-scales mirror invariant (student-progress R2) ─────────────────
// `src/lib/scoreScales.ts` (frontend) ↔ `supabase/functions/_shared/score-scales.ts`
// (Deno) must keep EGE_PHYS_2026.map identical (current_level / pct_to_goal / trend
// depend on it). Text-based: extract the `map: [...]` array from both + compare.
console.log("");
console.log("10. Score-scales mirror invariant (student-progress R2)...");
const scaleFront = path.join(srcDir, "lib", "scoreScales.ts");
const scaleDeno = path.join(rootDir, "supabase", "functions", "_shared", "score-scales.ts");
if (!fs.existsSync(scaleFront) || !fs.existsSync(scaleDeno)) {
  fail("score-scales module missing (frontend or Deno copy)");
}
function extractEgeMap(filePath) {
  const content = readText(filePath);
  const m = content.match(/map:\s*\[([\s\S]*?)\]/);
  if (!m) fail(`EGE_PHYS_2026.map not found in ${rel(filePath)}`);
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map(Number);
}
const frontMap = extractEgeMap(scaleFront);
const denoMap = extractEgeMap(scaleDeno);
if (frontMap.length !== denoMap.length || frontMap.some((v, i) => v !== denoMap[i])) {
  fail("EGE_PHYS_2026.map DRIFT between scoreScales.ts and _shared/score-scales.ts — must stay identical");
}
if (frontMap.length !== 46) {
  fail(`EGE_PHYS_2026.map must have 46 entries (0..45 primary), got ${frontMap.length}`);
}
if (frontMap[21] !== 59 || frontMap[45] !== 100 || frontMap[0] !== 0) {
  fail(`EGE_PHYS_2026.map lookup wrong: [21]=${frontMap[21]} (exp 59), [45]=${frontMap[45]} (exp 100), [0]=${frontMap[0]} (exp 0)`);
}
ok("score-scales mirror in sync (46 entries, primary 21→59, 45→100)");

// ─── 11. Trainer v1 formula LaTeX escaping (egorFormulas.ts) ──────────────────
// Hand-written v1 trainer formulas keep LaTeX inside JS strings; a LONE backslash
// before a letter is a JS-escape bug — `\t`→TAB (chip renders «extцс»),
// `\c`/`\a`/`\s`→letter dropped (chip renders literal «cos(alpha)»). Correct LaTeX
// doubles every backslash (`\\frac`, `\\text{цс}`, `\\cos(\\alpha)`). Collapse the
// `\\` pairs, then any remaining `\`+letter is a regression. Catches the render
// bugs Elena reported (2026-06-19) for current + future v1 formulas.
console.log("");
console.log("11. Trainer v1 formula LaTeX escaping (egorFormulas.ts)...");
const egorFormulasPath = path.join(srcDir, "lib", "formulaEngine", "egorFormulas.ts");
if (!fs.existsSync(egorFormulasPath)) {
  fail("src/lib/formulaEngine/egorFormulas.ts missing — trainer v1 formula guard cannot run");
}
const egorLines = readText(egorFormulasPath).split(/\r?\n/);
const loneBackslashHits = [];
egorLines.forEach((line, idx) => {
  const collapsed = line.replace(/\\\\/g, ""); // drop correctly-escaped \\ pairs
  if (/\\[a-zA-Z]/.test(collapsed)) {
    loneBackslashHits.push(`${idx + 1}: ${line.trim()}`);
  }
});
if (loneBackslashHits.length > 0) {
  fail(
    "egorFormulas.ts has lone-backslash LaTeX (JS strings must double every backslash) — renders «extцс»/«cos(alpha)»:\n  " +
      loneBackslashHits.slice(0, 12).join("\n  "),
  );
}
ok(`trainer v1 formula LaTeX escaping clean (${egorLines.length} lines scanned)`);

// ─── 12. Physics ФИПИ flowchart walker (strict-criteria-grading Phase 3) ─────
// Балл Часть 2 (№ 21-26) считается КОДОМ по блок-схемам ФИПИ (подтверждены
// Егором), не моделью. Guards развязку узлов + ключевой кейс адиабаты
// (потеряна Δ в преобразованиях → 2/3, не 3). Subprocess (async + esbuild).
console.log("");
console.log("12. Physics ФИПИ flowchart walker (Часть 2 № 21-26)...");
const physicsFlowTestPath = path.join(rootDir, "scripts", "test-physics-flowcharts.mjs");
if (!fs.existsSync(physicsFlowTestPath)) {
  fail("scripts/test-physics-flowcharts.mjs missing — flowchart walker unguarded");
}
const physicsFlowResult = spawnSync(process.execPath, [physicsFlowTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (physicsFlowResult.status !== 0) {
  console.error(physicsFlowResult.stdout ?? "");
  console.error(physicsFlowResult.stderr ?? "");
  fail("physics flowchart walker FAILED — see node:test output above");
}
ok("physics ФИПИ flowchart walker pass (№ 21-26 tiers + adiabatic Δ → 2/3)");

// ─── 13. Physics node-prompt sanitizer (strict-criteria-grading Phase B) ─────
// Санитайзер AI-узлов-суждений → типизированные judgments (коэрсинг) + связка
// узлы→walker (адиабата Δ→2/3) + чеклист №26 в системном промпте. Subprocess.
console.log("");
console.log("13. Physics node-prompt sanitizer (Часть 2 узлы)...");
const physicsNodeTestPath = path.join(rootDir, "scripts", "test-physics-node-prompt.mjs");
if (!fs.existsSync(physicsNodeTestPath)) {
  fail("scripts/test-physics-node-prompt.mjs missing — node sanitizer unguarded");
}
const physicsNodeResult = spawnSync(process.execPath, [physicsNodeTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (physicsNodeResult.status !== 0) {
  console.error(physicsNodeResult.stdout ?? "");
  console.error(physicsNodeResult.stderr ?? "");
  fail("physics node-prompt sanitizer FAILED — see node:test output above");
}
ok("physics node-prompt sanitizer pass (judgments coercion + node→walker)");

// ─── 14. Answer alternatives / range parser (#61, 2026-07-11) ────────────────
// Несколько допустимых верных ответов («1248 ; 1250») + числовой диапазон
// («2,1–2,3») в текстовом поле ответа. Guards: (а) зеркала frontend↔Deno
// идентичны на общих векторах; (б) даты «1941-1945» и «-5» НЕ трактуются как
// диапазон (false-positive class). Subprocess (async + esbuild).
console.log("");
console.log("14. Answer alternatives / range parser (#61)...");
const answerAltTestPath = path.join(rootDir, "scripts", "test-answer-alternatives.mjs");
if (!fs.existsSync(answerAltTestPath)) {
  fail("scripts/test-answer-alternatives.mjs missing — answer alternatives parser unguarded");
}
const answerAltResult = spawnSync(process.execPath, [answerAltTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (answerAltResult.status !== 0) {
  console.error(answerAltResult.stdout ?? "");
  console.error(answerAltResult.stderr ?? "");
  fail("answer alternatives parser FAILED — see node:test output above");
}
ok("answer alternatives parser pass (mirror parity + range semantics)");

// ── 15. Mock-exam check_mode parity (ревью 5.6 A4, 2026-07-23) ─────────────
// Набор режимов проверки живёт в 7 местах (2 зеркала чекера, 2 клиентских
// типа, OCR-хелпер, валидатор tutor-api, опции редактора). Реестр
// MOCK_EXAM_CHECK_MODES — source of truth; тест сверяет все поверхности +
// канареечные векторы каждого режима между зеркалами. Subprocess (async + esbuild).
console.log("");
console.log("15. Mock-exam check_mode parity (реестр × 6 поверхностей)...");
const checkModeParityPath = path.join(rootDir, "scripts", "test-mockexam-checkmode-parity.mjs");
if (!fs.existsSync(checkModeParityPath)) {
  fail("scripts/test-mockexam-checkmode-parity.mjs missing — check_mode parity unguarded");
}
const checkModeParityResult = spawnSync(process.execPath, [checkModeParityPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (checkModeParityResult.status !== 0) {
  console.error(checkModeParityResult.stdout ?? "");
  console.error(checkModeParityResult.stderr ?? "");
  fail("check_mode parity FAILED — see node:test output above");
}
ok("check_mode parity pass (реестр = Deno-зеркало = OCR = tutor-api = редактор)");

// ── 16. ExamProfile registry parity (техдолг 5.6, 2026-07-23) ───────────────
// Registry (src/lib/examProfiles.ts) консолидировал карты предмет×экзамен
// (баллы КИМ / режимы Ч1 / граница Ч2 / бенчмарки); обёртки kbKimScores /
// variantTaskDraft / checkFormatHelpers / mockExamScaleEge2025 обязаны отдавать
// прежние значения байт-в-байт (Σ45/Σ39/Σ28 — канарейки предметников).
console.log("");
console.log("16. ExamProfile registry parity (предмет × экзамен)...");
const examProfilesTestPath = path.join(rootDir, "scripts", "test-exam-profiles.mjs");
if (!fs.existsSync(examProfilesTestPath)) {
  fail("scripts/test-exam-profiles.mjs missing — exam-profile parity unguarded");
}
const examProfilesResult = spawnSync(process.execPath, [examProfilesTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (examProfilesResult.status !== 0) {
  console.error(examProfilesResult.stdout ?? "");
  console.error(examProfilesResult.stderr ?? "");
  fail("exam-profile parity FAILED — see node:test output above");
}
ok("exam-profile parity pass (registry = обёртки, Σ45/Σ39/Σ28 канарейки)");

// ── 17. Subject CHECK parity vs PROD (инцидент «не сохраняется шаблон», 2026-07-23) ──
//
// Класс бага — «миграция в репо ≠ применена в проде»: CHECK на
// homework_tutor_templates.subject два месяца оставался легаси-списком, из-за чего
// шаблоны молча не сохранялись у 13 репетиторов (химия/французский/математика/русский).
//
// Реализация — scripts/check-prod-schema.mjs (ТОТ ЖЕ скрипт гоняет CI-job
// `prod-schema-guard` на push в main с SMOKE_DB_STRICT=1, где любая невозможность
// проверить = FAIL). Здесь best-effort: оффлайн-запуск smoke-check не должен падать.
console.log("");
console.log("17. Subject CHECK parity vs production schema...");
const prodSchemaCheckPath = path.join(rootDir, "scripts", "check-prod-schema.mjs");
if (!fs.existsSync(prodSchemaCheckPath)) {
  fail("scripts/check-prod-schema.mjs missing — subject CHECK drift unguarded");
}
const prodSchemaResult = spawnSync(process.execPath, [prodSchemaCheckPath], {
  cwd: rootDir,
  encoding: "utf8",
});
console.log((prodSchemaResult.stdout ?? "").trimEnd());
if (prodSchemaResult.status !== 0) {
  console.error(prodSchemaResult.stderr ?? "");
  fail("subject CHECK parity FAILED — см. вывод выше");
}
// ── 18. Template ref-promotion parity (ревью 5.6 P1 #1/#4, 2026-07-23) ──────
//
// Промоушен шаблона в ССЫЛОЧНЫЙ режим допустим только если синтез из Базы даст
// ровно сохранённый снимок — иначе шаблон молча покажет ДРУГУЮ задачу (правка
// без «Обновить в Базе», округление дробного max_score, выключенные
// include_rubric / include_ai_settings). Гейт = templateTaskContentEquals.
console.log("");
console.log("18. Template ref-promotion parity (снимок ↔ Базa)...");
const refParityTestPath = path.join(rootDir, "scripts", "test-template-ref-parity.mjs");
if (!fs.existsSync(refParityTestPath)) {
  fail("scripts/test-template-ref-parity.mjs missing — гейт промоушена шаблона без теста");
}
const refParityResult = spawnSync(process.execPath, [refParityTestPath], {
  cwd: rootDir,
  encoding: "utf8",
});
if (refParityResult.status !== 0) {
  console.error(refParityResult.stdout ?? "");
  console.error(refParityResult.stderr ?? "");
  fail("template ref-promotion parity FAILED — see node:test output above");
}
ok("template ref-promotion parity pass (divergence/rubric/AI-toggles → legacy snapshot)");
// ── 19. Deno-зеркало справочника предметов не устарело (2026-07-23) ─────────
//
// Единый источник — src/lib/subjects/registry.ts; edge-функции читают
// СГЕНЕРИРОВАННЫЙ _shared/subjects.generated.ts (Deno не импортирует src/).
// Забыли `npm run generate:subjects` → edge работает со СТАРЫМ словарём:
// новый предмет не проходит валидацию, лейбл в AI-промпте — сырой id.
// Ровно тот класс бага, из-за которого шаблоны молча не сохранялись.
console.log("");
console.log("19. Subjects Deno-mirror freshness (registry → subjects.generated.ts)...");
const subjectsGenPath = path.join(rootDir, "scripts", "generate-subjects.mjs");
if (!fs.existsSync(subjectsGenPath)) {
  fail("scripts/generate-subjects.mjs missing — зеркало предметов без гарда");
}
const subjectsGenResult = spawnSync(process.execPath, [subjectsGenPath, "--check"], {
  cwd: rootDir,
  encoding: "utf8",
});
console.log((subjectsGenResult.stdout ?? "").trimEnd());
if (subjectsGenResult.status !== 0) {
  console.error(subjectsGenResult.stderr ?? "");
  fail("subjects mirror stale — запусти `npm run generate:subjects` и закоммить результат");
}
// ── 20. Service Worker инварианты (2026-07-25) ─────────────────────────────
//
// Гард, который rule 95 рекомендует с инцидента 2026-06-29 («SW отдавал
// respondWith(undefined) → пустой модуль → octet-stream → чанк не исполнялся»)
// и который никто не написал. Тот же инцидент содержал вторую ошибку:
// isHashedAsset был /[a-f0-9]{8,}/ и не матчил НИ ОДИН реальный vite-хэш
// (они mixed-case base62) — все чанки шли по хрупкому network-first пути.
const MIN_SW_CACHE_VERSION = 5;

console.log("");
console.log("20. Service Worker invariants (кэш-версия, isHashedAsset, тип-гарды)...");
const swPath = path.join(rootDir, "public", "service-worker.js");
if (!fs.existsSync(swPath)) {
  fail("public/service-worker.js missing");
}
const swSource = fs.readFileSync(swPath, "utf8");

// Проверки ФОРМЫ КОДА идут по source БЕЗ комментариев: этот файл документирует
// анти-паттерны своими словами («respondWith(undefined) throws…»), и матч по
// сырому тексту ложно срабатывал бы на собственной документации.
//
// Общий stripComments здесь НЕ подходит по двум причинам:
//  1. Он режет `//` внутри строк-URL (`'://api.sokratai.ru/'`) как line-коммент
//     и сносит остаток строки → байпас API «исчезает».
//  2. Блочные комментарии нельзя вырезать ПЕРВЫМИ: в этом файле есть
//     line-комментарий с текстом `/storage/*`, и его `/*` (при non-greedy
//     матче до ближайшего `*/`) съедал ~40 строк РЕАЛЬНОГО кода вместе с
//     веткой документов. Поэтому: сначала line-комментарии (protocol-safe),
//     потом блочные.
function stripJsCommentsUrlSafe(source) {
  return source
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const swCode = stripJsCommentsUrlSafe(swSource);

// Сам стриппер — эвристика, поэтому проверяем, что он не съел код: иначе
// «не найдено» ниже читалось бы как регресс SW, хотя виноват гард.
for (const landmark of [
  "self.addEventListener('fetch'",
  "isDocumentRequest(event.request)",
  "isHashedAsset(event.request.url)",
  "api.sokratai.ru",
]) {
  if (!swCode.includes(landmark)) {
    fail(
      `smoke-check §20: стриппер комментариев съел «${landmark}» — починить ` +
        "stripJsCommentsUrlSafe, а НЕ service-worker.js",
    );
  }
}

if (/respondWith\s*\(\s*undefined/.test(swCode)) {
  fail("service-worker.js: respondWith(undefined) — пустой модуль читается как octet-stream (инцидент 2026-06-29)");
}

// Литеральный `respondWith(undefined)` — НЕ тот вид, в котором баг реально
// случается (ревью 5.6 P2: гард давал ложный проход). Инцидент 2026-06-29 был
// `return cached` — при cache miss это undefined, и respondWith получал его
// неявно. Поэтому требуем явный терминатор `|| Response.error()` в КАЖДОЙ
// fallback-ветви и общее число терминаторов.
const cachedFallbacks = (swCode.match(/cached\s*\|\|\s*Response\.error\(\)/g) ?? []).length;
if (cachedFallbacks < 2) {
  fail(
    `service-worker.js: найдено ${cachedFallbacks} из ≥2 fallback'ов вида ` +
      "`cached || Response.error()` (ветка документов + generic). Голый `return cached` " +
      "при cache miss отдаёт undefined → octet-stream (инцидент 2026-06-29)",
  );
}
const errorTerminators = (swCode.match(/Response\.error\(\)/g) ?? []).length;
if (errorTerminators < 3) {
  fail(
    `service-worker.js: только ${errorTerminators} из ≥3 Response.error() — ` +
      "каждая ветка respondWith обязана иметь валидный терминатор вместо undefined",
  );
}

// Запись в кэш обязана продлевать жизнь воркера: respondWith продлевает её
// только для ВОЗВРАЩАЕМОГО promise, поэтому «выстрелил и забыл» cache.put может
// не дожить до конца (ревью 5.6 P2 — оффлайн-копия шелла оставалась старой).
const waitUntilCount = (swCode.match(/event\.waitUntil\(/g) ?? []).length;
if (waitUntilCount < putIndicesEarly(swCode)) {
  fail(
    "service-worker.js: cache.put вне event.waitUntil — запись может быть убита " +
      "вместе с воркером сразу после отдачи ответа",
  );
}
function putIndicesEarly(code) {
  return (code.match(/cache\.put\(/g) ?? []).length;
}

// Версия кэша: меняешь логику кэширования → бампай (activate чистит остальные).
const swVersionMatch = swSource.match(/math-tutor-cache-v(\d+)/);
if (!swVersionMatch) {
  fail("service-worker.js: не найден CACHE_NAME вида math-tutor-cache-v<N>");
}
const swVersion = Number(swVersionMatch[1]);
if (swVersion < MIN_SW_CACHE_VERSION) {
  fail(
    `service-worker.js: CACHE_NAME v${swVersion} < MIN_SW_CACHE_VERSION v${MIN_SW_CACHE_VERSION} — ` +
      "менял кэширование? бампни версию и MIN_SW_CACHE_VERSION в этом файле",
  );
}

// isHashedAsset обязан матчить РЕАЛЬНЫЕ vite-хэши и не хватать статику.
const hashedFnMatch = swCode.match(/function isHashedAsset\(url\)\s*\{\s*return\s*(\/.+\/)[a-z]*\.test\(url\)/);
if (!hashedFnMatch) {
  fail("service-worker.js: не удалось извлечь регэксп isHashedAsset — правь гард синхронно с реализацией");
}
let isHashedAssetProbe;
try {
  isHashedAssetProbe = new Function("url", `return ${hashedFnMatch[1]}.test(url);`);
} catch (err) {
  fail(`service-worker.js: регэксп isHashedAsset не компилируется: ${err.message}`);
}
const hashedMustMatch = [
  "/assets/index-CqLFP3xM.js",
  "/assets/HomeworkProblem-4cjyIRNK.js",
  "/assets/index-DlQ2sOZg.css",
  "/assets/pdf.worker.min-BYB2VeqW.js",
];
const hashedMustNotMatch = ["/sokrat-logo.png", "/service-worker.js", "/manifest.json", "/index.html"];
for (const url of hashedMustMatch) {
  if (!isHashedAssetProbe(url)) {
    fail(`service-worker.js: isHashedAsset НЕ матчит реальный vite-чанк ${url} (инцидент 2026-06-29)`);
  }
}
for (const url of hashedMustNotMatch) {
  if (isHashedAssetProbe(url)) {
    fail(`service-worker.js: isHashedAsset ошибочно матчит ${url}`);
  }
}

// Каждый cache.put ассетов обязан быть за тип-гардом: cache-first + вечный
// CACHE_NAME ⇒ одна запись «HTML под URL чанка» живёт вечно.
if (!swCode.includes("isCacheableAssetResponse(")) {
  fail("service-worker.js: нет isCacheableAssetResponse — cache.put без проверки content-type");
}
const putIndices = [];
for (let i = swCode.indexOf("cache.put("); i !== -1; i = swCode.indexOf("cache.put(", i + 1)) {
  putIndices.push(i);
}
if (putIndices.length === 0) {
  fail("service-worker.js: не найдено ни одного cache.put — гард потерял смысл, проверь реализацию");
}
for (const idx of putIndices) {
  const before = swCode.slice(Math.max(0, idx - 500), idx);
  if (!/isCacheable(Asset|Document)Response\(/.test(before)) {
    fail("service-worker.js: cache.put без предшествующего isCacheable*Response — возможное отравление кэша");
  }
}

// Ветка документов обязана ретраить (один сорванный DPI-хендшейк иначе отдаёт
// оффлайн-копию шелла со ссылками на удалённые хэши → белый экран).
const docBranchStart = swCode.indexOf("isDocumentRequest(event.request)");
if (docBranchStart === -1) {
  fail("service-worker.js: не найдена ветка isDocumentRequest(event.request)");
}
const docBranch = swCode.slice(docBranchStart, docBranchStart + 600);
if (!docBranch.includes("fetchWithRetry")) {
  fail("service-worker.js: ветка документов без fetchWithRetry — один DPI-обрыв отдаст стейл-шелл");
}

// Байпас нашего API обязан стоять ВЫШЕ любой кэширующей ветки.
const apiBypassIdx = swCode.indexOf("://api.sokratai.ru/");
if (apiBypassIdx === -1) {
  fail("service-worker.js: нет байпаса api.sokratai.ru — запросы к API попадут в кэш");
}
if (apiBypassIdx > docBranchStart) {
  fail("service-worker.js: байпас api.sokratai.ru ПОСЛЕ кэширующих ветвей — переставь выше");
}
ok(`service-worker.js invariants pass (v${swVersion}, isHashedAsset матчит vite-хэши, cache.put за тип-гардом)`);

// ── 21. Шелл + деплой инварианты (2026-07-25) ──────────────────────────────
//
// (а) modulepreload на /src/*: Vite резолвит его как АССЕТ и инлайнит сырой
//     нетранспилированный исходник как data:application/octet-stream — нулевая
//     польза и ПОСТОЯННЫЙ ложноположительный на диагностике rule 95 «сломан SW».
// (б) деплой: retention старых hashed-assets — единственное, что спасает
//     клиента со стейл-шеллом. Возврат `rm -rf /var/www` = возврат белых
//     экранов (проверено curl'ом 24.07: все чанки из /admin отдавали 404).
console.log("");
console.log("21. Shell + deploy invariants (modulepreload, retention деплоя)...");
const indexHtmlPath = path.join(rootDir, "index.html");
if (!fs.existsSync(indexHtmlPath)) {
  fail("index.html missing");
}
// HTML-комментарии вырезаем: и index.html, и его билд ДОКУМЕНТИРУЮТ этот
// анти-паттерн своими словами (в т.ч. цитируя строку `data:application/
// octet-stream`), поэтому матч по сырому тексту ловил бы сам комментарий.
const stripHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

const indexHtmlMarkup = stripHtmlComments(fs.readFileSync(indexHtmlPath, "utf8"));
if (/<link[^>]+rel=["']modulepreload["'][^>]+href=["']\/src\//.test(indexHtmlMarkup)) {
  fail(
    "index.html: modulepreload на /src/* — Vite заинлайнит сырой исходник как " +
      "data:application/octet-stream (см. rule 95). Удали строку.",
  );
}

const builtIndexPath = path.join(rootDir, "dist", "index.html");
if (fs.existsSync(builtIndexPath)) {
  const builtIndex = stripHtmlComments(fs.readFileSync(builtIndexPath, "utf8"));
  if (builtIndex.includes("data:application/octet-stream;base64")) {
    fail("dist/index.html: инлайн data:application/octet-stream — источник ложного «сломан SW»");
  }
  // Ни одна ссылка собранного шелла не должна указывать в исходники.
  if (/(?:src|href)=["']\/src\//.test(builtIndex)) {
    fail("dist/index.html: ссылка на /src/* в собранном шелле — Vite не переписал тег");
  }
  ok("dist/index.html без octet-stream-инлайнов и ссылок на /src/*");
} else {
  warn("dist/index.html отсутствует — пропускаю проверку собранного шелла (запусти npm run build)");
}

const deployScriptPath = path.join(rootDir, "scripts", "deploy", "deploy.sh");
if (!fs.existsSync(deployScriptPath)) {
  fail("scripts/deploy/deploy.sh missing — тело deploy-sokratai обязано жить в репо (rule 95)");
}
const deploySource = fs.readFileSync(deployScriptPath, "utf8");
// Проверка ФОРМЫ КОДА — по строкам без shell-комментариев: шапка скрипта
// объясняет, ПОЧЕМУ `rm -rf /var/www` запрещён, и цитирует его дословно.
// Режем только цельные строки-комментарии (`^\s*#`), не инлайновые `#`, чтобы
// не задеть возможные `${VAR#pattern}`.
const deployCode = deploySource
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
// Запрет destructive-удаления докрута. Ловим и литеральный путь, и переменные:
// `rm -rf "$DOCROOT"` / `"$ASSETS"` разрушительны ровно так же (ревью 5.6 P2).
// Исключение — GC снапшотов (`$SNAPSHOTS`), он легитимен.
for (const line of deployCode.split("\n")) {
  if (!/\brm\s+-rf\b/.test(line)) continue;
  if (/\$\{?SNAPSHOTS\b/.test(line)) continue; // ротация снапшотов — ок
  if (/\/var\/www|\$\{?DOCROOT\b|\$\{?ASSETS\b/.test(line)) {
    fail(
      `scripts/deploy/deploy.sh: destructive «${line.trim()}» — удаление докрута/пула ассетов ` +
        "стирает старые hashed-assets и гарантирует белый экран каждому, у кого открыта вкладка через деплой",
    );
  }
}

// Инварианты ищем в КОДЕ, а не в исходнике целиком (ревью 5.6 P2: раньше
// использовался deploySource, и строки находились в шапке комментариев — удаление
// реального `--size-only` из rsync-команды давало ложный проход, воспроизведено).
const rsyncLines = deployCode.split("\n").filter((l) => /\brsync\b/.test(l));
const rsyncBlock = deployCode; // флаги могут быть на продолжении строки (\)
if (rsyncLines.length < 2) {
  fail(`scripts/deploy/deploy.sh: найдено ${rsyncLines.length} rsync-команд, ожидалось ≥2 (ассеты + корень)`);
}
for (const [needle, why] of [
  ["--size-only", "merge ассетов обязан быть append-only (content-addressed)"],
  ["--exclude='/.*'", "без исключения дотфайлов --delete съест /.well-known/acme-challenge (TLS)"],
  ["touch -c", "GC-keepalive: без touch текущего набора GC удалит живой react-vendor"],
  ["RETENTION СЛОМАН", "само-верификация retention (прошлый entry обязан отдавать 200)"],
  ["--delete", "замена корня обязана удалять исчезнувшие файлы"],
]) {
  if (!rsyncBlock.includes(needle)) {
    fail(`scripts/deploy/deploy.sh: потерян «${needle}» в КОДЕ (не в комментарии) — ${why}`);
  }
}
// `npm ci --prefer-offline` ЗАПРЕЩЁН: флаг берёт метаданные пакетов из кэша
// машины без ревалидации, поэтому деплой падает на версии, которая в реестре
// есть, а в кэше VPS ещё нет (`ETARGET notarget ... picomatch@4.0.5`,
// 2026-07-27 — третий оборванный деплой подряд). Детерминизм версий держит лок,
// а не кэш. Проверяем именно строку установки, чтобы не запретить флаг там, где
// он безобиден (напр. в комментарии-инструкции).
for (const line of deployCode.split("\n")) {
  if (!/\bnpm\s+ci\b/.test(line)) continue;
  if (/--prefer-offline/.test(line)) {
    fail(
      `scripts/deploy/deploy.sh: «${line.trim()}» — --prefer-offline у npm ci ЗАПРЕЩЁН: ` +
        "npm доверяет устаревшим метаданным кэша VPS и деплой падает ETARGET на существующей в реестре версии",
    );
  }
}
// Порядок «ассеты → корень»: merge пула обязан идти раньше замены корня, иначе
// новый index.html может сослаться на ещё не залитый чанк.
const assetsRsyncIdx = deployCode.indexOf("--size-only");
const rootRsyncIdx = deployCode.indexOf("--delete");
if (assetsRsyncIdx === -1 || rootRsyncIdx === -1 || assetsRsyncIdx > rootRsyncIdx) {
  fail("scripts/deploy/deploy.sh: нарушен порядок «ассеты → корень» (merge пула должен идти до --delete корня)");
}
// Lock обязан браться до git pull — либо в стабе (наследуется), либо здесь.
const stubPath = path.join(rootDir, "scripts", "deploy", "deploy-sokratai.stub.sh");
if (fs.existsSync(stubPath)) {
  const stubCode = fs.readFileSync(stubPath, "utf8")
    .split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  const lockIdx = stubCode.indexOf("flock");
  const pullIdx = stubCode.indexOf("git pull");
  if (lockIdx === -1 || pullIdx === -1 || lockIdx > pullIdx) {
    fail(
      "deploy-sokratai.stub.sh: flock обязан браться ДО git pull — иначе второй запуск " +
        "меняет рабочее дерево под сборкой первого (смешанный bundle со старым SHA)",
    );
  }
  if (!/--abbrev-ref HEAD/.test(stubCode) || !/status --porcelain/.test(stubCode)) {
    fail(
      "deploy-sokratai.stub.sh: нет проверки «чистый main» — `git pull --ff-only` " +
        "не проверяет ни имя ветки, ни чистоту дерева, и в прод уедет feature/dirty-код",
    );
  }
} else {
  warn("scripts/deploy/deploy-sokratai.stub.sh отсутствует — пропускаю проверку lock/branch-гардов");
}
const bashProbe = spawnSync("bash", ["-n", deployScriptPath], { cwd: rootDir, encoding: "utf8" });
const bashStderr = bashProbe.stderr ?? "";
// `bash -n` сообщает о синтаксисе с префиксом имени файла (`deploy.sh: line N:`).
// Если имени в stderr нет — упал не парсер, а сам интерпретатор: под Windows
// `bash` в PATH нередко оказывается WSL-заглушкой без дистрибутива
// (`execvpe(/bin/bash) failed`), и это давало ложный fail на корректном скрипте.
const bashRan = bashProbe.status === 0 || /deploy\.sh/.test(bashStderr);
if (bashProbe.error || !bashRan) {
  warn("bash недоступен (или это WSL-заглушка) — пропускаю синтаксическую проверку deploy.sh (на VPS её делает стаб)");
} else if (bashProbe.status !== 0) {
  console.error(bashStderr);
  fail("scripts/deploy/deploy.sh: синтаксическая ошибка (bash -n)");
}
ok("shell + deploy invariants pass (нет modulepreload /src/*, деплой сохраняет retention)");

// ── 22. Цепочка балла: best_earned_score во всех скоринговых SELECT'ах ──────
//
// ПРИЧИНА (2026-07-27, репорты Елены и Егора): в `handleGetResults` — SELECT'е,
// который кормит таблицу результатов репетитора — забыли `ai_help_events` и
// `best_earned_score`. Метрика самостоятельности приходила null И по задачам,
// И в агрегате, репетитор видел «—» там, где помощь фактически была; а балл в
// той же таблице считался по `earned_score` и разошёлся бы с экраном ученика
// при повторной, менее удачной сдаче. Правились 7 SELECT-листов, восьмой
// пропустили — руками этот класс ошибки не отлавливается.
//
// Инвариант: любой `.select(...)` по `homework_tutor_task_states`, который
// тянет `earned_score` (то есть участвует в скоринге), ОБЯЗАН тянуть и
// `best_earned_score` — оно стоит выше в цепочке `computeFinalScore`.
console.log("");
console.log("22. Score chain: best_earned_score во всех скоринговых SELECT'ах...");

// Явные исключения. Каждое — с причиной; расширять только вместе с обоснованием.
const SCORE_SELECT_ALLOWLIST = [
  // Pre-existing агрегат avg_score в handleListAssignments: суммирует сырой
  // earned_score без override и без цепочки computeFinalScore вообще. Его
  // неточность старше метрики и правится отдельной задачей.
  "thread_id, task_id, earned_score",
];

const scoreSelectFiles = [
  "supabase/functions/homework-api/index.ts",
  "supabase/functions/_shared/student-progress-build.ts",
  "supabase/functions/student-lessons-api/index.ts",
  "supabase/functions/admin-homework/index.ts",
];

let scoreSelectViolations = 0;
for (const relPath of scoreSelectFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    warn(`${relPath} отсутствует — пропускаю проверку цепочки балла`);
    continue;
  }
  const source = fs.readFileSync(fullPath, "utf8");
  // Ищем строковые литералы column-list'ов: они всегда содержат earned_score и
  // перечисление через запятую. UPDATE-вызовы сюда не попадают (там объект, не строка).
  const literals = source.match(/"[^"\n]*\bearned_score\b[^"\n]*"/g) ?? [];
  for (const literal of literals) {
    const columns = literal.slice(1, -1);
    // Только column-list'ы (перечисление), а не одиночные имена в других контекстах.
    if (!columns.includes(",")) continue;
    if (SCORE_SELECT_ALLOWLIST.includes(columns.trim())) continue;
    if (columns.includes("best_earned_score")) continue;
    scoreSelectViolations += 1;
    fail(
      `${relPath}: column-list с \`earned_score\` без \`best_earned_score\` → ` +
        `балл на этой поверхности разойдётся с остальными (цепочка computeFinalScore: ` +
        `override → best_earned_score → earned_score). Список: "${columns.slice(0, 120)}"`,
    );
  }
}
if (scoreSelectViolations === 0) {
  ok("score chain pass (все скоринговые SELECT'ы тянут best_earned_score)");
}

// ── 23. package-lock синхронизирован с package.json (2026-07-27) ────────────
//
// ПРИЧИНА: деплой на VPS упал на `npm ci` — лок разошёлся с package.json после
// добавления vitest (не хватало транзитивных `@emnapi/*`, а зафиксированная
// `@emnapi/wasi-threads@1.2.2` не удовлетворяла требуемую 1.2.3). До этого
// момента рассинхрон не ловился НИГДЕ: ни lint, ни build, ни тесты не читают
// лок построчно — `npm ci` единственный, кто сверяет его с package.json, и он
// запускается только на VPS внутри `deploy-sokratai`. То есть узнать о поломке
// можно было лишь оборванным деплоем.
//
// `--dry-run` ничего не пишет в node_modules: он ресолвит дерево и падает с
// EUSAGE при расхождении. Это ровно та же проверка, что делает деплой, только
// на 5 секунд и без последствий.
console.log("");
console.log("23. package-lock ↔ package.json (та же проверка, что npm ci на деплое)...");

if (process.env.SMOKE_SKIP_NPM_CI === "1") {
  warn("SMOKE_SKIP_NPM_CI=1 — пропускаю проверку лока (быстрый локальный прогон)");
} else {
  // Windows: с Node 20 прямой spawn `npm.cmd` отдаёт EINVAL (защита от
  // CVE-2024-27980), поэтому идём через shell — и ОДНОЙ строкой, иначе Node
  // ругается DEP0190 (args при shell:true не экранируются). Команда фиксированная,
  // пользовательского ввода в ней нет. На Linux (CI и VPS) — обычный spawn.
  const npmArgs = ["ci", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund"];
  const probeOptions = { cwd: rootDir, encoding: "utf8", timeout: 180_000 };
  const lockProbe = process.platform === "win32"
    ? spawnSync(`npm ${npmArgs.join(" ")}`, { ...probeOptions, shell: true })
    : spawnSync("npm", npmArgs, probeOptions);
  const probeOutput = `${lockProbe.stdout ?? ""}${lockProbe.stderr ?? ""}`;
  if (lockProbe.error) {
    // npm не найден / таймаут — это про окружение, а не про репозиторий.
    warn(`npm недоступен (${lockProbe.error.message}) — пропускаю проверку лока`);
  } else if (lockProbe.status === 0) {
    ok("package-lock синхронизирован (npm ci пройдёт на деплое)");
  } else if (/EUSAGE|can only install packages when your package\.json/.test(probeOutput)) {
    // ЕДИНСТВЕННЫЙ случай, где валим сборку: лок реально разошёлся.
    const details = probeOutput
      .split("\n")
      .filter((line) => /Missing:|Invalid:|Extraneous:/.test(line))
      .slice(0, 8)
      .map((line) => line.replace(/^npm\s+error\s+/, "  "))
      .join("\n");
    fail(
      "package-lock.json разошёлся с package.json — `npm ci` на деплое упадёт, " +
        "и деплой оборвётся до касания прода.\n" +
        (details ? `${details}\n` : "") +
        "  Починить: npm install --package-lock-only && git add package-lock.json",
    );
  } else {
    // Сеть, реестр, права — не наша проверка, не блокируем прогон.
    warn(
      `npm ci --dry-run завершился с кодом ${lockProbe.status} без EUSAGE ` +
        "(похоже на сетевую/реестровую ошибку) — рассинхрон лока не подтверждён",
    );
  }
}

console.log("");
console.log("=== Smoke Check Complete ===");
