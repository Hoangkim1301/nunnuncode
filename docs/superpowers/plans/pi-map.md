# pi Absorption Map — Phase 0

Source: `earendil-works/pi` tag **v1.5.0** (commit f9a26365568127461c47a07a37dcb42c140a3ac5, 2026-11-02)
Vendored into: `packages/vendor/pi/` (ai, agent, schema, telemetry, coding-agent-tools)

This map is the keep / reshape / delete verdict for every module we vendored.
Every cut below is decided together with the owner; the map is the record.

## 1. `agent` (pi-agent-core) — 6 files, 2,321 lines

| File | Lines | Verdict | Notes |
|---|---|---|---|
| `agent-loop.ts` | 870 | **KEEP (reshape)** | `agentLoop` / `runAgentLoop` / `runToolCall` — the turn/step engine, tool dispatch, `beforeToolCall`/`afterToolCall` hooks. This *is* the heart we want. Reshape: drive it from our JSONL session log (pi keeps state in `AgentState` in memory), emit our `LiveEvent` vocabulary, and route tool execution through our guarded pipeline instead of its direct `beforeToolCall` → execute path. |
| `types.ts` | 511 | **KEEP (mostly)** | `AgentTool`, `AgentToolResult`, `AgentToolCall`, `ThinkingLevel`, `AgentLoopConfig`, `AgentEvent` — solid vocabulary. `CustomAgentMessages` module augmentation: keep (memory plugin will use it later). Trim: whatever only serves the deleted modules. |
| `agent.ts` | 557 | **KEEP (reshape)** | The `Agent` class — stateful wrapper (system prompt, tools, history, streaming). Our multi-session layer (bot session + user sessions) needs exactly this shape; we reshape it to persist through `SessionStore` and expose our interface. |
| `stream-fn.ts` | 17 | **KEEP** | `setDefaultStreamFn` — tiny glue between the loop and pi-ai. |
| `proxy.ts` | 359 | **DELETE** | `streamProxy` — transports assistant streams over a wire (for remote/proxied providers). No Phase 0 consumer; revisit only if a remote-runner feature ever appears. |
| `index.ts` | 5 | **REWRITE** | Re-export only what survives. |

## 2. `ai` (pi-ai) — 209 files, ~26,300 lines

Verdict: **KEEP as-is for Phase 0** — it is the borrowed plumbing layer, tested green (1,771 unit tests pass; 10 credential-E2E files excluded, documented in its vitest config).

- Absorbed fixes: `@smithy/types` added as an explicit dependency (phantom dep in pi's repo, resolved by npm hoisting there); `pi-schema` aliased to source in vitest configs (pnpm-strict resolution).
- Deferred pruning (not Phase 0): provider set can shrink later (we use OpenAI-compatible + Anthropic first; Bedrock/Vertex/Copilot code stays until proven unused — deleting it early risks breaking shared API plumbing for marginal line savings).

## 3. `schema` (pi-schema) — TypeBox-based JSON Schema validator

Verdict: **KEEP as-is** — green (291 tests). `conformance.test.ts` excluded (fails identically upstream at v1.5.0 — 936 cases, pre-existing). This is pi's TypeBox distribution; tool schemas are TypeBox-native per the spec.

## 4. `telemetry` — 8 files, ~1,500 lines

Verdict: **KEEP for now** — dependency of pi-ai (imported at top level), tests green (47). Candidate for deletion in the reduce pass *only if* its removal is clean; the cost/benefit is marginal either way.

## 5. `coding-agent-tools` — 15 tool files + 9 utils, ~4,000 lines

| File | Verdict | Notes |
|---|---|---|
| `bash.ts` | **KEEP (reshape)** | Spawns shell via `getPowerShellConfig` — Windows-first, as spec requires. Reshape: our pipeline wraps it; per-call cwd, timeout, output file streaming. |
| `powershell.ts` | **KEEP** | The PowerShell-native tool (a second shell tool) — pi's answer to Windows. Keep both `bash` and `powershell`; CLI defaults decide which the model sees. |
| `edit.ts`, `edit-diff.ts` | **KEEP** | Exact-match string replacement + diff computation — matches our preview design. |
| `read.ts` | **KEEP** | Line ranges, truncation, image support. |
| `write.ts` | **KEEP** | Overwrite-write with diff preview. |
| `grep.ts` | **KEEP** | **Ripgrep-backed** — matches spec. Uses `ensureTool` (tools-manager) to fetch the rg binary. |
| `find.ts`, `ls.ts` | **KEEP (decided with owner)** | Cheap, orthogonal; not in our spec'd six. Owner decision: **keep** — the model's ergonomics (fewer bash round-trips) matter more than tool-count minimalism; ~100 lines each. |
| `output-accumulator.ts`, `truncate.ts` | **KEEP** | Output size guards — our temp-spill design plugs in here. |
| `path-utils.ts`, `file-mutation-queue.ts` | **KEEP** | Path safety + serialized file mutations. |
| `render-utils.ts`, `renderers/*` | **DELETE (done at copy)** | TUI renderers — replaced by our per-tool renderers (spec: event vocabulary section). |
| `tool-definition-wrapper.ts` | **DELETE** | Bridges coding-agent's `ExtensionContext` tool definitions — our `Tool` interface replaces it. |

**Utils (copied alongside):** `shell.ts` (236), `paths.ts` (163), `ansi.ts` (75), `text.ts` (8), `child-process.ts` (122), `output-files.ts` (29), `mime.ts` (101), `image-process.ts` (104), `tools-manager.ts` (344 — the ripgrep/fd binary fetcher; will be reshaped to fetch rg only).

## 6. What our architecture replaces (not vendored)

- **Session log:** pi keeps conversation in `AgentState` (memory + attachments). Our append-only JSONL `SessionStore` with derived history replaces it — the loop is reshaped to read/write through it (Task 3 + 5).
- **Tool pipeline:** pi's `beforeToolCall`/`afterToolCall` hooks become listeners in our guarded pipeline (`pre-execute → execute → post-execute`, Task 6) — same shape, our policy vocabulary (`allow/confirm/deny/observe`).
- **Plugin runtime:** pi has none of this (its extensions live in coding-agent, which we did not vendor). Task 4 builds the minimal composer.
- **CLI/chat:** pi's TUI + CLI not vendored (spec decision).

## 7. Expected net size after absorption

- agent package: ~2,321 → ~1,600 lines (proxy deleted, loop reshaped)
- tools: ~4,000 → ~2,000 lines (renderers/wrapper gone, utilities pruned)
- ai/schema/telemetry: as vendored (~32k lines of owned, tested plumbing)
- Our new code (session, composer, pipeline, CLI): ~1,500 lines

## Baseline state (committed)

- `pnpm --filter @earendil-works/pi-ai test` → 1,771 passed (10 credential-E2E files excluded)
- `pnpm --filter @earendil-works/pi-agent-core test` → 95 passed
- `pnpm --filter @earendil-works/pi-schema test` → 291 passed (conformance excluded, pre-existing failure)
- `pnpm --filter @earendil-works/pi-telemetry test` → 47 passed
- Builds: `tsc -p tsconfig.build.json` green for ai, agent, schema
