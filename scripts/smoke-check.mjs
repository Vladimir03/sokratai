#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

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

requireContains(
  path.join(rootDir, "src", "components", "TutorTelegramLoginButton.tsx"),
  'JSON.stringify({ intended_role: "tutor" })',
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
console.log("=== Smoke Check Complete ===");
