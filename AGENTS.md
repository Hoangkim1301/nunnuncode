# AGENTS.md

Instructions for coding agents working in this repository.

## Project

Nunnuncode is:

> **A tiny agent that can safely grow itself.**

It is a minimal foundation agent for non-technical users. The goal is to increase capability without letting architecture, code, permissions, or hidden complexity grow without control.

The repository is still early. Do not pretend the target architecture already exists, and do not rewrite the project just to match a future diagram.

For deeper context:
- Architecture and design invariants: `docs/ARCHITECTURE.md`
- Development roadmap: `docs/ROADMAP.md`
- GitHub issues are the implementation backlog.

## Priorities

When tradeoffs exist, prefer in this order:

1. Correctness and safety
2. Simplicity and understandability
3. Minimal change
4. Testability and reversibility
5. Consistency with existing code
6. Performance, unless performance is the task

## Working rules

Before editing:

- Read the code you will change and the nearby call path.
- Read relevant tests.
- Understand the current behavior before proposing architecture.
- Search for an existing implementation before adding a new one.

While editing:

- Make the smallest change that solves the actual problem.
- Do not refactor unrelated code.
- Reuse existing behavior where possible.
- Match existing patterns unless they are the problem being fixed.
- Keep behavior explicit. Avoid hidden state and magic.
- Do not add future-proofing without a current requirement.

After editing:

- Run the narrowest relevant tests first.
- Run the broader relevant suite when appropriate.
- Check failure paths, not only the happy path.
- Remove code or abstractions introduced during the task if they are not necessary.
- Never claim a test passed unless it was actually run.

## Simplicity rules

Prefer:

- small functions,
- explicit inputs and outputs,
- flat control flow,
- clear data structures,
- specific names,
- boring code,
- comments that explain why.

Avoid unless clearly justified:

- factories for one implementation,
- interfaces with one implementation,
- dependency-injection frameworks,
- event buses,
- deep inheritance,
- generic manager/service/helper layers,
- unnecessary async or concurrency,
- wrappers that only rename another API,
- speculative plugin systems,
- broad exception swallowing.

A dependency is allowed when it clearly reduces complexity or improves safety. Zero-dependency is not a goal.

Do not optimize for the fewest lines. Optimize for the smallest **conceptual** complexity.

## Capability changes

Before adding new capability code, consider in this order:

```text
reuse → compose → simplify → refactor → add code
```

Do not create a new capability when an existing one can solve the problem through composition.

Treat duplicate capabilities, dead code, unnecessary dependencies, and overlapping abstractions as regressions.

## Architecture boundaries

The long-term protected kernel governs permissions, validation, evolution, execution limits, and rollback.

The key invariant is:

> **The agent may evolve implementation, but not governance.**

Do not introduce a path that lets agent-controlled code:

- grant itself new permissions,
- bypass validation,
- weaken rollback,
- raise protected execution limits,
- modify its evaluator to make itself pass,
- silently expand external effects.

Read `docs/ARCHITECTURE.md` before changing these boundaries.

## Coding style

- Use descriptive domain names instead of vague names such as `manager`, `processor`, `helper`, or `utils` when a specific name exists.
- Keep modules focused on one real responsibility.
- Prefer functions and data over class hierarchies.
- Keep comments and docstrings concise.
- Do not duplicate information already obvious from the code.
- Keep security and architectural invariants explicit near the code enforcing them.

## Tests

Current test command:

```bash
python -m unittest discover tests
```

For changed behavior:

- add or update focused tests,
- test observable behavior rather than internal structure where possible,
- include relevant failure cases,
- preserve existing behavior unless the task intentionally changes it.

For safety/evolution work, also consider permission boundaries, candidate isolation, execution limits, rollback, and regression behavior.

## Scope discipline

If you discover another issue while working:

- fix it only if it blocks the task or creates an immediate correctness/safety problem,
- otherwise leave it for a separate issue.

Do not combine broad cleanup with an unrelated behavior change.

## Final check

Before finishing, ask:

- Is this the smallest reasonable solution?
- Did I add an abstraction that can be removed?
- Did I duplicate existing behavior?
- Is every new dependency justified?
- Did I weaken a safety boundary?
- Are the relevant tests actually passing?
- Is the result easier, not harder, for one person to understand?
