#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "supabase", "config.toml");
const functionsDir = path.join(root, "supabase", "functions");
const workflowPath = path.join(root, ".github", "workflows", "deploy-supabase-functions.yml");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function listFunctionDirs(dirPath) {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
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
  const regex = /supabase functions deploy\s+([a-z0-9-]+)(?:\s+--no-verify-jwt)?/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const full = match[0];
    const name = match[1];
    map.set(name, full.includes("--no-verify-jwt"));
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
  console.log("");
  console.log(`only in config:        ${fmtList(onlyInConfig)}`);
  console.log(`only in functions dir: ${fmtList(onlyInDirs)}`);
  console.log(`deploy not in config:  ${fmtList(deployNotInConfig)}`);
  console.log(`deploy not in dir:     ${fmtList(deployNotInDirs)}`);
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
