# Nunnuncode Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single 502-line `nunnuncode.py` into a `nunnuncode/` folder of four single-purpose modules with zero behavior change.

**Architecture:** `config.py` is the base module (dotenv loading, env parsing into constants, ANSI colors). `tools.py` (tool implementations + schema builders) depends only on `config`. `llm.py` (API calls, message conversion, context trim) depends on `config` and `tools` (request bodies embed the tool schemas). `nunnuncode/nunnuncode.py` is the entry (REPL + terminal rendering) and imports the other three. No package, no `__init__.py`; the entry runs as `python nunnuncode/nunnuncode.py` and sibling imports resolve because the script's directory is on `sys.path`.

**Tech Stack:** Python 3 stdlib only (`urllib`, `subprocess`, `glob`, `re`, `os`). Tests: `unittest` e2e against a local mock HTTP server.

**Spec:** `docs/superpowers/specs/2026-09-22-module-split-design.md`

## Global Constraints

- Zero third-party dependencies (stdlib only)
- No behavior change: every assertion in `tests/test_e2e.py` passes unchanged; the only exception is the `load_dotenv` default-path fallback (preserves repo-root `.env` loading after the move)
- No `__init__.py`, no `pyproject.toml`, no `python -m` support
- Module names: `config`, `llm`, `tools`, `nunnuncode` (entry). Dependency chain: `config` <- `tools` <- `llm` <- `nunnuncode` (entry); no cycles
- Test command: `python -m unittest discover tests`
- Do not touch: `.env`, `.env.example`, `_tmp.txt`, `screenshot.png`, `docs/`
- Commit style: imperative, no prefix (repo history: "Rename to nunnuncode.py", "Add extended thinking/reasoning support, /compact command")

## File Structure

| File | Responsibility |
|------|----------------|
| `nunnuncode/config.py` | `load_dotenv`, env parsing into module constants, ANSI colors |
| `nunnuncode/tools.py` | `read`/`write`/`edit`/`glob`/`grep`/`bash` implementations, `TOOLS` registry, `run_tool`, schema builders |
| `nunnuncode/llm.py` | `call_api` (Anthropic + OpenAI), `to_openai_messages`, context-error detection, `trim_messages` |
| `nunnuncode/nunnuncode.py` | REPL main loop, terminal rendering, `__main__` entry |
| `tests/test_e2e.py` | (modify) point at the new folder layout |
| `README.md` | (modify) usage commands + module description |

**Line-range note:** all line ranges below refer to the current root `nunnuncode.py` (502 lines, commit `46337bf`). "Move unchanged" means copy the lines exactly, including comments and blank lines.

---

### Task 1: Split into `nunnuncode/` folder and update tests

**Files:**
- Create: `nunnuncode/config.py`
- Create: `nunnuncode/tools.py`
- Create: `nunnuncode/llm.py`
- Create: `nunnuncode/nunnuncode.py`
- Modify: `tests/test_e2e.py`
- Delete: `nunnuncode.py` (root)

**Interfaces:**
- Produces (all consumed by the entry file and tests):
  - `config.py`: `load_dotenv(path=None)`; constants `OPENROUTER_KEY`, `CUSTOM_BASE`, `CUSTOM_KEY`, `API_FORMAT`, `API_URL`, `PROVIDER`, `MODEL`, `CONTEXT_WINDOW`, `THINKING`, `THINKING_BUDGET`, `MAX_TOKENS`; colors `RESET`, `BOLD`, `DIM`, `BLUE`, `CYAN`, `GREEN`, `YELLOW`, `RED`
  - `tools.py`: `run_tool(name, args) -> str`; `make_schema() -> list[dict]`; `make_openai_schema() -> list[dict]`
  - `llm.py`: `call_api(messages, system_prompt) -> dict`; `is_context_error(err) -> bool`; `trim_messages(messages) -> list | None` (consumes `make_schema`/`make_openai_schema` from `tools.py`)
  - `nunnuncode/nunnuncode.py`: `main()`; runnable via `python nunnuncode/nunnuncode.py`

- [ ] **Step 1: Point tests at the new layout (TDD red)**

In `tests/test_e2e.py`, make exactly these changes:

