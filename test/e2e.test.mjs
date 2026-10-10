import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, "..", "bin", "hook.mjs");
const CODEX = path.join(here, "..", "bin", "codex-hook.mjs");
const BW = path.join(here, "..", "bin", "bw.mjs");
const NOTICE = "Better Writing trial used up. Keep going: https://betterwriting.ai/keys";

let mock, home;
const cfgPath = () => path.join(home, "config.json");
const readCfg = () => JSON.parse(fs.readFileSync(cfgPath(), "utf8"));
const writeCfg = (extra = {}) => fs.writeFileSync(cfgPath(), JSON.stringify({ endpoint: mock.url, voice: "pg", enabled: true, responses: true, artifacts: true, ...extra }));
const logLines = () => { try { return fs.readFileSync(path.join(home, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };

function run(script, args, input, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, BETTERWRITING_HOME: home, BETTERWRITING_TIMEOUT_MS: "1500", ...env } });
    let out = "", err = "";
    p.stdout.on("data", (c) => { out += c; });
    p.stderr.on("data", (c) => { err += c; });
    p.on("close", (code) => resolve({ code, out, err, ms: Date.now() - t0, json: out.trim().startsWith("{") ? JSON.parse(out) : null }));
    if (input !== undefined) p.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}
const md = (delta, extra = {}) => ({ session_id: "s", transcript_path: "/t", cwd: "/c", hook_event_name: "MessageDisplay", turn_id: "t1", message_id: "m1", index: 0, final: false, delta, ...extra });
const pre = (tool_name, tool_input) => ({ session_id: "s", transcript_path: "/t", cwd: "/c", hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "toolu_1" });

const LONG = "This is a long paragraph of prose with clearly more than twelve words in it, so the hook should send it.\n";
const SHORT = "Just a few words here.\n";

before(async () => { mock = await startMock(); });
after(async () => { await mock.close(); });
beforeEach(() => {
  if (home) fs.rmSync(home, { recursive: true, force: true });
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bw-e2e-"));
  mock.reset();
  writeCfg();
});

test("message-display rewrites a long delta and mints a trial key first", async () => {
  const r = await run(HOOK, ["message-display"], md(LONG));
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: "[pg] " + LONG } });
  assert.equal(mock.requests[0].url, "/api/v1/trial");
  assert.match(mock.requests[0].body.device, /^[0-9a-f]{64}$/);
  assert.equal(mock.requests[1].url, "/api/v1/rewrite");
  assert.deepEqual(mock.requests[1].body, { voice: "pg", text: LONG, mode: "markdown" });
  assert.match(mock.requests[1].auth, /^Bearer bw_trial_\*\*\*$/);
  assert.match(readCfg().api_key, /^bw_trial_/);
  const l = logLines();
  assert.equal(l.length, 1);
  assert.equal(l[0].event, "message-display");
  assert.equal(l[0].status, "ok");
  assert.equal(l[0].bytes, Buffer.byteLength(LONG));
  assert.equal(typeof l[0].ms, "number");
  assert.equal(JSON.stringify(l).includes("paragraph"), false);
});

test("message-display reuses the stored key", async () => {
  writeCfg({ api_key: "bw_live_abcdefghijklmnop" });
  const r = await run(HOOK, ["message-display"], md(LONG));
  assert.equal(r.json.hookSpecificOutput.displayContent, "[pg] " + LONG);
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].auth, "Bearer bw_live_***");
});

test("message-display skips short deltas and code-only deltas", async () => {
  for (const d of [SHORT, "```js\nconst a = 1; const b = 2; const c = 3; const d = 4; const e = 5; const f = 6;\n```\n", ""]) {
    const r = await run(HOOK, ["message-display"], md(d));
    assert.equal(r.out, "", d);
  }
  assert.equal(mock.requests.length, 0);
  assert.equal(logLines().every((l) => l.status === "skip:short"), true);
});

test("message-display respects responses off and the master switch", async () => {
  writeCfg({ responses: false });
  assert.equal((await run(HOOK, ["message-display"], md(LONG))).out, "");
  writeCfg({ enabled: false });
  assert.equal((await run(HOOK, ["message-display"], md(LONG))).out, "");
  assert.equal(mock.requests.length, 0);
});

test("fails open on 500", async () => {
  writeCfg({ api_key: "bw_live_abcdefghijklmnop" });
  mock.setMode("500");
  const r = await run(HOOK, ["message-display"], md(LONG));
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.equal(logLines().at(-1).status, "err:500");
  writeCfg();
  const r2 = await run(HOOK, ["message-display"], md(LONG));
  assert.equal(r2.code, 0); assert.equal(r2.out, "");
  assert.equal(logLines().at(-1).status, "err:trial-500");
});

