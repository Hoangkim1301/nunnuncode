# Personal Agent Harness — Design

Date: 2026-11-06 · Status: draft for approval

## Intent and why

Build **nunnuncode**: an open-source, always-on personal agent in the spirit of Grok Build, Claude Duet, and OpenAI Dots — but local-first, with memory you can read and edit as plain files. It codes, remembers, wakes on its own, and messages its user only when the user must act.

The project pivots away from the old goal (a minimal single-file Python coding agent for learning). The new goal is an **impression project**: attract users and contributors through a working, polished, inspectable agent. Minimal philosophy stays as the identity — minimal where it differentiates, pragmatic where it doesn't.

The architecture follows **DeepSeek Harness's shape** (everything-is-a-plugin, typed events, durable session log — studied from `deepseek-ai/deepseek-harness` and `dsh-superagent-prototype`) — but the code is **owned**, not depended on.

## Identity (the pitch)

> An open-source always-on personal agent. Local-first. Owns nothing you can't read: the agent loop is TypeScript you can read, the memory is markdown you can edit, the state is SQLite you can query.

Four properties, set once, never traded away:

1. **Own the code** — no agent framework in the core; the harness is ours
2. **Local-first** — storage and memory stay on the user's machine; the LLM API is the only cloud dependency. Honest caveat: what the agent *reads* is what leaves the machine — the trust model governs that surface
3. **Inspectable** — memory is plain markdown; state is SQLite; nothing hidden
4. **Minimal attention** — adopted from dsh-superagent's philosophy: act only when asked or when a written rule allows; speak only when a person must act or can use a result

## Goals, non-goals, anti-goals

**Goals**
- Always-on agent: chat + proactive behavior on a schedule, run as a local daemon
- Self-evolving memory: capture → consolidate ("dream") → retrieve → forget
- Coding ability: shell, file operations, repo work
- Later: MCP client, SQL access (read-only by default), PDF knowledge folder
- Web UI as the primary interface; CLI kept as a minimal second surface

**Non-goals (for v1)**
- Multi-user, team features, cloud sync
- Vector stores / embeddings
- Mobile apps
- Voice

**Anti-goals (would make this a failure even if it works)**
- Hidden memory the user can't inspect or edit
- A framework that hides the agent loop
- A chatty agent that messages on every wake (noise is failure)
- Scope creep beyond the phases below before Phase 3 ships

## Approaches considered

1. **Extend nunnuncode in Python** (rejected): the Python agent ecosystem (Pydantic AI) fits, but the user's identity call is TypeScript/dsh-shape; Python would mean following a different ecosystem than the one this project wants to belong to.
2. **Build on DeepSeek Harness as a plugin bundle** (rejected by the user): fastest path, ~272k-star repo, but the user wants to own the code.
3. **Own the code from scratch** (superseded by 4): TypeScript monorepo, own minimal plugin runtime and agent loop, inspired by dsh's architecture. Full ownership; design follows proven patterns — but months of parity work before the differentiator exists.
4. **Selective vendor from pi (chosen)**: copy MIT source of `pi-agent-core` (loop, tool calling, state), the coding-agent tools + skills loader, and `pi-ai` into the repo; absorb-and-prune in Phase 0 — reshape into our architecture, delete unused modules, add the multi-session/bot layer. Working, battle-tested code **in our repo, owned from day one**; no runtime dependency on pi. The absorption pass is guided (mapped, walked through, reduced) so the surviving code is smaller than what pi ships and fully understood.

## Constraints

- Windows-first user (dev machine is Windows); must run cross-platform eventually
- Solo developer + AI agents; TypeScript throughout
- Node.js 22+ (LTS), pnpm workspaces
- Local daemon; no cloud dependency beyond the LLM API

