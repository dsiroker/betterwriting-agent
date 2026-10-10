import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isProsePath, splitFrontmatter, frontmatterOff, maxProseBlockWords, sentenceCount, wrapWhitespace,
  loadConfig, DEFAULTS, configPath, deviceId,
} from "../lib/core.mjs";
import { patchPaths, shellPaths, touchedPaths } from "../bin/codex-hook.mjs";
import { markdownRewrite } from "./mock-api.mjs";

test("prose path detection", () => {
  for (const p of ["/a/README.md", "/a/notes.txt", "/a/b.mdx", "/a/c.rst", "/repo/docs/guide", "/repo/docs/x.markdown", "C:\\repo\\docs\\plan.md"]) assert.equal(isProsePath(p), true, p);
  for (const p of ["/a/CLAUDE.md", "/a/AGENTS.md", "/a/claude.md", "/a/yarn.lock", "/a/docs/config.json", "/a/docs/site.js", "/a/index.js", "/a/node_modules/x/README.md", "/a/.hidden.md", "", null]) assert.equal(isProsePath(p), false, String(p));
});

test("frontmatter split and off switch", () => {
  const doc = "---\ntitle: x\nbetterwriting: off\n---\n\nBody here.\n";
  const { front, body } = splitFrontmatter(doc);
  assert.equal(front, "---\ntitle: x\nbetterwriting: off\n---\n");
  assert.equal(body, "\nBody here.\n");
  assert.equal(frontmatterOff(front), true);
  assert.equal(frontmatterOff("---\nbetterwriting: on\n---\n"), false);
  assert.equal(frontmatterOff(""), false);
  assert.deepEqual(splitFrontmatter("no front\n---\nnot front\n"), { front: "", body: "no front\n---\nnot front\n" });
  assert.equal(splitFrontmatter("---\nonly: this\n---").body, "");
});

test("12 prose word rule ignores code, tables, headers, links", () => {
  assert.equal(maxProseBlockWords("Short line here.\n"), 3);
  assert.equal(maxProseBlockWords("```\nthis code block has many many words in it that should never ever count at all\n```\n"), 0);
  assert.equal(maxProseBlockWords("| a | b | c | d | e | f | g | h | i | j | k | l | m |\n"), 0);
  assert.equal(maxProseBlockWords("# A heading with quite a lot of words in it for a heading really\n"), 0);
  assert.equal(maxProseBlockWords("- one two three four five six\n- seven eight nine ten eleven twelve\n"), 6);
  const para = "This paragraph has twelve words in it exactly, so it counts fine.";
  assert.equal(maxProseBlockWords(para), 12);
  assert.equal(maxProseBlockWords("Line one has six words here\nline two has six words too\n"), 12);
  assert.equal(maxProseBlockWords("See [the docs](https://example.com/a/b/c/d/e/f) and `code()` now."), 5);
});

test("edit sentence rule", () => {
  assert.equal(sentenceCount("Fix the bug."), 1);
  assert.equal(sentenceCount("Fix the bug. Then run the tests again."), 2);
  assert.equal(sentenceCount("Does it work? Yes it does!"), 2);
  assert.equal(sentenceCount("version 1.2.3 of the thing"), 0);
  assert.equal(sentenceCount("const x = 1;"), 0);
  assert.equal(sentenceCount("```\nA sentence. Another one.\n```"), 0);
});

test("whitespace is preserved around rewrites", () => {
  assert.equal(wrapWhitespace("\n\nhello world\n", "  bye world  "), "\n\nbye world\n");
  assert.equal(wrapWhitespace("x", "y"), "y");
});

test("config defaults are created when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-"));
  process.env.BETTERWRITING_HOME = dir;
  try {
    const cfg = loadConfig();
    assert.deepEqual(cfg, { ...DEFAULTS });
    assert.equal(cfg.endpoint, "https://betterwriting.ai");
    assert.equal(cfg.voice, "pg");
    assert.equal(cfg.responses, true);
    assert.equal(cfg.artifacts, true);
    const onDisk = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    assert.equal(onDisk.endpoint, "https://betterwriting.ai");
    assert.equal(fs.statSync(configPath()).mode & 0o777, 0o600);
    fs.writeFileSync(configPath(), "{not json");
    assert.deepEqual(loadConfig(), { ...DEFAULTS });
    fs.writeFileSync(configPath(), JSON.stringify({ voice: "jz" }));
    assert.equal(loadConfig().voice, "jz");
    assert.equal(loadConfig().responses, true);
  } finally { delete process.env.BETTERWRITING_HOME; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("device id is a stable sha256 hex", () => {
  assert.match(deviceId(), /^[0-9a-f]{64}$/);
  assert.equal(deviceId(), deviceId());
});

test("codex touched paths", () => {
  const patch = "*** Begin Patch\n*** Add File: docs/plan.md\n+hello\n*** Update File: src/a.js\n@@\n-x\n+y\n*** Update File: notes.txt\n*** Move to: notes2.txt\n*** End Patch";
  assert.deepEqual(patchPaths(patch), ["docs/plan.md", "src/a.js", "notes.txt", "notes2.txt"]);
  assert.deepEqual(shellPaths("cat > out.md <<'EOF'\nhi\nEOF"), ["out.md"]);
  assert.deepEqual(shellPaths("echo hi | tee -a 'notes.txt' && ls"), ["notes.txt"]);
  assert.deepEqual(shellPaths("echo x >> a/b/c.rst; cat d.js > e.js"), ["a/b/c.rst"]);
  assert.deepEqual(touchedPaths({ tool_name: "apply_patch", tool_input: { command: patch } }), ["docs/plan.md", "src/a.js", "notes.txt", "notes2.txt"]);
  assert.deepEqual(touchedPaths({ tool_name: "Bash", tool_input: { command: ["bash", "-lc", "printf x > r.md"] } }), ["r.md"]);
});

test("mock markdown rewrite leaves structure alone", () => {
  const { text, blocks } = markdownRewrite("---\nbetterwriting: on\n---\n# Title\n\nThis is a paragraph with more than twelve words in it for sure, yes.\n\n```\ncode with lots of words that should not be touched at all by anything here\n```\n- short item\n- a list item that has more than twelve words in it so it is rewritten\n");
  assert.equal(blocks, 2);
  assert.match(text, /^---\nbetterwriting: on\n---\n# Title\n\n\[pg\] This is a paragraph/);
  assert.match(text, /```\ncode with lots/);
  assert.match(text, /- short item\n- \[pg\] a list item/);
});
