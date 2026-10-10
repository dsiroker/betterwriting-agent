#!/usr/bin/env node
// Better Writing CLI behind the /voice skill. Prints plain text for Claude to relay. Never prints key values.
import { loadConfig, saveConfig, getVoices, rewrite, configPath, logPath, isTrialKey, DEFAULTS } from "../lib/core.mjs";

const SAMPLE = "We are pleased to announce that our team has been working diligently to deliver a comprehensive solution " +
  "that leverages cutting-edge technology to empower users across a wide range of use cases. We believe this represents " +
  "a significant step forward and we are excited to see how the community engages with it going forward.";

const out = (s) => process.stdout.write(s + "\n");
const mask = (k) => (k ? (isTrialKey(k) ? "trial key (bw_trial_...)" : "your key (" + k.slice(0, 8) + "...)") : "none (a trial key is minted on first use)");
const onoff = (v) => (v ? "on" : "off");
const parseBool = (s) => (/^(on|true|yes|1)$/i.test(s) ? true : /^(off|false|no|0)$/i.test(s) ? false : null);

function status(cfg) {
  const lines = [
    `Better Writing: ${onoff(cfg.enabled)}`,
    `voice: ${cfg.voice}`,
    `responses (what Claude shows you): ${onoff(cfg.responses)}`,
    `artifacts (prose files Claude writes): ${onoff(cfg.artifacts)}`,
    `key: ${mask(cfg.api_key)}`,
    `endpoint: ${cfg.endpoint}`,
  ];
  if (cfg.trial?.exhausted_at) lines.push(`trial: used up on ${cfg.trial.exhausted_at.slice(0, 10)}. Get a key at https://betterwriting.ai/keys then /voice login <key>`);
  else if (cfg.trial?.quota) lines.push(`trial quota: ${cfg.trial.quota.words} words, ${cfg.trial.quota.rewrites} rewrites (lifetime)`);
  lines.push(`config: ${configPath()}`, `log: ${logPath()} (no text, only sizes and timings)`);
  return lines.join("\n");
}

async function setVoice(cfg, id) {
  if (!id || !/^[a-z0-9_-]{1,32}$/i.test(id)) return `Usage: /voice <voice id>  (for example /voice pg)`;
  let voices = null;
  try { voices = await getVoices(cfg); } catch {}
  if (voices) {
    const v = voices.find((x) => x.id === id);
    if (!v) return `Unknown voice "${id}". Available: ${voices.map((x) => `${x.id} (${x.name}${x.status && x.status !== "live" ? ", " + x.status : ""})`).join(", ")}`;
    cfg.voice = v.id; cfg.enabled = true; saveConfig(cfg);
    return `Voice set to ${v.name} (${v.id}). Better Writing is on: responses ${onoff(cfg.responses)}, artifacts ${onoff(cfg.artifacts)}.\nNew sessions and new messages are rewritten from now on. /voice off turns it off.`;
  }
  cfg.voice = id; cfg.enabled = true; saveConfig(cfg);
  return `Could not reach ${cfg.endpoint} to validate "${id}"; saved it anyway. Better Writing is on.`;
}

async function test(cfg) {
  const before = SAMPLE;
  const t0 = Date.now();
  let r;
  try { r = await rewrite(cfg, before, { ms: 60000, mode: "markdown" }); } catch (e) {
    if (String(e?.code || "").startsWith("trial-")) return `Could not get a trial key (HTTP ${e.code.slice(6)}). Get a key at https://betterwriting.ai/keys then /voice login <key>.`;
    return `Network error reaching ${cfg.endpoint}: ${e?.cause?.code || e?.name || "unknown"}`;
  }
  if (r.status === 402) return `Trial used up. ${"Get a key at https://betterwriting.ai/keys then /voice login <key>"}`;
  if (r.status === 401) return `The stored key was rejected (401). /voice logout to go back to the trial, or /voice login <key>.`;
  if (r.status !== 200 || !r.text) return `Rewrite failed (HTTP ${r.status || "no response"}). Nothing in your sessions breaks when this happens; the original text shows.`;
  return `BEFORE\n${before}\n\nAFTER (${cfg.voice}, ${Date.now() - t0} ms)\n${r.text}`;
}

async function main(argv) {
  const cfg = loadConfig();
  const [cmd, arg] = argv;
  switch ((cmd || "status").toLowerCase()) {
    case "status": return status(cfg);
    case "set": return setVoice(cfg, arg);
    case "on": cfg.enabled = true; saveConfig(cfg); return `Better Writing on (voice ${cfg.voice}).`;
    case "off": cfg.enabled = false; saveConfig(cfg); return `Better Writing off. Responses and files are shown as Claude wrote them. /voice on to resume.`;
    case "responses": case "artifacts": {
      const b = parseBool(arg || "");
      if (b === null) return `Usage: /voice ${cmd} on|off`;
      cfg[cmd] = b; saveConfig(cfg);
      return `${cmd} ${onoff(b)}.`;
    }
    case "login": {
      if (!arg || !/^bw_(live|trial)_[A-Za-z0-9_-]{8,}$/.test(arg)) return `Usage: /voice login <key>  (keys look like bw_live_...; mint one at https://betterwriting.ai/keys)`;
      cfg.api_key = arg; cfg.trial = {}; saveConfig(cfg);
      return `Key saved (${mask(arg)}). /voice test to try it.`;
    }
    case "logout": delete cfg.api_key; cfg.trial = {}; saveConfig(cfg); return `Key removed. Back to the trial (a trial key is minted on the next rewrite if this device still has quota).`;
    case "test": return test(cfg);
    case "reset": saveConfig({ ...DEFAULTS }); return `Config reset to defaults.`;
    case "help": return `Commands: /voice <id> | status | on | off | responses on|off | artifacts on|off | login <key> | logout | test`;
    default: return setVoice(cfg, cmd);
  }
}

main(process.argv.slice(2)).then(out, (e) => { out(`Error: ${e?.message || e}`); });
