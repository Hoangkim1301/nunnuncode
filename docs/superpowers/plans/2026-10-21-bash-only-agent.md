# Bash-only Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Nunnuncode to a minimal, single-file agent that exposes only an immediately executed Bash tool.

**Architecture:** Keep the original first-commit Python script, provider adapters, interactive loop, and Bash implementation. Remove later modules and tools, leaving `nanocode.py` as the sole runtime Python file; both provider schemas will advertise only `bash(cmd: string)`.

**Tech Stack:** Python standard library, `unittest`, Git.

**Spec:** `docs/superpowers/specs/2026-10-21-bash-only-agent-design.md`

## Global Constraints

- Keep the existing Git history; do not reset, rewrite, or force-push commits.
- A Bash call runs immediately, without a confirmation prompt.
- The tool accepts one required string parameter, `cmd`.
- Keep the original interactive loop, conversation history, provider support, and terminal interface from the first commit.
- Keep the original one-file layout (`nanocode.py`) and zero-dependency approach.
- Remove the untracked `tests/test_context.py`; it tests context-compaction code that is being removed.
- Both provider schemas expose exactly one function named `bash`, with an object input schema containing required string property `cmd`.
- Unrelated ignored or untracked files are outside the cleanup scope, except for the explicitly requested removal of `tests/test_context.py`.

## Review Focus

- Anthropic schema: the model sees only `bash`, with `cmd` as the sole required string; pin this in Task 2.
- OpenAI-compatible schema: the model sees only the equivalent `bash` function; pin this in Task 2.
- Legacy tool request: a response naming `glob` or another removed tool returns an error and does not execute anything; pin this in Task 2.
- Empty command output: preserve the baseline `(empty)` result; pin this in Task 2's end-to-end Bash cycle.
- Bash stderr: preserve the baseline behavior that combines stderr with stdout and returns it; pin this in Task 2's end-to-end Bash cycle.

---

## File map

- `nanocode.py` — restore the original standalone agent, then retain only the Bash handler and its schema/dispatch entry.
- `tests/test_e2e.py` — restore the original mock-provider end-to-end tests and add observable checks for the single-tool schemas and Bash behavior.
- `README.md`, `README_DE.md`, `README_VI.md` — document the one-tool design and replace the prior feature roadmap with the minimal project direction.
- `.env.example` — restore the first-commit provider examples.
- Later-added modules, tests, and architecture documents — remove because they are outside the selected single-file baseline.
- `docs/superpowers/specs/2026-10-21-bash-only-agent-design.md` and this plan — retain as records of the approved change.

## Task 1: Restore the First-Commit Baseline

**Files:**
- Restore: `.env.example`, `README.md`, `README_DE.md`, `README_VI.md`, `nanocode.py`, `tests/test_e2e.py` from commit `b7a3320`.
- Delete: `AGENTS.md`, `_tmp.txt`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/superpowers/plans/2026-09-22-module-split.md`, `docs/superpowers/specs/2026-09-22-module-split-design.md`, `nunnuncode/config.py`, `nunnuncode/kernel.py`, `nunnuncode/llm.py`, `nunnuncode/nunnuncode.py`, `nunnuncode/tools.py`, and `tests/test_kernel.py`.
- Delete: untracked `tests/test_context.py` as explicitly requested.
- Retain: the approved Bash-only design spec and this implementation plan.

**Interfaces:**
- Consumes: first-commit tree `b7a3320`.
- Produces: the original functional single-file agent and original end-to-end suite, before the tool list is reduced.

- [x] **Step 1: Restore baseline source, provider example, and documentation copies**

```powershell
git restore --source b7a3320 --worktree -- .env.example README.md README_DE.md README_VI.md nanocode.py tests/test_e2e.py
```

- [x] **Step 2: Remove post-baseline files and incompatible context tests**

```powershell
git rm -- AGENTS.md _tmp.txt docs/ARCHITECTURE.md docs/ROADMAP.md docs/superpowers/plans/2026-09-22-module-split.md docs/superpowers/specs/2026-09-22-module-split-design.md nunnuncode/config.py nunnuncode/kernel.py nunnuncode/llm.py nunnuncode/nunnuncode.py nunnuncode/tools.py tests/test_kernel.py
Remove-Item tests/test_context.py
```

- [x] **Step 3: Verify the restored baseline still runs**

Run: `python -m unittest discover tests`

Expected: all original end-to-end tests pass against root `nanocode.py`.

- [x] **Step 4: Commit the baseline restoration**

```powershell
git add -u
git commit -m "Restore the first-commit agent baseline"
```

- [x] **Step 5: Commit the restored root entrypoint**

The baseline `nanocode.py` path was deleted in the current HEAD, so `git add -u` did not stage the restored file. Add it explicitly in a follow-up commit.

```powershell
git add nanocode.py
git commit -m "Restore the original agent entrypoint"
```

## Task 2: Expose Bash as the Sole Tool

**Files:**
- Modify: `nanocode.py` tool implementations and `TOOLS` table.
- Modify: `tests/test_e2e.py` schema and Bash behavior tests.

**Interfaces:**
- Consumes: restored module-level `make_schema()`, `make_openai_schema()`, `run_tool(name, args)`, and `bash(args)` functions.
- Produces: both schemas contain only `bash`, whose required input is `cmd: string`; dispatch contains no other tool.

- [x] **Step 1: Add schema, dispatch, and retained Bash behavior tests**

Add tests to `tests/test_e2e.py` that import `nanocode` and assert:

```python
def test_anthropic_schema_contains_only_bash(self):
    tools = nanocode.make_schema()
    self.assertEqual([tool["name"] for tool in tools], ["bash"])
    self.assertEqual(tools[0]["input_schema"]["properties"], {"cmd": {"type": "string"}})
    self.assertEqual(tools[0]["input_schema"]["required"], ["cmd"])

