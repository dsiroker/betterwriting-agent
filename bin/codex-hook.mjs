#!/usr/bin/env node
// Codex PostToolUse hook. Rewrites prose files (.md .mdx .txt .rst, docs/) touched by apply_patch or a shell command,
// in place on disk, in markdown mode. Artifacts only: Codex has no display hook, so responses are not rewritten.
// Fail open: prints nothing, exits 0.
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig, log, rewrite, isProsePath, splitFrontmatter, frontmatterOff, maxProseBlockWords, totalWords,
  wrapWhitespace, trialExhausted, readStdin, MIN_PROSE_WORDS, MAX_WORDS,
} from "../lib/core.mjs";

const started = Date.now();
const guard = setTimeout(() => process.exit(0), 110000);
guard.unref?.();
const done = (status, bytes = 0, extra = {}) => log({ event: "codex-post-tool-use", bytes, ms: Date.now() - started, status, ...extra });

// Paths named by an apply_patch body: "*** Add File: p", "*** Update File: p", "*** Move to: p".
export function patchPaths(patch) {
  const out = [];
  for (const m of String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+?)\s*$/gm)) out.push(m[1].trim());
  return out;
}

// Best effort: files a shell command writes via redirection or tee.
export function shellPaths(cmd) {
  const s = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
  const out = [];
  for (const m of s.matchAll(/(?:>>?|\btee\s+(?:-a\s+)?)\s*['"]?([^\s'"|;&<>]+\.(?:md|mdx|markdown|txt|rst))['"]?/gi)) out.push(m[1]);
  return out;
}

export function touchedPaths(input) {
  const ti = input.tool_input || {};
  const name = String(input.tool_name || "");
  const cmd = ti.command ?? ti.patch ?? ti.input ?? "";
  if (name === "apply_patch" || /\*\*\* Begin Patch/.test(String(cmd))) return patchPaths(cmd);
  return shellPaths(cmd);
}

async function rewriteFile(cfg, file) {
  let content;
  try { content = fs.readFileSync(file, "utf8"); } catch { return done("skip:unreadable", 0, { file: path.basename(file).length }); }
  const bytes = Buffer.byteLength(content);
  const { front, body } = splitFrontmatter(content);
  if (frontmatterOff(front)) return done("skip:fm-off", bytes);
  if (maxProseBlockWords(body) < MIN_PROSE_WORDS) return done("skip:short", bytes);
  if (totalWords(body) > MAX_WORDS) return done("skip:long", bytes);
  const r = await rewrite(cfg, body, { ms: 100000 });
  if (r.status !== 200 || !r.text) return done(`err:${r.status}`, bytes);
  const out = front + wrapWhitespace(body, r.text);
  if (out === content) return done("skip:same", bytes);
  // Only write if the file is unchanged since we read it.
  try { if (fs.readFileSync(file, "utf8") !== content) return done("skip:changed", bytes); } catch {}
  fs.writeFileSync(file, out);
  return done("ok", bytes);
}

async function main() {
  try {
    const input = JSON.parse((await readStdin()) || "{}");
    const cfg = loadConfig();
    if (!cfg.enabled || !cfg.artifacts) return done("skip:off");
    if (trialExhausted(cfg)) return done("skip:exhausted");
    const cwd = input.cwd || process.cwd();
    const seen = new Set();
    for (const p of touchedPaths(input)) {
      const abs = path.resolve(cwd, p);
      if (seen.has(abs) || !isProsePath(abs)) continue;
      seen.add(abs);
      await rewriteFile(cfg, abs);
    }
    if (!seen.size) done("skip:none");
  } catch (e) {
    done(`err:${(e && (e.name === "AbortError" ? "timeout" : e.code || e.name)) || "unknown"}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(() => process.exit(0), () => process.exit(0));
}
