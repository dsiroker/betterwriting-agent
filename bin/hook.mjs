#!/usr/bin/env node
// Claude Code hook entry. Usage: node hook.mjs <message-display|pre-tool-use>  (hook JSON on stdin)
// Fail open: every failure path prints nothing and exits 0.
import fs from "node:fs";
import {
  loadConfig, saveConfig, log, rewrite, isProsePath, splitFrontmatter, frontmatterOff,
  maxProseBlockWords, totalWords, sentenceCount, wrapWhitespace, trialExhausted, today, readStdin,
  MIN_PROSE_WORDS, MAX_WORDS, NOTICE,
} from "../lib/core.mjs";

const event = process.argv[2];
const started = Date.now();
const GUARD_MS = event === "pre-tool-use" ? 110000 : 55000; // stay under the hooks.json timeouts
const guard = setTimeout(() => process.exit(0), GUARD_MS);
guard.unref?.();

const emit = (obj) => { process.stdout.write(JSON.stringify(obj) + "\n"); };
const done = (status, bytes = 0) => { log({ event, bytes, ms: Date.now() - started, status }); };

async function messageDisplay(input, cfg) {
  const delta = typeof input.delta === "string" ? input.delta : "";
  const bytes = Buffer.byteLength(delta);
  if (!cfg.enabled || !cfg.responses) return done("skip:off", bytes);
  if (trialExhausted(cfg)) {
    if (input.final && cfg.trial.notice_shown_at !== today()) {
      cfg.trial.notice_shown_at = today();
      saveConfig(cfg);
      emit({ hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: delta.replace(/\s*$/, "") + "\n\n" + NOTICE + "\n" } });
      return done("notice", bytes);
    }
    return done("skip:exhausted", bytes);
  }
  if (maxProseBlockWords(delta) < MIN_PROSE_WORDS) return done("skip:short", bytes);
  if (totalWords(delta) > MAX_WORDS) return done("skip:long", bytes);
  const r = await rewrite(cfg, delta, { ms: 45000 });
  if (r.status === 402) {
    if (input.final && cfg.trial?.notice_shown_at !== today()) {
      cfg.trial.notice_shown_at = today();
      saveConfig(cfg);
      emit({ hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: delta.replace(/\s*$/, "") + "\n\n" + NOTICE + "\n" } });
      return done("402:notice", bytes);
    }
    return done("402", bytes);
  }
  if (r.status !== 200 || !r.text) return done(`err:${r.status}`, bytes);
  emit({ hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: wrapWhitespace(delta, r.text) } });
  return done("ok", bytes);
}

async function preToolUse(input, cfg) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  if (tool !== "Write" && tool !== "Edit") return done("skip:tool");
  if (!cfg.enabled || !cfg.artifacts) return done("skip:off");
  if (trialExhausted(cfg)) return done("skip:exhausted");
  if (!isProsePath(ti.file_path)) return done("skip:path");

  if (tool === "Write") {
    const content = typeof ti.content === "string" ? ti.content : "";
    const bytes = Buffer.byteLength(content);
    const { front, body } = splitFrontmatter(content);
    if (frontmatterOff(front)) return done("skip:fm-off", bytes);
    if (maxProseBlockWords(body) < MIN_PROSE_WORDS) return done("skip:short", bytes);
    if (totalWords(body) > MAX_WORDS) return done("skip:long", bytes);
    const r = await rewrite(cfg, body, { ms: 100000 });
    if (r.status !== 200 || !r.text) return done(`err:${r.status}`, bytes);
    const out = front + wrapWhitespace(body, r.text);
    if (out === content) return done("skip:same", bytes);
    emit({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...ti, content: out } } });
    return done("ok", bytes);
  }

  const ns = typeof ti.new_string === "string" ? ti.new_string : "";
  const bytes = Buffer.byteLength(ns);
  try {
    const existing = fs.readFileSync(ti.file_path, "utf8");
    if (frontmatterOff(splitFrontmatter(existing).front)) return done("skip:fm-off", bytes);
  } catch {}
  if (frontmatterOff(splitFrontmatter(ns).front)) return done("skip:fm-off", bytes);
  if (sentenceCount(ns) < 2) return done("skip:sentences", bytes);
  if (totalWords(ns) > MAX_WORDS) return done("skip:long", bytes);
  const r = await rewrite(cfg, ns, { ms: 100000 });
  if (r.status !== 200 || !r.text) return done(`err:${r.status}`, bytes);
  const out = wrapWhitespace(ns, r.text);
  if (out === ns) return done("skip:same", bytes);
  emit({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...ti, new_string: out } } });
  return done("ok", bytes);
}

(async () => {
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw || "{}");
    const cfg = loadConfig();
    if (event === "message-display") await messageDisplay(input, cfg);
    else if (event === "pre-tool-use") await preToolUse(input, cfg);
    else done("skip:event");
  } catch (e) {
    done(`err:${(e && (e.name === "AbortError" ? "timeout" : e.code || e.name)) || "unknown"}`);
  }
  process.exit(0);
})();