test("fails open when the server hangs, within the client timeout", async () => {
  mock.setMode("hang");
  const r = await run(HOOK, ["message-display"], md(LONG), { BETTERWRITING_TIMEOUT_MS: "400" });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.ok(r.ms < 3000, `took ${r.ms} ms`);
  assert.equal(logLines().at(-1).status, "err:timeout");
});

test("fails open when the endpoint is unreachable or stdin is garbage", async () => {
  writeCfg({ endpoint: "http://127.0.0.1:1" });
  let r = await run(HOOK, ["message-display"], md(LONG));
  assert.equal(r.code, 0); assert.equal(r.out, "");
  assert.match(logLines().at(-1).status, /^err:/);
  writeCfg();
  r = await run(HOOK, ["message-display"], "not json at all");
  assert.equal(r.code, 0); assert.equal(r.out, "");
  r = await run(HOOK, ["bogus-event"], md(LONG));
  assert.equal(r.code, 0); assert.equal(r.out, "");
});

test("402: records exhaustion, appends the notice once per day on the final batch only", async () => {
  writeCfg({ api_key: "bw_trial_xyzxyzxyzxyz" });
  mock.setMode("402");
  let r = await run(HOOK, ["message-display"], md(LONG, { final: false }));
  assert.equal(r.out, "");
  assert.ok(readCfg().trial.exhausted_at);
  r = await run(HOOK, ["message-display"], md(LONG, { final: true, index: 3 }));
  assert.deepEqual(r.json, { hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent: LONG.trimEnd() + "\n\n" + NOTICE + "\n" } });
  assert.equal(readCfg().trial.notice_shown_at, new Date().toISOString().slice(0, 10));
  r = await run(HOOK, ["message-display"], md(LONG, { final: true }));
  assert.equal(r.out, "", "notice shows once per day");
  assert.equal(mock.requests.filter((q) => q.url === "/api/v1/rewrite").length, 1, "no further API calls once exhausted");
  const pr = await run(HOOK, ["pre-tool-use"], pre("Write", { file_path: "/tmp/x.md", content: LONG }));
  assert.equal(pr.out, "");
  assert.equal(logLines().at(-1).status, "skip:exhausted");
});

test("409 on trial mint counts as exhausted; login clears it", async () => {
  mock.setMode("402");
  const r = await run(HOOK, ["message-display"], md(LONG, { final: true }));
  assert.ok(readCfg().trial.exhausted_at);
  assert.match(r.json.hookSpecificOutput.displayContent, /trial used up/);
  mock.setMode("ok");
  const l = await run(BW, ["login", "bw_live_0123456789abcdef"]);
  assert.match(l.out, /Key saved/);
  assert.equal(l.out.includes("0123456789abcdef"), false, "never prints the key");
  assert.equal(readCfg().trial.exhausted_at, undefined);
  const r2 = await run(HOOK, ["message-display"], md(LONG));
  assert.equal(r2.json.hookSpecificOutput.displayContent, "[pg] " + LONG);
});

test("pre-tool-use Write: rewrites body, keeps frontmatter, returns full input", async () => {
  const content = "---\ntitle: Plan\ntags: [a, b]\n---\n\n# Plan\n\n" + LONG + "\n```\ncode block with a great many words that must never be touched by anyone\n```\n";
  const r = await run(HOOK, ["pre-tool-use"], pre("Write", { file_path: "/repo/docs/plan.md", content }));
  assert.deepEqual(r.json, { hookSpecificOutput: { hookEventName: "PreToolUse",
    updatedInput: { file_path: "/repo/docs/plan.md", content: content.replace(LONG, "[pg] " + LONG) } } });
  const sent = mock.requests.find((q) => q.url === "/api/v1/rewrite").body;
  assert.equal(sent.mode, "markdown");
  assert.equal(sent.text.startsWith("---"), false, "frontmatter stripped before sending");
  assert.equal(sent.text, "\n# Plan\n\n" + LONG + "\n```\ncode block with a great many words that must never be touched by anyone\n```\n");
});

test("pre-tool-use Write: skips non-prose paths, CLAUDE.md, betterwriting: off, short bodies, artifacts off", async () => {
  const cases = [
    ["/repo/src/index.js", LONG, "skip:path"],
    ["/repo/CLAUDE.md", LONG, "skip:path"],
    ["/repo/docs/plan.md", "---\nbetterwriting: off\n---\n" + LONG, "skip:fm-off"],
    ["/repo/docs/plan.md", SHORT, "skip:short"],
  ];
  for (const [file_path, content, status] of cases) {
    const r = await run(HOOK, ["pre-tool-use"], pre("Write", { file_path, content }));
    assert.equal(r.out, "", file_path);
    assert.equal(logLines().at(-1).status, status);
  }
  writeCfg({ artifacts: false });
  assert.equal((await run(HOOK, ["pre-tool-use"], pre("Write", { file_path: "/repo/README.md", content: LONG }))).out, "");
  assert.equal(mock.requests.length, 0);
});

