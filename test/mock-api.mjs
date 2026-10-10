// Mock of the betterwriting.ai API contract (architecture.md: Public API + Agent integration).
// Usage as a module: const m = await startMock(); m.url; m.setMode("ok"|"500"|"hang"|"402"|"401"); m.requests; await m.close()
// Usage as a CLI: node mock-api.mjs [port]
import http from "node:http";
import { createHash } from "node:crypto";

// Deterministic "rewrite" so tests can assert exact output: every prose block of >= 12 words gets a "[pg] " prefix.
// Code fences, headers, tables, list markers, frontmatter, blockquote markers and short lines pass through.
export function markdownRewrite(text) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false, i = 0, blocks = 0;
  const words = (s) => (s.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  if (lines[0] === "---") { const end = lines.indexOf("---", 1); if (end > 0) { out.push(...lines.slice(0, end + 1)); i = end + 1; } }
  for (; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    if (/^(```|~~~)/.test(t)) { inFence = !inFence; out.push(line); continue; }
    if (inFence || !t || t.startsWith("|") || /^#{1,6}\s/.test(t) || /^[-*_]{3,}$/.test(t)) { out.push(line); continue; }
    const m = line.match(/^(\s*(?:>\s?)?(?:(?:[-*+]|\d+[.)])\s+)?)(.*)$/);
    const prefix = m[1], body = m[2];
    if (words(body) < 12) { out.push(line); continue; }
    blocks++;
    out.push(prefix + "[pg] " + body);
  }
  return { text: out.join("\n"), blocks };
}

export function startMock({ port = 0 } = {}) {
  const state = { mode: "ok", requests: [], trials: new Map(), quota: { words: 15000, rewrites: 300 } };
  const json = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = null; try { body = JSON.parse(raw || "null"); } catch {}
      const auth = req.headers.authorization || "";
      state.requests.push({ method: req.method, url: req.url, body, auth: auth.replace(/Bearer (bw_(?:live|trial)_)\S+/, "Bearer $1***") });
      if (req.url === "/__mock" && req.method === "POST") { Object.assign(state, body || {}); return json(res, 200, { ok: true }); }
      if (req.url === "/__mock" && req.method === "GET") return json(res, 200, { mode: state.mode, requests: state.requests });
      if (state.mode === "hang") return; // never answers
      if (state.mode === "500") return json(res, 500, { error: "upstream" });
      if (req.url === "/api/v1/voices" && req.method === "GET") return json(res, 200, { voices: [{ id: "pg", name: "Paul Graham", status: "live", prompt_version: "v1", model: "claude-fable-5-1" }] });
      if (req.url === "/api/v1/trial" && req.method === "POST") {
        if (state.mode === "trial-429") return json(res, 429, { error: "rate_limited" });
        if (!body?.device) return json(res, 400, { error: "bad_request" });
        if (state.mode === "402") return json(res, 409, { error: "trial_exhausted", upgrade_url: "https://betterwriting.ai/keys" });
        const existing = state.trials.get(body.device);
        if (existing) return json(res, 200, { api_key: existing, quota: state.quota });
        const key = "bw_trial_" + createHash("sha256").update(body.device).digest("base64url").slice(0, 32);
        state.trials.set(body.device, key);
        return json(res, 201, { api_key: key, quota: state.quota });
      }
      if (req.url === "/api/v1/rewrite" && req.method === "POST") {
        if (!/^Bearer bw_(live|trial)_/.test(auth) || state.mode === "401") return json(res, 401, { error: "unauthorized" });
        if (state.mode === "402") return json(res, 402, { error: "trial_exhausted", upgrade_url: "https://betterwriting.ai/keys" });
        if (!body?.text) return json(res, 400, { error: "bad_request" });
        if (body.voice && body.voice !== "pg") return json(res, 404, { error: "unknown_voice" });
        const t0 = Date.now();
        const r = body.mode === "markdown" ? markdownRewrite(body.text) : { text: "[pg] " + body.text, blocks: 1 };
        return json(res, 200, { id: "mock", voice: body.voice || "pg", text: r.text, words_in: 0, words_out: 0, model: "mock", prompt_version: "v1",
          latency_ms: Date.now() - t0, blocks_rewritten: r.blocks }, { "x-quota-remaining-words": "15000" });
      }
      json(res, 404, { error: "not_found" });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, state, requests: state.requests, setMode: (m) => { state.mode = m; }, reset: () => { state.requests.length = 0; state.mode = "ok"; },
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startMock({ port: Number(process.argv[2]) || 8787 }).then((m) => console.log(`mock betterwriting API at ${m.url}`));
}
