#!/usr/bin/env node
/**
 * Repoints the deployed app at a new backend URL.
 *
 * Quick tunnels get a fresh hostname on every cloudflared restart, and the URL
 * is baked in at build time, so each restart otherwise means hand-editing two
 * files, committing, and pushing. This does all of it in one command.
 *
 *   npm run set-tunnel -- https://new-host.trycloudflare.com
 *   npm run set-tunnel -- https://new-host.trycloudflare.com --push
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ENV_FILES = [".env.production", ".env.production.local"];
const KEY = "VITE_API_BASE_URL";

const args = process.argv.slice(2);
const push = args.includes("--push");
const rawUrl = args.find((arg) => !arg.startsWith("--"));

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!rawUrl) {
  fail("Usage: npm run set-tunnel -- <url> [--push]");
}

let url;
try {
  url = new URL(rawUrl);
} catch {
  fail(`Not a valid URL: ${rawUrl}`);
}
if (!/^https?:$/.test(url.protocol)) fail(`Expected http(s), got ${url.protocol}`);

// Trailing slashes would produce "//health" once the client appends its paths.
const base = url.origin;

console.log(`\n  Checking ${base}/health ...`);
let health;
try {
  const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) fail(`Health check returned ${response.status}. Is the tunnel pointed at the model server?`);
  health = await response.json();
} catch (error) {
  fail(`Could not reach ${base}/health — ${error.message}`);
}

if (!health.model_loaded) fail(`Reached the server, but model_loaded is false.`);
console.log(`  OK — ${health.model_id}\n`);

for (const file of ENV_FILES) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  const after = before.replace(new RegExp(`^${KEY}=.*$`, "m"), `${KEY}=${base}`);
  if (before === after) {
    console.log(`  ${file}: unchanged`);
  } else {
    writeFileSync(file, after);
    console.log(`  ${file}: updated`);
  }
}

if (!push) {
  console.log(`\n  Not pushed. Review, then:\n    git commit -am "Point at the current quick tunnel" && git push\n`);
  process.exit(0);
}

console.log("\n  Committing and pushing ...");
execSync(`git add ${ENV_FILES.join(" ")}`, { stdio: "inherit" });
execSync(`git commit -m "Point at the current quick tunnel"`, { stdio: "inherit" });
execSync("git push", { stdio: "inherit" });
console.log("\n  Pushed. Netlify redeploys in ~30s.\n");
