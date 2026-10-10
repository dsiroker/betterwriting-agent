#!/usr/bin/env node
// Merge our Codex hooks into ~/.codex/hooks.json without touching other hooks. Idempotent.
// Usage: node merge-hooks.mjs <ours.json> <target.json> <bw_home>
import fs from "node:fs";
import path from "node:path";

const [oursPath, targetPath, bwHome] = process.argv.slice(2);
const ours = JSON.parse(fs.readFileSync(oursPath, "utf8").replaceAll("__BW_HOME__", bwHome));
let target = { hooks: {} };
try { target = JSON.parse(fs.readFileSync(targetPath, "utf8")); } catch {}
if (!target || typeof target !== "object") target = {};
if (!target.hooks || typeof target.hooks !== "object") target.hooks = {};

const isOurs = (h) => typeof h?.command === "string" && h.command.includes("codex-hook.mjs");
for (const [event, groups] of Object.entries(ours.hooks)) {
  const existing = Array.isArray(target.hooks[event]) ? target.hooks[event] : [];
  const kept = existing
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length);
  target.hooks[event] = [...kept, ...groups];
}
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n");
console.log(`merged Better Writing hooks into ${targetPath}`);
