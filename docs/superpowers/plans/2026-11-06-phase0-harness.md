# Phase 0 — The Seed: Minimal Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working minimal coding agent in TypeScript — our own harness (plugin composer, agent loop, JSONL session log, `ModelProvider` seam, pi toolset with preview/temp-save, CLI chat), with pi's core absorbed and reshaped into our architecture.

**Architecture:** Selective vendor of pi (MIT): `pi-agent-core`, the coding-agent tools, and `pi-ai` are copied into the repo, then absorbed-and-pruned into our package layout. Everything above the LLM plumbing is ours. Monorepo: pnpm workspaces. The plugin runtime is a config-driven module composer (spec's binding cap — no Cordis machinery).

**Tech Stack:** TypeScript 5.x (ESM, strict), Node 22.19+, pnpm workspaces, Vitest, better-sqlite3 (Phase 2 — not here), pi-ai (vendored), ripgrep binary (bundled, for `grep`).

**Spec:** `docs/superpowers/specs/2026-11-06-personal-agent-harness-design.md` — executors read both.

## Global Constraints

- Node ≥ 22.19; TypeScript strict, ESM only (`"type": "module"`)
- pnpm workspaces; packages under `packages/`, app under `apps/`
- No agent framework in the core — the loop, session log, and plugin composer are ours; pi-ai is the only LLM plumbing, vendored, behind `packages/harness/src/providers/ModelProvider.ts`
- Vendored files keep their MIT license headers and carry a `// vendored from earendil-works/pi <sha>` marker until absorbed
- Windows-first: `bash` tool spawns PowerShell by default (config-switchable); `grep` uses a bundled ripgrep binary; `glob` is pure Node fs
- Env conventions carried from today: `API_BASE_URL`, `API_KEY`, `MODEL` (OpenAI-compatible default; OpenRouter works as `API_BASE_URL=https://openrouter.ai/api/v1`)
- One commit per task; tests run with `pnpm -r test`
- Names: CLI binary `nunnuncode`; home dir `~/.nunnun/` (created only when first needed — Phase 0 does not create it)

## Review Focus

1. **Malformed tool calls from the model** — the loop must report them to the model as tool errors and continue the turn, never crash. Test: loop task feeds a tool call with invalid args; expects a `tool-result` with `isError: true` and the turn continuing.
2. **Cancellation mid-tool** — `AbortSignal` must kill a spawned shell process and abort an in-flight stream. Test: bash tool task starts a long process, aborts; expects the child process to be gone and the promise rejected (not hung).
3. **Torn session-log writes** — a crash mid-append must not corrupt prior events; the reader tolerates a trailing partial line. Test: session-log task appends a truncated JSON line; the store loads all prior events and ignores the partial one.
4. **Observe-only mode must never execute** — when policy returns `observe`, the pipeline records intent and returns a "would have run" tool-result without touching the real world. Test: pipeline task with an observe policy on `bash`; expects no child process spawned.
5. **Windows shell quoting** — arguments with spaces/special chars must survive PowerShell invocation. Test: bash tool runs `echo hello world` and `echo a"b` equivalents; output matches expectation.

---

### Task 0: Monorepo scaffold

**Files:**
- Create: `package.json` (root, workspaces), `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` update
- Create: `packages/harness/package.json`, `packages/cli/package.json` (minimal stubs)
- Create: `vitest.config.ts` (base config shared)
- Move: `nunnuncode.py`, `README*.md`, `tests/` → `legacy/` (Python agent preserved as reference, git history carries)

**Interfaces:**
- Produces: workspace `@nunnun/harness` and `@nunnun/cli`; `pnpm test` script at root

- [ ] **Step 1:** Create workspace files; move Python agent to `legacy/` (git mv)
- [ ] **Step 2:** `pnpm install` succeeds; `pnpm -r exec tsc --noEmit` passes on empty packages
- [ ] **Step 3:** Commit: `chore: scaffold TypeScript monorepo`

### Task 1: Vendor + map pi (interactive — the user decides the cuts)

**Files:**
- Create: `packages/vendor/pi/` (copied source, license headers kept)
- Create: `docs/superpowers/plans/pi-map.md` (the absorption map)

**Interfaces:**
- Produces: the absorption map — per-module verdicts (keep/reshape/delete) that Tasks 2–6 consume; a green baseline: pi's own unit tests for the vendored packages pass in our workspace

- [ ] **Step 1:** Clone `earendil-works/pi` at a pinned tag; copy `packages/ai`, `packages/agent`, and the tool sources from `packages/coding-agent` (tools only, not CLI/TUI) into `packages/vendor/pi/`; keep LICENSE + record the tag/sha in `pi-map.md`
- [ ] **Step 2:** Wire vendored packages into the workspace; run their tests unmodified — establish the green baseline
- [ ] **Step 3:** Walk the code with the user, module by module: produce `pi-map.md` with **keep / reshape / delete** verdicts, line counts, and rationale per module (this is the guided absorption; every cut is a joint decision)
- [ ] **Step 4:** Checkpoint: user approves the map before any code is cut
- [ ] **Step 5:** Commit: `chore: vendor pi core + absorption map`

### Task 2: `ModelProvider` seam over pi-ai

**Files:**
- Create: `packages/harness/src/providers/types.ts`, `providers/pi-provider.ts`
- Test: `packages/harness/test/providers/pi-provider.test.ts`

**Interfaces:**
- Consumes: vendored `pi-ai` (`streamSimple`, `Model` registry)
- Produces:
```ts
interface ModelProvider {
  stream(req: { system: string; messages: ModelMessage[]; tools: ToolSchema[]; signal?: AbortSignal }): AsyncIterable<StreamEvent>
}
// StreamEvent: { type: 'text-delta'|'thinking-delta'|'tool-call', ... } | { type: 'done', usage }
```

- [ ] **Step 1:** Failing test: provider yields text-delta events for a mock stream; thinking blocks map to `thinking-delta`; tool calls map to `tool-call` with TypeBox-shaped args; `signal` aborts mid-stream
- [ ] **Step 2:** Run: `pnpm --filter @nunnun/harness test` — FAIL
- [ ] **Step 3:** Implement the seam wrapping pi-ai; no other harness code imports pi-ai directly (enforced by an import-lint test)
- [ ] **Step 4:** Failing test additions: provider 429/5xx retried with bounded exponential backoff (spec's error policy); auth errors surfaced immediately, not retried — then implement
- [ ] **Step 5:** Run tests — PASS; commit: `feat: ModelProvider seam over vendored pi-ai`

### Task 3: Session log

**Files:**
- Create: `packages/harness/src/session/store.ts`, `session/events.ts`, `session/derive.ts`
- Test: `packages/harness/test/session/*.test.ts`

**Interfaces:**
- Produces:
```ts
type SessionEvent = { seq: number; ts: number; type: EventType; data: unknown } // EventType union: turn/start|step/*|user/message|assistant/message|tool/call|tool/result|...
class SessionStore {
  static open(path: string): SessionStore      // tolerant of trailing partial line
  append(type: EventType, data: unknown): SessionEvent
  events(): readonly SessionEvent[]
  deriveMessages(): ModelMessage[]             // model-visible history from the log
}
```

- [ ] **Step 1:** Failing tests: append→load roundtrip; derived messages skip non-model-visible events; **torn-tail tolerance** (truncated last line ignored — Review Focus 3); compaction entry replaces a log range in derived output and carries `firstKeptEventSeq`
- [ ] **Step 2:** FAIL → implement → PASS
- [ ] **Step 3:** Commit: `feat: append-only JSONL session log with derived history`

### Task 4: Plugin composer (the Phase 0 cap)

**Files:**
- Create: `packages/harness/src/runtime/composer.ts`, `runtime/events.ts`
- Test: `packages/harness/test/runtime/*.test.ts`

**Interfaces:**
- Produces:
```ts
interface Plugin { name: string; setup(ctx: PluginContext): void }
interface PluginContext {
  registerTool(tool: Tool): void   // Tool type lives in runtime/types.ts (defined here in Task 4)
  on(event: string, handler: (payload: any) => Promise<void>): Unsubscribe  // typed at call sites via EventMap
  provide<T>(key: string, value: T): void
}
function compose(plugins: Plugin[], config: object): HarnessContext   // ordered; last wins on duplicate provide
```
- Explicitly NOT here: effect unwinding, manifest loading, hot-swap (spec cap — revisit only when a real second consumer exists)

- [ ] **Step 1:** Failing tests: two plugins compose in order; `provide` duplicate throws; events emitted in registration order; unload is out of scope (documented in test as a pending feature)
- [ ] **Step 2:** FAIL → implement → PASS; commit: `feat: minimal plugin composer`

### Task 5: Agent loop (turn/step, streaming, cancellation)

**Files:**
- Create: `packages/harness/src/loop/loop.ts`, `loop/turn.ts`
- Test: `packages/harness/test/loop/*.test.ts`

**Interfaces:**
- Consumes: `ModelProvider.stream`, `SessionStore`, tool registry from composer
- Produces:
```ts
class AgentLoop {
  constructor(ctx: HarnessContext, session: SessionStore, provider: ModelProvider)
  run(input: string, signal?: AbortSignal): AsyncIterable<LiveEvent>  // LiveEvent mirrors StreamEvent + tool lifecycle
}
```

- [ ] **Step 1:** Failing tests (mock provider): one-step turn (no tools) streams text and appends `assistant/message`; multi-step turn stops when the model stops calling tools; **malformed tool call** → `tool-result{isError}` + loop continues (Review Focus 1); **abort mid-stream** → generator ends, no dangling `tool/call` in log (Review Focus 2 partial)
- [ ] **Step 2:** FAIL → implement (reshape pi-agent-core's loop to this shape per the map) → PASS
- [ ] **Step 3:** Commit: `feat: agent loop with turn/step, streaming, cancellation`

### Task 6: Tool registry + guarded pipeline + approval policy

**Files:**
- Create: `packages/harness/src/tools/registry.ts`, `tools/pipeline.ts`, `tools/policy.ts`
- Test: `packages/harness/test/tools/*.test.ts`

**Interfaces:**
- Consumes: `Tool` type; composer
- Produces:
```ts
interface Tool { name: string; description: string; schema: TSchema; execute(input: unknown, ctx: ToolContext): Promise<ToolResult> }
type PolicyDecision = 'allow' | 'confirm' | 'deny' | 'observe'
async function runPipeline(tool: Tool, input: unknown, ctx: ToolContext): Promise<ToolResult>
// pre-execute listeners may rewrite/deny; 'observe' records intent and returns a would-have-run result WITHOUT executing (Review Focus 4)
type ConfirmFn = (req: { tool: string; input: unknown }) => Promise<'once' | 'session' | 'deny'>
```

- [ ] **Step 1:** Failing tests: parallel calls honor concurrency limit; deny/confirm flows; **observe executes nothing** (spy on execute); tool errors become `tool-result{isError}` (never throw past the pipeline); session-allow memoizes
- [ ] **Step 2:** FAIL → implement → PASS; commit: `feat: guarded tool pipeline with policy`

### Task 7: The six tools

**Files:**
- Create: `packages/plugin-tools/src/{bash,read,write,edit,glob,grep}.ts`, `src/ripgrep.ts` (binary resolution)
- Test: `packages/plugin-tools/test/*.test.ts`

**Interfaces:**
- Consumes: `Tool` interface; pipeline
- Produces: six tools registered as one `toolsPlugin`; schemas in TypeBox; preview payloads on `ToolResult` for `edit`/`write` (unified diff) and `bash` (command echo)

- [ ] **Step 1:** Failing tests per tool: `read` line ranges; `write` overwrite; `edit` exact-match replace (unique match, else error); `glob` patterns; **`bash` runs PowerShell on win32 with quoting intact** (Review Focus 5); **abort kills the child process** (Review Focus 2); `grep` uses bundled ripgrep (skippable if binary missing, with a clear error)
- [ ] **Step 2:** FAIL → implement → PASS; commit: `feat: pi toolset (bash/read/write/edit/glob/grep)`

### Task 8: Preview + temp save

**Files:**
- Create: `packages/harness/src/tools/preview.ts`, `tools/spill.ts`
- Test: `packages/harness/test/tools/preview.test.ts`, `spill.test.ts`

**Interfaces:**
- Produces:
```ts
function buildPreview(tool: string, input: unknown): PreviewPayload | null   // diff for edit/write, command for bash
function spill(value: string, sessionDir: string): { path: string } | null  // >4 KB only
function sweepSpills(root: string, ttlMs: number): number                    // boot-time cleanup
```

- [ ] **Step 1:** Failing tests: diff generation; spill threshold; sweep removes expired files only
- [ ] **Step 2:** FAIL → implement → PASS; commit: `feat: tool previews and temp spill`

### Task 9: CLI chat

**Files:**
- Create: `packages/cli/src/index.ts` (`nunnuncode chat`), `src/render.ts` (per-tool CLI renderers), `src/env.ts` (`.env` loading)
- Test: `packages/cli/test/*.test.ts` (renderers; env resolution)

**Interfaces:**
- Consumes: everything above
- Produces: `nunnuncode` bin; commands `/c` (clear), `/q` (quit); streaming text + thinking (dimmed) + per-tool renderers matching Claude Code's UX (⏺ Bash(cmd) → ⎿ output; edit → diff block); env precedence `API_BASE_URL`/`API_KEY`/`MODEL` → OpenRouter defaults

- [ ] **Step 1:** Failing tests: renderer snapshots (bash, edit-diff, spill path); env resolution matrix (custom base URL / OpenRouter / missing key → clear error)
- [ ] **Step 2:** FAIL → implement → PASS
- [ ] **Step 3:** **Live smoke test (user checkpoint):** real model roundtrip against the user's configured gateway — one turn with a tool call, cancel mid-stream, `/q` clean exit
- [ ] **Step 4:** Commit: `feat: nunnuncode CLI chat`

### Task 10: Phase 0 close-out

**Files:**
- Create: `docs/000-philosophy.md` (numbered docs start, dsh-superagent style)
- Modify: root `README.md` (new identity, quick start; trilingual update deferred to Phase 6)

- [ ] **Step 1:** Full suite green: `pnpm -r test`
- [ ] **Step 2:** Philosophy doc: the attention principle + four properties (own code, local-first, inspectable, minimal attention)
- [ ] **Step 3:** README rewrite; commit: `docs: phase 0 close-out`
- [ ] **Step 4:** Checkpoint: user validates the daily-use experience in the CLI