## Tech stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (Node 22+, ESM) | The ecosystem this project wants to belong to; dsh-shaped architecture is native here |
| Monorepo | **pnpm workspaces** | Same layout pattern as dsh |
| LLM access | **pi-ai** (vendored from `earendil-works/pi`, MIT) behind our own `ModelProvider` seam | The layer the serious TS harnesses own (pi/OpenClaw runs it in production): unified multi-provider API (~15 providers incl. OpenAI-compatible custom endpoints), battle-tested provider-quirk handling. Vendored = source in our repo, zero runtime dependency on npm-published pi. Loop, session log, plugin runtime stay ours. **Vercel AI SDK** optionally alongside for UI streaming glue (`useChat`) if assistant-ui integration needs it |
| Web server | **Hono** (Node) | Small, fast, TS-native; serves API + SSE + static frontend |
| Frontend | **React + Vite + Tailwind v4 + assistant-ui** (custom runtime) | Chat UX solved (streaming, markdown, tool-call rendering); React = biggest contributor pool; chat built on assistant-ui primitives, styled by us |
| Memory knowledge | **Markdown files** the agent owns (workspace: `MEMORY.md` index + `topics/*.md`) | Matches Claude Code / Grok Build / dots pattern; inspectable; git-friendly |
| Memory state | **SQLite** (better-sqlite3) — inbox queue, events, schedule | Episodic + working state; FTS5 available if retrieval needs it |
| Validation | **Zod** at app/plugin boundaries; **TypeBox natively for tool schemas** (pi-ai's native format — no conversion layer) | TS-native; schema friction decided up front |
| Tests | **Vitest** | TS-native |

Rejected and why: LangChain (JS or Python — churn, hides the loop our loop *is* the product, and as a dependency it loses to the vendored pi on the owner's own criteria: source in repo, no install churn), Pydantic AI (Python-only), CopilotKit (architecture lock-in; assistant-ui chosen — chat is the whole product, and the brain must stay ours), Mastra (its memory/workflow abstractions compete with our memory system), Vercel AI SDK as core loop layer (kept only as optional UI-glue).

## Architecture

### Monorepo layout

```
nunnuncode/
├── packages/
│   ├── harness/            # the core: plugin runtime + agent loop + session log
│   │   ├── runtime/        # plugin context: services, typed events, reversible effects
│   │   ├── loop/           # agent loop: turn/step, tool dispatch, streaming
│   │   ├── session/        # append-only JSONL session log; history derived from it
│   │   └── providers/      # ModelProvider seam wrapping pi-ai (multi-provider LLM API)
│   ├── plugin-skills/      # skills manager: load SKILL.md from ~/.nunnun, .nunnun, .agents
│   ├── plugin-memory/      # markdown workspace + SQLite store + dream consolidation
│   ├── plugin-heartbeat/   # scheduler: wake → check inbox → act or stay silent
│   ├── plugin-tools/       # bash, read, write, edit, glob, grep
│   ├── plugin-web/         # Hono server: API + SSE + serves built frontend
│   └── cli/                # minimal CLI surface (chat + status)
├── apps/
│   └── web/                # React + Vite + Tailwind + assistant-ui frontend
├── docs/                   # numbered docs, dsh-superagent style (000-philosophy first)
└── tests/
```

### Plugin runtime (the core idea, simplified from Cordis)

**The philosophy is dsh's: everything is a plugin.** The model provider, tool registry, session log, memory, skills, scheduler — all plugins beside each other, replaceable from configuration. A vector database, if ever needed, is a plugin that replaces the default memory backing — not a core rewrite. The loop itself only knows that plugins exist.

- One shared **context**; plugins register **services** (typed factories), listen to **typed events**, and register **effects that unwind on unload**
- No privileged core to patch: the agent loop, model provider, and tools are themselves plugins
- Plugin manifest declares what it provides and consumes; boot composes an ordered plugin tree from config
- **Memory is pluggable:** on/off, customizable, replaceable — the core has no memory dependency, only a context-provider seam
- **Phase 0 ambition cap (binding):** the Phase 0 runtime is a *config-driven module composer* — plain registration, typed events, no effect-unwinding machinery, no manifest loading, no plugin hot-swap. It grows capability only when a real second consumer exists (memory, Phase 2). The "simplify freely" note above is a rule, not a suggestion — a full Cordis-like runtime is the largest unforced risk in Phase 0

### Session log (from dsh, simplified)

- Append-only JSONL per session; the model-visible history is **derived from the log** — every model request must be reconstructable from the log
- Live streaming to UI is transient; only settled messages are durable

### Context-window management (compaction)

History derives from the log, so truncation policy must live in the log's projection — not ad-hoc. Adopted from pi and dsh (both treat this as first-class):

- Threshold-based compaction: when history approaches the model's context budget, a compaction step summarizes older turns into a durable summary entry appended to the log
- The projection defines what is dropped (large old tool results first — pi's rule: drop tool results >N messages old), what is merged, and what is summarized
- Compaction is reconstructable: the summary references the log range it replaced (first-kept-entry id), so a fresh reader can always rebuild or re-derive
- Plugins may replace the compaction strategy (an extension seam, like pi's `session_before_compact`)

### Error & retry policy

- Malformed tool calls / schema-validation failures: reported to the model as tool errors (the model retries) — never crash the loop
- Provider errors: rate limits and 5xx retried with exponential backoff (bounded); auth errors surfaced to the user immediately
- pi-ai's built-in token/cost tracking is surfaced in the session log and UI (per-turn and per-session cost)
- A failed step records missing tool results (dsh's model) so the log never shows a dangling call

### Agent loop

- A **step** = one model request + the tools it calls; a **turn** = zero or more steps, closing when nothing is owed
- Tool calls flow through a guarded pipeline: pre-execute → execute → post-execute, with approval policy as a pre-execute listener (policy plugins can intercept)
- **Async-first:** the loop is `async/await` with streaming as async generators; tool calls run as Promises (parallel calls with a concurrency limit); cancellation via `AbortSignal` end-to-end (stream stop, tool kill, heartbeat abort); heartbeat is its own async scheduler; sessions are concurrent async tasks in one process. CPU-heavy work (PDF parsing, bulk search) moves to worker threads or a Rust sidecar only if it ever blocks the loop.
- History/context derived from the session log; system prompt assembled from registered sections

### Memory system (the differentiator)

Four function types (from the research: CoALA + "Memory in the Age of AI Agents" survey + how Claude Code / Grok Build / dots actually ship):

- **Episodic** → SQLite: raw events, observations inbox (append-only)
- **Semantic** → markdown topic files (`topics/*.md`), distilled by consolidation
- **Procedural** → markdown: learned conventions, "how the user likes work done"
- **Working** → the live session context

Rules (adopted from all three reference products):
- Capture after every turn in background (never blocks the session)
- **Dream**: periodic consolidation pass — merge new notes into topic files, delete contradicted facts, prune low-value notes, keep the `MEMORY.md` index small
- Retrieval: model reads the index + relevant topic files; no embeddings; SQLite FTS5 only if the index outgrows it
- Never store what's derivable from the environment (repo/docs) — store pointers
- Memories are point-in-time observations; freshness warnings for old notes

### Tools & skills (the coding-agent layer)

**Tool philosophy (from pi):** a minimal orthogonal toolset that composes into full coding ability:

- Core tools: `bash`, `read`, `write`, `edit`, `glob`, `grep`
- **Bash-on-Windows decision:** the `bash` tool spawns the platform shell — **PowerShell on Windows** (the dev machine's native shell), `bash`/`sh` on Unix. The user's shell preference is config. `grep` is backed by a **bundled ripgrep binary** (pi downloads ripgrep/fd from GitHub releases — same pattern); `glob` is pure Node fs, no external dependency
- One tool registry; schemas join prompt assembly; guarded pipeline: **pre-execute → execute → post-execute**
- **Tool preview:** `edit`/`write` render a diff before applying; `bash` shows the command first — previews surface in the UI. **CLI approval UX (Phase 0):** interactive confirm / allow-for-this-session, before any guarded tool runs
- **Temp save:** outputs exceeding a size threshold (~4 KB) spill to a per-session directory under the OS temp dir (`$TMPDIR/nunnuncode/sessions/<id>/`); the path is returned to the agent; spill files are cleaned on session close and swept on daemon boot (TTL-based)
- Trust ladder hooks in as pre-execute listeners (confirm, observe-only, block)
- Plugins may register additional tools (SQL, PDF, MCP) on the same registry

**Skills manager (Phase 1):**

- Skill = folder with `SKILL.md` (frontmatter: name, description, when-to-use) + optional scripts (run via `bash`)
- Directories: global `~/.nunnun/skills/`, project `<project>/.nunnun/skills/`, and compatibility with the existing `.agents/skills/` convention
- **Progressive disclosure:** only the index (name + one-line description) enters the system prompt; full body loads on demand — scales to hundreds of skills without context bloat
- **Self-evolution:** the dream pass promotes recurring procedures into skills — **as proposals the user must accept** (auto-generated executable capability never activates without human review, keeping the trust ladder intact)



### Model-facing event vocabulary (user-facing parts)

Every assistant message is a list of **parts**, both streamed live and persisted in the session log:

- `text` — the assistant's prose
- `thinking` — reasoning/reasoning blocks, streamed as collapsible deltas, never dropped (pi-ai normalizes them across providers)
- `tool-call` — tool name + input, opened when the model calls
- `tool-result` — output or diff, closed when execution settles

**Per-tool renderers** (Claude Code's signature UX): each registered tool ships a UI renderer — `bash` → command + output, `edit`/`write` → unified diff preview, `read` → file excerpt, `glob`/`grep` → result list, temp-save → path link. The frontend consumes only session events; new tools get renderers without touching the loop.

### Web UI security (Phase 3)

A local server that can drive `bash` + `write` is an RCE surface. Non-negotiables from day one of Phase 3: bind to `127.0.0.1` only (LAN binding is an explicit, opt-in config with a warning); a generated bearer token required for every request (the UI reads it from the daemon's startup output); strict origin/check on state-changing requests (CSRF + DNS-rebinding defense); SSE streams validated the same way. No session may run with more trust than the trust ladder grants the surface it came from.

### Sessions: one resident bot + interactive sessions (dsh-inspired)

One daemon process hosts multiple concurrent sessions; each session = an agent-loop instance with its own JSONL session log, own context, own tool-trust state:

```
one daemon process
├── bot session        ← resident, always-on; heartbeat-driven; may post into user sessions;
│                         observe-only until a written rule allows action
├── user session A     ← interactive (CLI or web), created on demand
└── user session B     ← another terminal/window, same machine
```

- One inbox feeds each session's driver; queued input waits for turn boundaries (dsh's model)
- The bot can initiate: posting into a user session or messaging the user when a person must act
- Sessions share the plugin runtime, tool registry, skills, and global memory; project memory and logs stay per-scope
- The bot is an ordinary session with a persistent lifecycle — not a special core path

### Heartbeat (always-on)

- A scheduler plugin: wake every N minutes → read inbox/state → act, schedule, or ignore → stay silent by default → occasionally run the dream pass
- Outreach only when: a task finished, a decision is needed, or it cannot finish. One concrete question at a time, structured
- Proactive work starts in **observe-only mode** (records what it would have done); real action needs a written rule the user authored

## Phases

| Phase | Name | Proves | Ships |
|---|---|---|---|
| 0 | The seed | it can reason and act — **a working coding agent, minimal as pi** | selective vendor of `pi-agent-core` + tools + skills loader + `pi-ai`, absorbed into: plugin runtime (config-driven composer) + loop + session log + `ModelProvider` seam + pi toolset (`bash`, `read`, `write`, `edit`, `glob`, `grep`) with preview/temp-save pipeline + CLI chat |
| 1 | The skills | it can learn procedures | skills manager: `~/.nunnun/skills/`, `<project>/.nunnun/skills/`, `.agents/skills/` compat; progressive disclosure |
| 2 | The memory | it can remember | two-layer memory plugin (global + project workspace, SQLite inbox) + dream consolidation |
| 3 | Always-on | it can wake and be reached | heartbeat daemon + web chat UI (assistant-ui) |
| 4 | The hands | it can reach beyond the shell | MCP client plugin; SQL tool (read-only default); PDF folder tool |
| 5 | The colleague | it can act before being asked | sources (GitHub/file watchers), rules, observe-only mode, approval panel |
| 6 | The open source | others can use it | packaging (single `npx` entry), config profiles, docs, release |

Each phase ships something usable daily and proves exactly one property. (Phase 3 is the acknowledged exception: heartbeat and web chat ship together because the UI is how the wake is *seen* — the phase proves "it can wake and be reached" as one property.)

## UI surfaces by phase

| Surface | Phase |
|---|---|
| Chat (streaming, assistant-ui) | 3 |
| Workspace browser (memory files, inbox) | 3 (read-only) → 4 (edit) |
| Activity log (what the daemon did) | 4 |
| Approval queue / panel | 5 |

## Resolved decisions (from builder check)

- **Trust model (defaults):** Interactive chat sessions confirm `bash`/write tool calls before execution (session-level "allow for this session" option); reads are unrestricted. Heartbeat/daemon runs **observe-only** until Phase 5 rules exist — it records what it would do, does nothing. Known risk: a single-process daemon means a crash takes chat + heartbeat down together with no supervision until Phase 6 — acceptable for a personal tool; revisit if it bites.
- **World scope:** **Global personal memory** (`~/.nunnun/` — one dot-directory for everything: skills, memory, config): one memory workspace per user — the assistant is a person's assistant, not a repo's. Sessions are per working directory (coding work stays repo-scoped); memory stays global with topic files that can reference projects.
- **Concurrency:** The loop is session-scoped; multiple sessions may run concurrently (chat session + heartbeat session in parallel). Single user, one daemon process.
- **Cost envelope:** Heartbeat wakes are **local** — check SQLite inbox/state; an LLM is consulted only when items are pending. Dream pass cadence: conservative default (≥24h since last consolidation AND new unconsolidated notes — Claude Code's dual-gate). Background LLM spend is config-capped.
- **Dream undo:** The memory workspace is a **git repo**; the dream pass auto-commits before and after consolidating. Nothing is deleted without a recoverable commit. User hand-edits are picked up by reading the workspace fresh each wake.
- **Provider order:** OpenAI-compatible adapter first (matches current usage: OpenRouter, custom `API_BASE_URL` gateways); Anthropic second.
- **Always-on on Windows (Phase 3):** daemon starts manually (`nunnuncode daemon` in a terminal). Autostart at login, supervision/restart, scheduled-task setup = Phase 6 packaging.
- **Phase 3 heartbeat:** scheduler over the SQLite inbox: user to-dos, agent self-reminders, queued observations. LLM consulted only when the inbox is non-empty. Sources arrive in Phase 5.

- **Carry-over from today's nunnuncode:** clean rewrite; the **name**, the `.env` conventions (`API_BASE_URL`/`API_KEY`/`MODEL`), and the trilingual READMEs (EN/DE/VI, done in Phase 6) carry over. No Python code carries.

## Open for the owner (unanswered by the check)

- Timeline/pace expectation — *resolved in conversation: momentum-first, Phase 0 in 1–2 weeks, deliberate where it differentiates, borrowed where it doesn't*
- Build on pi's SDK vs. own everything — *resolved: **approach 4, selective vendor** (`pi-agent-core` + tools + skills loader + `pi-ai`), absorbed-and-pruned in Phase 0 with a guided walkthrough*
- Multi-session architecture (one resident bot session + multiple interactive user sessions) — *resolved in conversation; documented in the session architecture*

## What's left to the builder (my calls, noted)

- Exact plugin manifest format and event naming — follow dsh patterns where borrowed; the Phase 0 simplification cap is binding
- SQLite schema details (inbox, events, schedule tables)
- System prompt section format
- Whether the CLI lives in the same process as the daemon (proposal: yes for Phase 3; separate entrypoints `nunnuncode chat` / `nunnuncode daemon` / `nunnuncode web`)
- Project name: keep **nunnuncode** (user to confirm)
- License: MIT (matches the ecosystem norm)