def test_openai_schema_contains_only_bash(self):
    tools = nanocode.make_openai_schema()
    functions = [tool["function"] for tool in tools]
    self.assertEqual([tool["name"] for tool in functions], ["bash"])
    self.assertEqual(functions[0]["parameters"]["properties"], {"cmd": {"type": "string"}})
    self.assertEqual(functions[0]["parameters"]["required"], ["cmd"])

def test_removed_tool_name_is_not_dispatched(self):
    result = nanocode.run_tool("glob", {"pat": "*.py"})
    self.assertTrue(result.startswith("error:"))
```

Also change the existing mock-provider test to invoke `bash` twice in the same assistant response: first `echo hello 1>&2`, then `exit`. Assert that the next OpenAI-compatible request contains two tool results, respectively `hello` and `(empty)`. The subprocess helper already sets `PYTHONIOENCODING=utf-8` so this exercises the real shell and tool-result path without depending on the test runner's console encoding.

- [x] **Step 2: Run the focused tests and confirm they fail against the six-tool baseline**

Run: `python -m unittest discover -s tests -p test_e2e.py`

Expected: schema assertions fail because the baseline still advertises six tools, and the removed-tool assertion fails because `glob` still runs. The updated end-to-end Bash assertions pass against the baseline.

- [x] **Step 3: Remove non-Bash handlers and definitions from `nanocode.py`**

Keep `bash(args)` and the generic schema/dispatch functions. Remove the `globlib` import, the `read`, `write`, `edit`, `glob`, and `grep` functions, and all corresponding entries in `TOOLS`. Keep `re` because `render_markdown()` still uses it. Leave the Bash entry with description `Run shell command`, schema `{"cmd": "string"}`, and the existing direct-execution implementation.

- [x] **Step 4: Run the focused and complete test suites**

Run: `python -m unittest discover -s tests -p test_e2e.py`

Expected: PASS, including the existing mock API tool-call test, which invokes `echo hello` through Bash.

Run: `python -m unittest discover tests`

Expected: PASS.

- [x] **Step 5: Commit the single-tool change**

```powershell
git add nanocode.py tests/test_e2e.py
git commit -m "Expose only the Bash tool"
```

## Task 3: Update the Project Direction in All READMEs

**Files:**
- Modify: `README.md`, `README_DE.md`, `README_VI.md`.

**Interfaces:**
- Consumes: actual one-file implementation and schema verified in Task 2.
- Produces: consistent English, German, and Vietnamese descriptions of the Bash-only agent and no roadmap for additional tools or capability subsystems.

- [x] **Step 1: Update the English README**

Describe `bash` as the sole tool. Replace the six-tool feature list and tools table with the single Bash tool, change the example from `Glob(**/*.py)` to a Bash command such as `echo hello`, remove the obsolete `edit`-constraint learning note, and replace the roadmap with: keep the agent single-file and Bash-only; future changes are limited to correctness and portability of the agent loop and shell execution.

- [x] **Step 2: Update the German and Vietnamese READMEs to match**

Make the same behavioral and roadmap changes in `README_DE.md` and `README_VI.md`; retain their existing language, provider instructions, attribution, and license sections.

- [x] **Step 3: Check that the documentation no longer describes removed tools or future subsystems**

Run:

```powershell
rg -n 'Tools:|Werkzeuge|Công cụ|`read`|`write`|`edit`|`glob`|`grep`|web-fetch|Web-Fetch|tool web|Tool web' README.md README_DE.md README_VI.md
```

Expected: no stale list or promise of removed tools remains; `bash` is the only tool documented in each README.

- [x] **Step 4: Run tests and confirm the source tree and commit history**

Run: `python -m unittest discover tests`

Expected: PASS.

Run: `git ls-files '*.py'`

Expected: only `nanocode.py` and `tests/test_e2e.py` are tracked Python source/test files.

Run: `git log --reverse --oneline`

Expected: all pre-existing commits remain in order, followed by this task's additive commits.

- [x] **Step 5: Commit the README direction update**

```powershell
git add README.md README_DE.md README_VI.md
git commit -m "Document the Bash-only agent direction"
```

- [x] **Step 6: Commit this approved implementation plan**

```powershell
git add docs/superpowers/plans/2026-10-21-bash-only-agent.md
git commit -m "Record the Bash-only implementation plan"
```
