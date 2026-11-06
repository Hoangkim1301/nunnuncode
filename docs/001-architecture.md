# 001 — Architecture

A one-page walkthrough of how nunnuncode works today (Phase 0), written so a
reader — human or the agent itself — can understand the whole system in one
sitting.

## The idea in one sentence

An agent is a loop around a model: send context, the model answers with text
and/or tool calls, run the tools, append the results, repeat until nothing is
owed. Everything else — sessions, plugins, trust, previews — exists to make
that loop durable, safe, and inspectable.

## The three layers

```
┌─────────────────────────────────────────────────────────────┐
│ CLI  (packages/cli)                                         │
│   readline REPL, per-tool rendering, .env, trust confirm     │
├─────────────────────────────────────────────────────────────┤
│ HARNESS  (packages/harness)  — the agent core                │
│   loop · session log · plugin composer · provider · pipeline │
├─────────────────────────────────────────────────────────────┤
│ TOOLS  (packages/plugin-tools)                               │
│   bash·powershell·read·write·edit·grep·glob·ls·find          │
└─────────────────────────────────────────────────────────────┘
```

Each layer is a workspace package with its own `package.json`; a package sees
only the dependencies it declares.

## One turn, end to end

```
you type "list the .ts files"
        │
        ▼
CLI: AgentLoop.run(input)
        │
        ├─ session.append('user/message', …)          ← durable
        │
        ├─ provider.stream({ system, messages: session.deriveMessages(), tools })
        │      └─ OpenAI-compatible POST /chat/completions (SSE)
        │         yields: text-delta | thinking-delta | tool-call | done
        │
        ├─ session.append('assistant/message', parts)  ← durable
        │
        ├─ for each tool call:                          ← guarded pipeline
        │      validate args → policy decision →
        │        allow   → execute
        │        confirm → ask you (y / a / n)
        │        deny    → refuse
        │        observe → record intent, run nothing
        │      session.append('tool/call' | 'tool/result')
        │
        └─ if tools ran → next step (loop again with the results)
           else        → turn ends
```

## The seven files that matter

| File | Owns |
|---|---|
| `packages/harness/src/loop/loop.ts` | the turn/step loop, history assembly, tool dispatch, abort handling |
| `packages/harness/src/session/store.ts` | append-only JSONL log; torn-tail recovery; parent-dir creation |
| `packages/harness/src/session/derive.ts` | projecting the log into model-visible messages (incl. compaction) |
| `packages/harness/src/providers/openai-provider.ts` | the only network code: SSE streaming, tool-call assembly, retry, abort |
| `packages/harness/src/tools/pipeline.ts` | argument validation (TypeBox) + policy + preview + spill |
| `packages/harness/src/runtime/composer.ts` | plugins register tools/services/events on one shared context |
| `packages/cli/src/index.ts` | REPL, confirm prompt, rendering, session file location |

## Design choices and why

- **The model-visible history is derived, never stored.** The JSONL log is the
  source of truth; `deriveMessages()` rebuilds what the model sees. Compaction is
  just another event, so replay always yields a consistent history.
- **One seam for the network.** `providers/` is the only directory that may call
  `fetch` (enforced by a test). Swapping providers never touches the loop.
- **Everything is a plugin.** The tool set is registered by a plugin, not baked
  into the loop. Memory, skills and the scheduler arrive the same way.
- **Own the provider.** Only one protocol is used (OpenAI-compatible), so we
  implement it (~300 lines) instead of shipping a 26k-line multi-provider SDK.
- **Trust is a ladder, not a mode.** Reads run free; `bash`/`write`/`edit`
  confirm; the daemon will be observe-only until a written rule allows otherwise.
- **Tool output is bounded.** Truncation at 2000 lines / 50 KB; results beyond
  that spill to a temp file whose path is handed to the model (a spill failure
  self-heals and never loses the result).

## What exists today vs later

| Built (Phase 0) | Not yet |
|---|---|
| loop, session log, provider, pipeline, 9 tools, CLI | memory (Phase 2), skills (Phase 1), heartbeat daemon + web UI (Phase 3), MCP/SQL/PDF (Phase 4), proactive rules (Phase 5) |

## How to explore it with this agent

Ask the agent itself; it can read its own source:

- `read packages/harness/src/loop/loop.ts and explain the step loop`
- `where is history derived from, and how does compaction work?`
- `grep for "confirm" and explain the trust ladder`
- `what happens if the model sends malformed tool arguments?`
- `trace what happens to a bash tool result from execution to the session log`
- `what would I change to add a new tool?`