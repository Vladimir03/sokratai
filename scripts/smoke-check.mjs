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

// ─── 7. Humanities subjects mirror sync (Phase 7 round 2, 2026-05-20) ──────
console.log("7. Humanities subjects mirror sync invariant...");

const HUMANITIES_REQUIRED = ["russian", "rus", "literature", "english", "french", "spanish"];

const humanitiesMirrors = [
  {
    label: "supabase/functions/_shared/subject-rubrics/index.ts::HUMANITIES_SUBJECTS",
    path: "supabase/functions/_shared/subject-rubrics/index.ts",
    pattern: /export const HUMANITIES_SUBJECTS = new Set<string>\(\[([^\]]+)\]\)/,
  },
  {
    label: "src/lib/subjectHelpers.ts::HUMANITIES_WRITING_SUBJECTS",
    path: "src/lib/subjectHelpers.ts",
    pattern: /const HUMANITIES_WRITING_SUBJECTS = new Set<string>\(\[([^\]]+)\]\)/,
  },
  {
    label: "src/components/homework/GuidedChatMessage.tsx::HUMANITIES_WRITING_SUBJECTS",
    path: "src/components/homework/GuidedChatMessage.tsx",
    pattern: /const HUMANITIES_WRITING_SUBJECTS = new Set\(\[([^\]]+)\]\)/,
  },
];

// Phase 7 round 3 polish (2026-05-20, ChatGPT-5.5 review P2 #1):
// Parse all 3 mirrors → check baseline coverage AND pairwise equality.
// Раньше только верифицировал что HUMANITIES_REQUIRED ⊆ each set, но
// extras в одном set но не в других проходили silently. Теперь — extras
// flagged тоже.
const declaredSets = new Map(); // label → sorted unique members array
for (const mirror of humanitiesMirrors) {
  const fullPath = path.resolve(rootDir, mirror.path);
  if (!fs.existsSync(fullPath)) {
    fail(`${mirror.path} is missing — required for humanities mirror invariant`);
    continue;
  }
  const content = fs.readFileSync(fullPath, "utf8");
  const match = content.match(mirror.pattern);
  if (!match) {
    fail(`${mirror.label}: pattern not found — refactor may have broken the set declaration`);
    continue;
  }
  // Extract все quoted strings (single / double) внутри set body — игнорирует
  // inline comments типа `"rus", // legacy`.
  const declared = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  const missing = HUMANITIES_REQUIRED.filter((req) => !declared.includes(req));
  if (missing.length > 0) {
    fail(`${mirror.label} missing required subjects: ${missing.join(", ")}`);
  } else {
    ok(`${mirror.label} contains all required humanities subjects`);
  }
  declaredSets.set(mirror.label, [...new Set(declared)].sort());
}

// Pairwise equality check — catches extras добавленные в один mirror но
// не в другие. Example failure: someone добавил `german` в backend set,
// не обновил frontend → smoke fail с явным сообщением о diff.
if (declaredSets.size >= 2) {
  const entries = [...declaredSets.entries()];
  const [refLabel, refMembers] = entries[0];
  const refJoined = refMembers.join(",");
  let allMatch = true;
  for (let i = 1; i < entries.length; i++) {
    const [otherLabel, otherMembers] = entries[i];
    if (otherMembers.join(",") !== refJoined) {
      const onlyInRef = refMembers.filter((m) => !otherMembers.includes(m));
      const onlyInOther = otherMembers.filter((m) => !refMembers.includes(m));
      fail(
        `Humanities mirror sets differ between\n` +
          `    ${refLabel} (${refMembers.length} members)\n` +
          `    ${otherLabel} (${otherMembers.length} members)\n` +
          `    only in first: [${onlyInRef.join(", ") || "—"}]\n` +
          `    only in second: [${onlyInOther.join(", ") || "—"}]\n` +
          `  Sync all 3 mirrors when adding/removing humanities subjects.`,
      );
      allMatch = false;
    }
  }
  if (allMatch) {
    ok(`All 3 humanities mirror sets are pairwise-equal (${refMembers.length} members)`);
  }
}

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

console.log("");
console.log("=== Smoke Check Complete ===");
