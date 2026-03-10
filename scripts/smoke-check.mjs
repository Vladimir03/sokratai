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
console.log("=== Smoke Check Complete ===");
