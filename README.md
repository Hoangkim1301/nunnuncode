# nunnuncode

> An open-source, always-on personal agent — local-first, with memory you can read and edit as plain files.

[🇬🇧 English](README.md) · [🇻🇳 Tiếng Việt](legacy/README_VI.md) · [🇩🇪 Deutsch](legacy/README_DE.md)

## Why this project

nunnuncode is a personal assistant in the spirit of Grok Build, Claude Duet, and OpenAI Dots — but open source, local-first, and yours. It codes, remembers, wakes on its own, and messages you only when you must act. Its architecture follows DeepSeek Harness's everything-is-a-plugin shape; its minimalism follows pi. The code is owned: the agent loop, session log, plugin runtime, memory and skills are written here.

## Status

**Phase 0 — The Seed.** A working minimal coding agent: agent loop, session log, guarded tool pipeline, and the pi toolset. Memory, skills, always-on daemon, and web UI arrive in the next phases (see [the design spec](docs/superpowers/specs/2026-11-06-personal-agent-harness-design.md)).

## Quick start

Requirements: Node.js 22.19+ and [pnpm](https://pnpm.io).

```bash
pnpm install

# configure (or copy .env.example)
#   API_BASE_URL  – OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1
#   API_KEY       – your key
#   MODEL         – model id, e.g. qwen-3.8-27b
node packages/cli/src/index.ts
```

Commands: `/c` clear conversation · `/q` or `exit` quit.

Trust model: reads are free; `bash`, `write`, `edit` are confirmed per call (answer `a` to allow for the session).

## Architecture

```
packages/
├── harness/          # agent loop, JSONL session log, plugin composer, ModelProvider seam, tool pipeline
├── plugin-tools/     # bash, powershell, read, write, edit, grep (ripgrep), glob, ls, find
└── cli/              # nunnuncode CLI chat
packages/vendor/pi/   # vendored pi (MIT): pi-ai, pi-schema, telemetry
```

- **Session log** — append-only JSONL; the model-visible history is always derived from the log.
- **Tool pipeline** — `allow / confirm / deny / observe`; observe-only mode executes nothing.
- **Everything is a plugin** — the model provider, tools, and (in later phases) memory and skills register on one shared context.

## Tests

```bash
pnpm test        # all packages, sequentially
pnpm typecheck   # our packages (strict TypeScript 7)
```

## Learning notes

Things learned building this:

- **The agent loop is a while loop**: send messages → model replies with tool calls → run tools → send results → repeat until nothing is owed. A `length` stop means truncated tool arguments — fail them, don't run them.
- **Memory is a projection, not a state**: the log is the source of truth; history is derived, so compaction is just another log event.
- **pi's engine is worth reading**: `pi-agent-core`'s loop is small, explicit, and battle-tested — we reshape it rather than depend on it.

## Credits

- [pi](https://github.com/earendil-works/pi) by Mario Zechner (Earendil Works) — vendored MIT core: pi-ai, pi-agent-core, tools, schema.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the architecture inspiration (everything-is-a-plugin, session log, attention philosophy).
- Legacy Python single-file agent preserved in [legacy/](legacy/) — where this project started.

## License

MIT
