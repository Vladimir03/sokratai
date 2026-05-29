#!/usr/bin/env node
// PreToolUse(Bash) gate for SokratAI.
// Blocks `git commit` when staged CLIENT code (src/**) introduces the RU-blocked
// direct Supabase domain, builds it from VITE_SUPABASE_* env, or imports the
// forbidden @/integrations/supabase/client. Such a change breaks sokratai.ru for
// ALL Russian users. See AGENTS.md -> "CRITICAL - Network & RU bypass".
//
// Scope: src/** only (server-side edge functions legitimately use *.supabase.co
// via rewriteToDirect, so they are intentionally NOT checked). Comment lines are
// skipped. Fails OPEN on any error so it never blocks unrelated work.
import { execSync } from "node:child_process";

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  if (!/git\s+commit\b/.test(cmd)) process.exit(0);

  let diff = "";
  try {
    diff = execSync("git diff --cached --unified=0 -- src", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    process.exit(0);
  }

  const BANNED =
    /@\/integrations\/supabase\/client|vrsseotrfmsxpbciyqzc\.supabase\.co|VITE_SUPABASE_(URL|PROJECT_ID)/;

  const offending = diff.split("\n").filter((line) => {
    if (!line.startsWith("+") || line.startsWith("+++")) return false;
    const code = line.slice(1).trimStart();
    if (
      code.startsWith("//") ||
      code.startsWith("*") ||
      code.startsWith("/*") ||
      code.startsWith("#")
    )
      return false;
    return BANNED.test(line);
  });

  if (offending.length > 0) {
    console.error(
      "BLOCKED: client code must use `supabase` from @/lib/supabaseClient (https://api.sokratai.ru).",
    );
    console.error(
      "Never hardcode *.supabase.co, build it from VITE_SUPABASE_*, or import @/integrations/supabase/client.",
    );
    console.error(
      "This breaks sokratai.ru for ALL RU users. See AGENTS.md -> CRITICAL - Network & RU bypass.",
    );
    console.error("Offending staged lines (src/):");
    offending.slice(0, 12).forEach((l) => console.error("  " + l.trim()));
    process.exit(2);
  }
  process.exit(0);
});
