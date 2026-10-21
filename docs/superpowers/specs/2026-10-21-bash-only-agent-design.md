# Bash-only Agent Design

## Goal

Return Nunnuncode to a tiny, single-file agent whose model-facing tool surface contains exactly one tool: `bash`. Keep the existing Git history; restore the codebase to the first-commit structure as the starting point for the change rather than resetting or rewriting commits.

## Agreed decisions

- A Bash call runs immediately, without a confirmation prompt.
- The tool accepts one required string parameter, `cmd`.
- Keep the original interactive loop, conversation history, provider support, and terminal interface from the first commit.
- Keep the original one-file layout (`nanocode.py`) and zero-dependency approach.
- Update the English, German, and Vietnamese READMEs to describe the actual Bash-only agent and its deliberately small direction.
- Remove the untracked `tests/test_context.py`; it tests context-compaction code that is being removed.
- Retain Git history. Do not move the branch, reset commits, or force-push.

## Repository shape

The runtime should return to the first-commit layout: `.env.example`, `.gitignore`, the three README files, `nanocode.py`, `screenshot.png`, and the original end-to-end test. Remove later-added runtime modules and kernel, their tests, and the superseded architecture/roadmap and module-split documents. The task's approved design and implementation-plan documents remain as records of this change.

Unrelated ignored or untracked files are outside the cleanup scope, except for the explicitly requested removal of `tests/test_context.py`.

## Tool and execution behavior

Both provider schemas expose exactly one function named `bash`, with an object input schema containing required string property `cmd`. No file, search, or other tool is advertised or dispatched. Bash execution follows the direct shell-command behavior in the first commit; command output is streamed to the terminal and returned to the model.

## README direction

Describe the agent as a deliberately minimal coding agent with one Bash tool. Remove plans for adding more tools or broad capability subsystems. Future work is limited to correctness and portability of the small agent loop and Bash execution.

## Verification

- Assert that Anthropic and OpenAI-compatible tool schemas each contain only `bash`, with required `cmd` input.
- Exercise an end-to-end Bash tool call through the existing local mock API test.
- Run `python -m unittest discover tests` after removing the incompatible context-compaction test and later kernel tests.
- Confirm the remaining source layout contains one runtime Python file and that the Git history remains intact.

## Out of scope

- Rewriting Git history or resetting the branch to the first commit.
- Removing provider support, conversation history, terminal commands, or existing baseline tests.
- Adding shell restrictions, per-command approval, new tools, dependencies, or a new runtime architecture.
