// Shared code for the Better Writing agent hooks and CLI. Node >= 18, no dependencies.
// Everything here is written to fail open: callers catch, log, and print nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const VERSION = "0.1.0";
export const NOTICE = "Better Writing trial used up. Keep going: https://betterwriting.ai/keys";
export const MIN_PROSE_WORDS = 12;
export const MAX_WORDS = 5500;
export const PROSE_EXT = new Set([".md", ".mdx", ".markdown", ".mdown", ".txt", ".rst"]);
const NOT_PROSE_EXT = /\.(json|ya?ml|toml|jsonl|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|sh|zsh|bash|css|scss|html|htm|xml|svg|png|jpe?g|gif|webp|pdf|lock|sql|ini|cfg|env|map|wasm)$/i;

export const DEFAULTS = Object.freeze({
  endpoint: "https://betterwriting.ai", voice: "pg", enabled: true, responses: true, artifacts: true,
});

// ---------- config ----------
export function home() {
  return process.env.BETTERWRITING_HOME || path.join(os.homedir(), ".betterwriting");
}
export const configPath = () => path.join(home(), "config.json");
export const logPath = () => path.join(home(), "log.jsonl");

export function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { cfg = null; }
  if (!cfg || typeof cfg !== "object") {
    cfg = { ...DEFAULTS };
    try { saveConfig(cfg); } catch {}
    return cfg;
  }
  return { ...DEFAULTS, ...cfg };
}

export function saveConfig(cfg) {
  const dir = home();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = configPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, configPath());
}

