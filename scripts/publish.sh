#!/bin/sh
# Mirror agent/ to the public repo dsiroker/betterwriting-agent and push. Run from anywhere.
# Usage: agent/scripts/publish.sh [commit message]
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BW_AGENT_CHECKOUT:-$HOME/.cache/betterwriting-agent}"
MSG="${1:-mirror agent/ from betterwriting $(cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo local)}"
if [ ! -d "$DEST/.git" ]; then
  gh repo clone dsiroker/betterwriting-agent "$DEST"
fi
git -C "$DEST" pull --rebase --quiet || true
# check/ is Dan's own prose checker (his voice rules, launchd jobs): it stays private. Its README section goes too.
rsync -a --delete --exclude .git --exclude check "$SRC/" "$DEST/"
rm -rf "$DEST/check"
awk '/^## The prose checker/{exit} {print}' "$SRC/README.md" > "$DEST/README.md"
[ ! -e "$DEST/check" ] || { echo "check/ is still in the mirror; refusing to push" >&2; exit 1; }
git -C "$DEST" add -A
if git -C "$DEST" diff --cached --quiet; then echo "public repo already up to date"; exit 0; fi
git -C "$DEST" -c commit.gpgsign=false commit -q -m "$MSG" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
git -C "$DEST" push -q origin HEAD
echo "pushed to https://github.com/dsiroker/betterwriting-agent"