test("pre-tool-use Edit: needs two sentences, rewrites new_string, keeps other fields", async () => {
  const one = "Fix the bug in the parser so that long lines are handled correctly every time.";
  let r = await run(HOOK, ["pre-tool-use"], pre("Edit", { file_path: "/repo/README.md", old_string: "a", new_string: one, replace_all: false }));
  assert.equal(r.out, "");
  assert.equal(logLines().at(-1).status, "skip:sentences");
  const two = "Fix the bug in the parser so that long lines are handled correctly. Then run the tests again to be sure.\n";
  r = await run(HOOK, ["pre-tool-use"], pre("Edit", { file_path: "/repo/README.md", old_string: "a", new_string: two, replace_all: true }));
  assert.deepEqual(r.json, { hookSpecificOutput: { hookEventName: "PreToolUse",
    updatedInput: { file_path: "/repo/README.md", old_string: "a", new_string: "[pg] " + two, replace_all: true } } });
});

test("pre-tool-use Edit: honors betterwriting: off in the existing file", async () => {
  const file = path.join(home, "off.md");
  fs.writeFileSync(file, "---\nbetterwriting: off\n---\nbody\n");
  const r = await run(HOOK, ["pre-tool-use"], pre("Edit", { file_path: file, old_string: "body", new_string: "Fix the bug in the parser. Then run the tests again to be sure.\n" }));
  assert.equal(r.out, "");
  assert.equal(logLines().at(-1).status, "skip:fm-off");
});

test("pre-tool-use fails open on 500 and on other tools", async () => {
  mock.setMode("500");
  let r = await run(HOOK, ["pre-tool-use"], pre("Write", { file_path: "/repo/README.md", content: LONG }));
  assert.equal(r.code, 0); assert.equal(r.out, "");
  mock.setMode("ok");
  r = await run(HOOK, ["pre-tool-use"], pre("Bash", { command: "echo " + LONG }));
  assert.equal(r.out, "");
});

test("codex hook rewrites touched prose files on disk and leaves code alone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-codex-"));
  fs.writeFileSync(path.join(dir, "notes.md"), "---\nx: 1\n---\n" + LONG);
  fs.writeFileSync(path.join(dir, "a.js"), "// " + LONG);
  fs.writeFileSync(path.join(dir, "off.md"), "---\nbetterwriting: off\n---\n" + LONG);
  const patch = "*** Begin Patch\n*** Update File: notes.md\n*** Update File: a.js\n*** Update File: off.md\n*** End Patch";
  const r = await run(CODEX, [], { session_id: "s", cwd: dir, hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: { command: patch }, tool_response: {} });
  assert.equal(r.code, 0); assert.equal(r.out, "");
  assert.equal(fs.readFileSync(path.join(dir, "notes.md"), "utf8"), "---\nx: 1\n---\n[pg] " + LONG);
  assert.equal(fs.readFileSync(path.join(dir, "a.js"), "utf8"), "// " + LONG);
  assert.equal(fs.readFileSync(path.join(dir, "off.md"), "utf8"), "---\nbetterwriting: off\n---\n" + LONG);
  const r2 = await run(CODEX, [], { cwd: dir, tool_name: "Bash", tool_input: { command: "echo hi > out.txt" } });
  assert.equal(r2.out, "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("bw.mjs: status, set validates against /voices, toggles, logout, test", async () => {
  let r = await run(BW, ["status"]);
  assert.match(r.out, /voice: pg/);
  assert.match(r.out, /key: none/);
  r = await run(BW, ["set", "nope"]);
  assert.match(r.out, /Unknown voice "nope". Available: pg \(Paul Graham\)/);
  r = await run(BW, ["pg"]);
  assert.match(r.out, /Voice set to Paul Graham \(pg\)/);
  r = await run(BW, ["responses", "off"]);
  assert.equal(readCfg().responses, false);
  r = await run(BW, ["artifacts", "off"]);
  assert.equal(readCfg().artifacts, false);
  r = await run(BW, ["off"]);
  assert.equal(readCfg().enabled, false);
  r = await run(BW, ["on"]);
  assert.equal(readCfg().enabled, true);
  r = await run(BW, ["test"]);
  assert.match(r.out, /BEFORE\n[\s\S]+AFTER \(pg, \d+ ms\)\n\[pg\] We are pleased/);
  assert.match(readCfg().api_key, /^bw_trial_/);
  r = await run(BW, ["status"]);
  assert.match(r.out, /key: trial key \(bw_trial_\.\.\.\)/);
  assert.equal(r.out.includes(readCfg().api_key), false);
  r = await run(BW, ["logout"]);
  assert.equal(readCfg().api_key, undefined);
  r = await run(BW, ["login", "garbage"]);
  assert.match(r.out, /Usage/);
});