1. Line 1 becomes:

```python
import json, os, shutil, subprocess, sys, tempfile, threading, unittest
```

2. Lines 5-6 (`REPO = ...` / `NANO = REPO / "nanocode.py"`) become:

```python
REPO = Path(__file__).resolve().parent.parent
PKG = REPO / "nunnuncode"
NANO = PKG / "nunnuncode.py"
sys.path.insert(0, str(PKG))
```

3. `run_isolated` (lines 43-47) becomes:

```python
def run_isolated(stdin_text, env_extra):
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copytree(PKG, Path(tmp) / "nunnuncode")
        script = Path(tmp) / "nunnuncode" / "nunnuncode.py"
        return run_nanocode(stdin_text, env_extra, script=script, cwd=Path(tmp))
```

4. `run_nanocode` signature (line 50) becomes:

```python
def run_nanocode(stdin_text, env_extra, script=None, cwd=None):
```

and its `subprocess.run(...)` call (line 62) uses `cwd=str(cwd or script.parent),` instead of `cwd=str(script.parent),`.

5. In `TestDotenv`: replace `import nanocode` with `import config` (lines 178 and 201), and `nanocode.load_dotenv(...)` with `config.load_dotenv(...)` (lines 192 and 203).

- [ ] **Step 2: Run tests, verify they fail for the right reason**

Run: `python -m unittest discover tests`
Expected: FAIL — `FileNotFoundError`/`ModuleNotFoundError` because `nunnuncode/` does not exist yet. (Not other errors.)

- [ ] **Step 3: Create `nunnuncode/config.py`**

The code block below is the **complete file content**. Its tail (from `load_dotenv()` through the ANSI colors) is lines 24-70 of root `nunnuncode.py` copied byte-for-byte; only the `load_dotenv` default-path block (the `if path is None:` branch) is new:

```python
"""nunnuncode - environment configuration"""

import os


def load_dotenv(path=None):
    if path is None:
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, ".env")
        if not os.path.exists(path):
            # .env lives at the repo root (next to .env.example), one level above
            path = os.path.join(os.path.dirname(here), ".env")
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[7:]
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_dotenv()

OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")
CUSTOM_BASE = os.environ.get("API_BASE_URL")
CUSTOM_KEY = os.environ.get("API_KEY")

if CUSTOM_BASE:
    API_FORMAT = "openai"
    API_URL = CUSTOM_BASE.rstrip("/") + "/chat/completions"
    PROVIDER = f"custom {CUSTOM_BASE}"
else:
    API_FORMAT = "anthropic"
    API_URL = "https://openrouter.ai/api/v1/messages" if OPENROUTER_KEY else "https://api.anthropic.com/v1/messages"
    PROVIDER = "OpenRouter" if OPENROUTER_KEY else "Anthropic"
MODEL = os.environ.get("MODEL")
if not MODEL:
    if API_FORMAT == "openai":
        raise SystemExit("MODEL environment variable is required when API_BASE_URL is set")
    MODEL = "anthropic/claude-opus-4.5" if OPENROUTER_KEY else "claude-opus-4-5"
try:
    CONTEXT_WINDOW = int(os.environ.get("CONTEXT_WINDOW", "0") or 0)
except ValueError:
    CONTEXT_WINDOW = 0

# --- Thinking / reasoning (extended thinking) ---
# Enable extended thinking. Set THINKING=0 to disable.
THINKING = os.environ.get("THINKING", "1").strip() not in ("0", "false", "no", "off")
try:
    THINKING_BUDGET = int(os.environ.get("THINKING_BUDGET", "4096") or 0)
except ValueError:
    THINKING_BUDGET = 4096
# Anthropic requires budget_tokens < max_tokens; cap the budget so it always fits.
if THINKING_BUDGET <= 0:
    THINKING = False
MAX_TOKENS = 8192
if THINKING:
    THINKING_BUDGET = min(THINKING_BUDGET, MAX_TOKENS - 1)

# ANSI colors
RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
BLUE, CYAN, GREEN, YELLOW, RED = (
    "\033[34m",
    "\033[36m",
    "\033[32m",
    "\033[33m",
    "\033[31m",
)
```

