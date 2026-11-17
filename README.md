# Better Writing for Claude Code and Codex

Tell your agent once. From then on every response it shows you and every prose file it writes
(.md, .txt, .rst, docs/) is rewritten through [betterwriting.ai](https://betterwriting.ai) so it reads as written by a
person. You approve the key once in a browser. The first 15,000 words are free.

## Install

```
curl -fsSL https://raw.githubusercontent.com/dsiroker/betterwriting-agent/main/install.sh | sh
```

Then in Claude Code:

```
/voice login
```

That opens a page in your browser. Sign in with Google and click Approve. The plugin picks up the key by itself.

To rewrite one thing without installing anything, say this to any agent:

> Use betterwriting.ai to rewrite this

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
| `/voice login` | ask for a key and open the approval page in your browser |
| `/voice human` | the default voice: no named writer |
| `/voice pg` | write as Paul Graham (validated against `GET /api/v1/voices`) |
| `/voice status` | voice, switches, key type (masked), trial state |
| `/voice off`, `/voice on` | master switch |
| `/voice responses off` | leave responses alone, keep rewriting files |
| `/voice artifacts off` | leave files alone, keep rewriting responses |
| `/voice login <key>` | use a key you minted at https://betterwriting.ai/keys |
| `/voice logout` | forget the key |
| `/voice test` | rewrite a fixed paragraph, print before and after |

Config lives in `~/.betterwriting/config.json`. Codex users run `node ~/.betterwriting/agent/bin/bw.mjs <command>`.

## Trial and limits

A key needs a person's approval once per machine. `/voice login` opens the page. If you skip it, the first response
long enough to rewrite ends with one line carrying the link, and everything shows as the agent wrote it until you
approve. The key belongs to your Google account, so the trial is one per person: 15,000 words. When it runs out the
hooks go quiet and a one-line notice appears under one response a day. Plans and limits: https://betterwriting.ai/pricing.
A machine that already holds an old `bw_trial_` key keeps it until its quota is gone.

## Privacy

The text of each response batch and each prose file write is sent to betterwriting.ai over HTTPS and rewritten there.
Nothing else leaves your machine. The device id sent with a key request is a SHA-256 of hostname, username and machine id. The local log
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

