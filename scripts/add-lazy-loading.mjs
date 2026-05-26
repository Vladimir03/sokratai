#!/usr/bin/env node
/**
 * One-shot codemod: добавить loading="lazy" ко всем <img> без него.
 *
 * EXCLUDE files (always-above-the-fold brand logos):
 * - src/components/tutor/chrome/SideNav.tsx
 * - src/components/tutor/chrome/MobileTopBar.tsx
 * - src/components/sections/tutor/TutorLandingHeader.tsx
 *
 * Pattern: matches `<img` followed by anything UP TO the closing `>` or `/>`.
 * Skip if `loading=` already present.
 *
 * Run: node scripts/add-lazy-loading.mjs
 * Done once for Phase 0 TASK-4 (2026-05-26). Не commit'ить в repo
 * долгосрочно — это разовое преобразование.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "glob";
import path from "node:path";

const EXCLUDE_PATHS = new Set([
  "src/components/tutor/chrome/SideNav.tsx",
  "src/components/tutor/chrome/MobileTopBar.tsx",
  "src/components/sections/tutor/TutorLandingHeader.tsx",
]);

const files = globSync("src/**/*.{tsx,jsx}", { posix: true });

let totalAdded = 0;
let filesChanged = 0;
const perFileStats = [];

for (const file of files) {
  if (EXCLUDE_PATHS.has(file)) {
    console.log(`SKIP (above-the-fold): ${file}`);
    continue;
  }
  const original = readFileSync(file, "utf8");
  // Match <img ...> or <img ... /> blocks. Multiline-safe.
  // We then check inside the match whether loading= is already present.
  let added = 0;
  const transformed = original.replace(/<img\b([^>]*?)(\/?>)/g, (match, attrs, closing) => {
    if (/\bloading\s*=/.test(attrs)) {
      return match; // already has loading attr
    }
    added++;
    // Insert loading="lazy" right after <img
    const newAttrs = ` loading="lazy"${attrs}`;
    return `<img${newAttrs}${closing}`;
  });
  if (added > 0) {
    writeFileSync(file, transformed, "utf8");
    totalAdded += added;
    filesChanged++;
    perFileStats.push({ file, added });
  }
}

perFileStats
  .sort((a, b) => b.added - a.added)
  .forEach(({ file, added }) => console.log(`+${added.toString().padStart(2)}  ${file}`));

console.log(`---`);
console.log(`Files changed: ${filesChanged}`);
console.log(`Total <img> updated: ${totalAdded}`);
