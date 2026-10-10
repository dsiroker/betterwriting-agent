#!/bin/sh
# Better Writing agent install. curl -fsSL https://raw.githubusercontent.com/dsiroker/betterwriting-agent/main/install.sh | sh
# Installs the Claude Code plugin if `claude` exists and the Codex hook if `codex` exists. Idempotent.
set -u
REPO="dsiroker/betterwriting-agent"
BW_HOME="${BETTERWRITING_HOME:-$HOME/.betterwriting}"
did=0

if command -v claude >/dev/null 2>&1; then
  if claude plugin marketplace list 2>/dev/null | grep -q "betterwriting-agent"; then
    claude plugin marketplace update betterwriting-agent >/dev/null 2>&1 || true
  else
    claude plugin marketplace add "$REPO" || echo "could not add the marketplace; run: claude plugin marketplace add $REPO"
  fi
  if claude plugin list 2>/dev/null | grep -q "betterwriting@betterwriting-agent"; then
    claude plugin update betterwriting@betterwriting-agent >/dev/null 2>&1 || true
    echo "Claude Code plugin already installed (updated)."
  else
    claude plugin install betterwriting@betterwriting-agent --scope user || echo "could not install; run: claude plugin install betterwriting@betterwriting-agent"
  fi
  did=1
fi

if command -v codex >/dev/null 2>&1; then
  if command -v node >/dev/null 2>&1; then
    tmp="$(mktemp -d 2>/dev/null || mktemp -d -t bw)"
    if curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar -xz -C "$tmp" 2>/dev/null; then
      sh "$tmp"/betterwriting-agent-main/codex/install.sh
    else
      echo "could not download $REPO for the Codex hook"
    fi
    rm -rf "$tmp"
    did=1
  else
    echo "Codex found but node is missing; install Node 18+ then rerun."
  fi
fi

[ "$did" = 1 ] || echo "Neither claude nor codex found on PATH. Install Claude Code (https://claude.com/claude-code) or Codex, then rerun."
echo ""
echo "Now run /voice pg in Claude Code"