// ---------- log (never contains text) ----------
export function log(entry) {
  try {
    const dir = home();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = logPath();
    try { if (fs.statSync(p).size > 1024 * 1024) fs.renameSync(p, p + ".1"); } catch {}
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

// ---------- device id for trial keys ----------
export function machineId() {
  try { if (process.platform === "linux") return fs.readFileSync("/etc/machine-id", "utf8").trim(); } catch {}
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  } catch {}
  return "";
}
export function deviceId() {
  let user = "";
  try { user = os.userInfo().username; } catch {}
  return createHash("sha256").update(os.hostname() + user + machineId()).digest("hex");
}

// ---------- HTTP ----------
export function timeoutMs(fallback) {
  const v = Number(process.env.BETTERWRITING_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function call(cfg, method, route, body, headers = {}, ms = 45000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs(ms));
  try {
    const res = await fetch(cfg.endpoint.replace(/\/$/, "") + route, {
      method, signal: ctl.signal,
      headers: { "content-type": "application/json", "user-agent": `betterwriting-agent/${VERSION}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json, headers: res.headers };
  } finally { clearTimeout(t); }
}

export async function getVoices(cfg) {
  const r = await call(cfg, "GET", "/api/v1/voices", undefined, {}, 15000);
  return r.status === 200 && Array.isArray(r.json?.voices) ? r.json.voices : null;
}

// Returns the api key, minting a trial key when none is stored. Returns null when no key can be had.
export async function ensureKey(cfg) {
  if (cfg.api_key) return cfg.api_key;
  if (cfg.trial?.exhausted_at) return null;
  const r = await call(cfg, "POST", "/api/v1/trial", { device: deviceId() }, {}, 20000);
  if ((r.status === 200 || r.status === 201) && typeof r.json?.api_key === "string") {
    cfg.api_key = r.json.api_key;
    cfg.trial = { ...(cfg.trial || {}), quota: r.json.quota || null, started_at: new Date().toISOString() };
    delete cfg.trial.exhausted_at;
    saveConfig(cfg);
    return cfg.api_key;
  }
  if (r.status === 409 || r.status === 402) {
    cfg.trial = { ...(cfg.trial || {}), exhausted_at: new Date().toISOString() };
    saveConfig(cfg);
    return null;
  }
  const e = new Error(`trial key request failed (${r.status})`);
  e.code = `trial-${r.status}`;
  throw e;
}

export const isTrialKey = (k) => typeof k === "string" && k.startsWith("bw_trial_");
export const trialExhausted = (cfg) => Boolean(cfg.trial?.exhausted_at) && (!cfg.api_key || isTrialKey(cfg.api_key));

// Rewrite text in markdown mode. Resolves {status, text}. Never throws on HTTP errors; throws on network errors.
export async function rewrite(cfg, text, { ms = 45000, mode = "markdown" } = {}) {
  const key = await ensureKey(cfg);
  if (!key) return { status: cfg.trial?.exhausted_at ? 402 : 0, text: null };
  const r = await call(cfg, "POST", "/api/v1/rewrite", { voice: cfg.voice, text, mode }, { authorization: `Bearer ${key}` }, ms);
  if (r.status === 402) {
    cfg.trial = { ...(cfg.trial || {}), exhausted_at: new Date().toISOString() };
    saveConfig(cfg);
  }
  const out = r.status === 200 && typeof r.json?.text === "string" ? r.json.text : null;
  return { status: r.status, text: out, blocks: r.json?.blocks_rewritten };
}

// ---------- prose detection ----------
export function isProsePath(p) {
  if (!p || typeof p !== "string") return false;
  const norm = p.replace(/\\/g, "/");
  if (/(^|\/)(node_modules|\.git)\//.test(norm)) return false;
  const base = norm.split("/").pop();
  if (!base || base.startsWith(".")) return false;
  if (/^(CLAUDE|AGENTS|CODEX|GEMINI)\.md$/i.test(base) || base.endsWith(".lock")) return false;
  const ext = (base.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (PROSE_EXT.has(ext)) return true;
  if (/(^|\/)docs\//.test(norm)) return !NOT_PROSE_EXT.test(base);
  return false;
}

// Splits leading YAML frontmatter. Returns {front, body}; front is "" when absent and includes its closing newline.
export function splitFrontmatter(text) {
  const m = /^(---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$))/.exec(text);
  return m ? { front: m[1], body: text.slice(m[1].length) } : { front: "", body: text };
}
export function frontmatterOff(front) {
  return /^\s*betterwriting\s*:\s*(off|false|no|0)\s*$/im.test(front || "");
}

function cleanLine(t) {
  return t
    .replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "")
    .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~#|]/g, " ");
}
const countWords = (s) => (s.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g) || []).length;

// Largest prose block (paragraph or list item) in words, ignoring code fences, tables, headers' syntax, html.
export function maxProseBlockWords(text) {
  let inFence = false, cur = 0, best = 0;
  const flush = () => { if (cur > best) best = cur; cur = 0; };
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) { inFence = !inFence; flush(); continue; }
    if (inFence) continue;
    if (!t || t.startsWith("|") || /^[-*_]{3,}$/.test(t) || /^<[^>]+>$/.test(t) || /^#{1,6}\s/.test(t)) { flush(); continue; }
    if (/^([-*+]|\d+[.)])\s+/.test(t)) flush();
    cur += countWords(cleanLine(t));
  }
  flush();
  return best;
}
export const totalWords = (text) => countWords(String(text));

// Sentences: a run of words ending in . ! or ? followed by space or end. "v1.2" and "e.g." do not count twice.
export function sentenceCount(text) {
  const t = String(text).replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
  const m = t.match(/[A-Za-zÀ-ɏ)"'”][.!?]+(?=\s|$)/g) || [];
  return countWords(t) >= 2 ? m.length : 0;
}

// Keep the original's leading and trailing whitespace around a rewritten core.
export function wrapWhitespace(original, core) {
  const lead = original.match(/^\s*/)[0];
  const trail = original.match(/\s*$/)[0];
  return lead + core.trim() + trail;
}

export const today = () => new Date().toISOString().slice(0, 10);

export function readStdin(ms = 5000) {
  return new Promise((resolve) => {
    let data = "";
    const t = setTimeout(() => resolve(data), ms);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => { clearTimeout(t); resolve(data); });
    process.stdin.on("error", () => { clearTimeout(t); resolve(data); });
  });
}
