# Design: split nunnuncode.py into a module folder

Date: 2026-09-22
Status: approved by user 2026-09-22

## Context

`nunnuncode.py` has grown from the ~250 lines the README claims to 502 lines, mixing env config, tool implementations, LLM API calls, terminal rendering, and the main loop in one file. The working tree already carries an uncommitted rename `nanocode.py` -> `nunnuncode.py`, while tests and README still reference `nanocode.py` (tests are currently broken).

Goal: organize the code into a small folder of single-purpose modules. No packaging, no new abstractions, no behavior change.

## Out of scope

- Behavior changes (all existing test assertions stay identical)
- Packaging (`__init__.py`, `python -m`, `pyproject.toml`)
- Unrelated refactors
- Any rename other than the already-pending `nanocode` -> `nunnuncode`

## Structure

```
nunnuncode/
├── nunnuncode.py   # main loop + terminal rendering
├── config.py       # load_dotenv + env parsing + ANSI colors
├── llm.py          # API calls, message/schema conversion, context trim
└── tools.py        # tool implementations + run_tool
```

Entry point: `python nunnuncode/nunnuncode.py` (the script's directory is on `sys.path`, so sibling imports work).

Dependency flow (flat, no cycles): `config` <- {`llm`, `tools`, `nunnuncode`}.

## Module contents

### config.py

- `load_dotenv(path=None)` — moved unchanged
- `load_dotenv()` call at import time — moved unchanged
- Env parsing — moved unchanged: `OPENROUTER_KEY`, `CUSTOM_BASE`, `CUSTOM_KEY`, `API_FORMAT`, `API_URL`, `PROVIDER`, `MODEL` (including the `MODEL required when API_BASE_URL set` SystemExit), `CONTEXT_WINDOW`, `THINKING`, `THINKING_BUDGET`, `MAX_TOKENS`
- ANSI colors: `RESET`, `BOLD`, `DIM`, `BLUE`, `CYAN`, `GREEN`, `YELLOW`, `RED`

### tools.py

- Tool implementations `read`, `write`, `edit`, `glob`, `grep`, `bash` — moved unchanged
- `TOOLS` registry, `run_tool`, `tool_specs`, `make_schema`, `make_openai_schema` — moved unchanged
- Imports ANSI colors from `config` (needed by `bash`'s streamed output)

### llm.py

- `to_openai_messages` — moved unchanged
- `call_api`, `call_api_openai` — moved unchanged
- `CONTEXT_ERROR_HINTS`, `is_context_error`, `trim_messages` — moved unchanged
- Imports env constants from `config`

### nunnuncode.py

- `separator`, `render_markdown`, `render_usage` — moved unchanged
- `main()`: REPL, commands (`/q`, `/c`, `/compact`), agentic loop, block rendering, context-trim retry — moved unchanged
- `if __name__ == "__main__": main()`

## Tests (`tests/test_e2e.py`)

- `NANO` becomes `REPO / "nunnuncode" / "nunnuncode.py"`
- e2e sandbox: copy the whole `nunnuncode/` folder into the temp dir (instead of one file) and run `python nunnuncode/nunnuncode.py` with `cwd=temp`
- `TestDotenv`: add `REPO / "nunnuncode"` to `sys.path` and `import config`; call `config.load_dotenv(...)`
- All assertions unchanged. Test command unchanged: `python -m unittest discover tests`

## README

- Usage commands: `python nanocode.py` -> `python nunnuncode/nunnuncode.py`
- "Single Python file, zero dependencies" description updated to the four-module folder
- No other doc changes

## Git

The unstaged working-tree rename `nanocode.py` -> `nunnuncode.py` is subsumed by this change: the final tree has the `nunnuncode/` folder and no root `nanocode.py` or root `nunnuncode.py`.

## Verification

1. `python -m unittest discover tests` — all tests pass (covers provider loop, context trim, usage gauge, model-required error, dotenv parsing)
2. `python nunnuncode/nunnuncode.py` starts the REPL (smoke, requires valid API env or stops at first API error — acceptable)
3. `git status` shows only the intended layout change plus the committed spec