- [ ] **Step 4: Create `nunnuncode/tools.py`**

Header:

```python
"""nunnuncode - agent tools"""

import glob as globlib, os, re, subprocess

from config import DIM, RESET
```

Then move lines 73-242 of root `nunnuncode.py` unchanged (the `# --- Tool implementations ---` comment, the six tool functions, `TOOLS`, `run_tool`, `tool_specs`, `make_schema`, `make_openai_schema`).

- [ ] **Step 5: Create `nunnuncode/llm.py`**

Header:

```python
"""nunnuncode - LLM API calls"""

import json, os, urllib.error, urllib.request

from config import (
    API_FORMAT,
    API_URL,
    CUSTOM_KEY,
    MAX_TOKENS,
    MODEL,
    OPENROUTER_KEY,
    THINKING,
    THINKING_BUDGET,
)
from tools import make_openai_schema, make_schema
```

Then move these ranges of root `nunnuncode.py` unchanged, in this order:
- lines 245-354 (`to_openai_messages`, `call_api`, `call_api_openai`)
- lines 369-385 (`CONTEXT_ERROR_HINTS`, `is_context_error`, `trim_messages`)

- [ ] **Step 6: Create `nunnuncode/nunnuncode.py` (entry)**

Header:

```python
#!/usr/bin/env python3
"""nunnuncode - micro coding agent"""

import os, re

from config import (
    API_FORMAT,
    BOLD,
    BLUE,
    CONTEXT_WINDOW,
    CYAN,
    DIM,
    GREEN,
    RED,
    RESET,
    YELLOW,
)
from llm import call_api, is_context_error, trim_messages
from tools import run_tool
```

Then move these ranges of root `nunnuncode.py` unchanged, in this order:
- lines 357-366 (`separator`, `render_markdown`)
- lines 388-403 (`render_usage`)
- lines 406-498 (`main`)
- lines 501-502 (`if __name__ == "__main__":` / `main()`)

- [ ] **Step 7: Delete the root file**

```bash
git rm nunnuncode.py
```

- [ ] **Step 8: Run tests, verify all pass**

Run: `python -m unittest discover tests`
Expected: all 6 tests PASS (agentic loop, sliding window, usage percent, model-required, dotenv parse, dotenv missing-file).

- [ ] **Step 9: Smoke-run the entry from the repo root**

Run: `"/q" | python nunnuncode/nunnuncode.py`
Expected: prints the header `nunnuncode | <model> (<provider>) | <cwd>` (provider reflects the repo-root `.env`, proving the dotenv fallback), then exits with code 0.

- [ ] **Step 10: Commit**

```bash
git add nunnuncode/ tests/test_e2e.py
git commit -m "Split nunnuncode.py into module folder"
```

(`git rm` in Step 7 already staged the deletion.)

---

### Task 2: Update README for the new layout

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: final layout from Task 1 (`nunnuncode/nunnuncode.py` entry)
- Produces: docs matching the new run command

- [ ] **Step 1: Apply the text changes**

In `README.md`:

1. Line 7: `Micro Coding Agent. Single Python file, zero dependencies, ~250 lines.` -> `Micro Coding Agent. Four small Python modules, zero dependencies.`
2. Line 21: `- Single file, zero dependencies` -> `- Four small modules, zero dependencies`
3. All four occurrences of `python nanocode.py` (lines 27, 36, 44, 55) -> `python nunnuncode/nunnuncode.py`
4. Line 58: `nanocode appends /chat/completions` -> `nunnuncode appends /chat/completions`

Leave alone: the example transcript (lines ~93-96, a fictional output sample) and the Credits link to the upstream `nanocode` project.

- [ ] **Step 2: Verify no stale references**

Run: `git diff README.md` (or search `README.md` for `nanocode.py`)
Expected: the only remaining `nanocode` mentions are the example transcript and the upstream credits link. No `nanocode.py` command references.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Update README for module layout"
```

---

## Final verification (after both tasks)

1. `python -m unittest discover tests` — all 6 pass
2. `git status` — clean except untracked `_tmp.txt`
3. `git log --oneline -5` — shows the two task commits on top of the spec commits
