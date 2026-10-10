#!/bin/sh
# Install the Better Writing Codex hook. Copies this checkout to ~/.betterwriting/agent and merges
# our PostToolUse hook into ~/.codex/hooks.json (other hooks untouched). Idempotent. Needs node >= 18.
set -eu
BW_HOME="${BETTERWRITING_HOME:-$HOME/.betterwriting}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "node >= 18 is required"; exit 1; }
mkdir -p "$BW_HOME/agent"
chmod 700 "$BW_HOME"
if [ "$SRC" != "$BW_HOME/agent" ]; then
  rm -rf "$BW_HOME/agent/bin" "$BW_HOME/agent/lib" "$BW_HOME/agent/codex"
  cp -R "$SRC/bin" "$SRC/lib" "$SRC/codex" "$BW_HOME/agent/"
fi
node "$BW_HOME/agent/codex/merge-hooks.mjs" "$BW_HOME/agent/codex/hooks.json" "${CODEX_HOME:-$HOME/.codex}/hooks.json" "$BW_HOME"
echo "Codex: prose files Codex writes are rewritten in your voice. Codex responses are not (no display hook)."
echo "Codex asks you to trust new hooks: run /hooks inside Codex once."
echo "Set a voice: node \"$BW_HOME/agent/bin/bw.mjs\" pg"
