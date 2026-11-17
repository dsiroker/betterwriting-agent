---
name: voice
description: Control Better Writing, which rewrites Claude's responses and the prose files it writes so they read as written by a person. Use for "/voice login", "/voice pg", "switch voice", "turn off Better Writing", "/voice status".
argument-hint: "<voice id> | status | on | off | responses on|off | artifacts on|off | login [key] | logout | test"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/bw.mjs" *)
---

Run this command and relay its output to the user verbatim, with no commentary and no reformatting:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/bw.mjs" $ARGUMENTS
```

Notes:
- No arguments means `status`.
- `login` with no key opens an approval page in the user's browser and waits up to 100 seconds. If the output carries a link, show the link exactly as printed so the user can click it.
- A bare word that is not a command (for example `pg`) sets that voice.
- Never print the stored API key. The command masks it; keep it masked.
- If the command fails to run, say so in one line and suggest `node --version` (Node 18 or newer is required).
