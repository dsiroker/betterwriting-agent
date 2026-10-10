# Better Writing for Claude Code and Codex

Tell your agent once. From then on every response it shows you and every prose file it writes
(.md, .txt, .rst, docs/) is rewritten in a named writer's voice through [betterwriting.ai](https://betterwriting.ai).
Paul Graham first. No account needed to try it.

## Install

```
curl -fsSL https://raw.githubusercontent.com/dsiroker/betterwriting-agent/main/install.sh | sh
```

Then in Claude Code:

```
/voice pg
```

Or paste this into any agent:

> Set up Better Writing per https://betterwriting.ai/agents.md

By hand, for Claude Code only:

```
claude plugin marketplace add dsiroker/betterwriting-agent
claude plugin install betterwriting@betterwriting-agent
```

Needs Node 18 or newer on PATH.

## What it does

- **Responses.** A `MessageDisplay` hook sends each batch of completed lines to `POST /api/v1/rewrite` in markdown mode
  and shows the rewrite in place. Display only: the transcript and what Claude sees keep the original.
- **Files.** A `PreToolUse` hook on `Write` and `Edit` rewrites the prose before it hits disk. Code fences, tables,
  headers, links, list markers and lines under 12 words are left alone. The hook only swaps the content; your normal
  permission rules still decide whether the write happens.
- **Codex.** A `PostToolUse` hook on `apply_patch` (and shell redirections to prose files, best effort) rewrites touched
  prose files on disk. Codex has no display hook, so Codex responses are not rewritten.

Skipped: `CLAUDE.md`, `AGENTS.md`, `*.lock`, anything under `node_modules/`, and any file whose frontmatter has
`betterwriting: off`. Deltas and edits with fewer than 12 prose words (or fewer than 2 sentences for an Edit) pass through.

## Commands

| Command | Effect |
| --- | --- |
| `/voice pg` | set the voice (validated against `GET /api/v1/voices`) |
| `/voice status` | voice, switches, key type (masked), trial state |
| `/voice off`, `/voice on` | master switch |
| `/voice responses off` | leave responses alone, keep rewriting files |
| `/voice artifacts off` | leave files alone, keep rewriting responses |
| `/voice login <key>` | use your own key from https://betterwriting.ai/keys |
| `/voice logout` | back to the trial key |
| `/voice test` | rewrite a fixed paragraph, print before and after |

Config lives in `~/.betterwriting/config.json`. Codex users run `node ~/.betterwriting/agent/bin/bw.mjs <command>`.

## Trial and limits

First use mints a trial key for this device: 15,000 words or 300 rewrites, lifetime. When it runs out the hooks go
quiet and a one-line notice appears under one response a day. `/voice login <key>` continues with a free key
(50 rewrites and 20,000 words a day). One trial per device; 3 new trials per IP per day.

## Privacy

The text of each response batch and each prose file write is sent to betterwriting.ai over HTTPS and rewritten there.
Nothing else leaves your machine. The trial device id is a SHA-256 of hostname, username and machine id. The local log
(`~/.betterwriting/log.jsonl`, capped at 1 MB) records event, byte count, latency and status; never text.

## Fail open

Every error path (network down, timeout, quota, bad response) prints nothing and the original text or file goes
through unchanged. Hard client timeouts: 45 s for responses, 100 s for files.

## Turn off or remove

```
/voice off                                      # keep installed, do nothing
claude plugin uninstall betterwriting@betterwriting-agent
rm -rf ~/.betterwriting                         # config, trial key, log
```

Codex: remove the `codex-hook.mjs` entry from `~/.codex/hooks.json`.

## Develop

```
node --test test
```

Tests run against `test/mock-api.mjs`, a mock of the API contract. This repo mirrors `agent/` in the private
betterwriting repo; do not edit here.
