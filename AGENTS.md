# AGENTS.md

This file defines how coding agents should work in this repository.

## Mission

Nunnuncode is:

> **A tiny agent that can safely grow itself.**

The project is building a minimal foundation agent for non-technical users.

It should begin with very few built-in capabilities, then be able to acquire, validate, reuse, simplify, replace, and retire capabilities over time.

The goal is not maximum feature count.

The goal is:

> **Grow capability without growing unnecessary complexity.**

---

## North-star principles

### 1. Keep the system understandable

A single developer should be able to read the important parts of the system and understand how they work without learning a large framework first.

Prefer direct code over clever code.

Prefer explicit data flow over hidden behavior.

Prefer a small number of strong invariants over many abstraction layers.

### 2. Minimal does not mean artificially small

Single-file and zero-dependency are not requirements.

A dependency is acceptable when it clearly:

- reduces custom code,
- improves safety,
- or makes the implementation easier to understand.

Do not add a dependency for convenience alone.

Do not rebuild a well-solved, security-sensitive primitive badly just to avoid a dependency.

### 3. Do not over-engineer

Never create architecture for hypothetical future requirements.

Do not introduce:

- factories when a function is enough,
- interfaces with only one implementation,
- dependency-injection frameworks,
- event buses without a real need,
- generic plugin systems before concrete use cases require them,
- large inheritance hierarchies,
- wrappers that only rename another API.

Abstract only after repeated real duplication or a real boundary appears.

### 4. Prefer composition over new code

Before adding a capability, ask in this order:

1. Can the existing system already do it?
2. Can existing capabilities be composed?
3. Can an existing capability be simplified or generalized slightly?
4. Is new code actually necessary?

Preferred evolution order:

```text
reuse → compose → simplify → refactor → add code
```

### 5. Complexity is a regression

A change can be functionally correct and still be a bad change.

Treat these as regressions unless clearly justified:

- duplicate capabilities,
- dead code,
- speculative abstractions,
- unnecessary dependencies,
- multiple ways to do the same thing,
- growing prompts instead of fixing structure,
- workaround layers,
- hidden state,
- tightly coupled modules,
- behavior that is difficult to trace.

Deleting code while preserving capability is often an improvement.

---

## Architecture direction

The conceptual foundation should remain small.

The long-term architecture is based around a few primitives:

```text
Loop
Journal
Capabilities
Policy
Evolution
```

Do not add new fundamental primitives casually.

### Protected kernel

The protected kernel should remain small and human-maintained.

It governs things such as:

- agent loop,
- permission/effect enforcement,
- capability loading,
- evolution rules,
- execution budgets,
- validation requirements,
- audit and rollback guarantees.

### Evolvable area

The agent may eventually evolve things such as:

- capabilities,
- workflows,
- memory behavior,
- prompts/behavior,
- approved dependencies.

Core rule:

> **The agent may evolve implementation, but not governance.**

The agent must not be able to:

- grant itself new permissions,
- disable validation,
- bypass rollback,
- raise protected execution limits,
- rewrite its evaluator to make itself pass,
- modify protected governance rules through normal self-evolution.

---

## Evolution model

Do not implement self-evolution as live self-editing.

The intended flow is:

```text
capability gap
    ↓
smallest proposal
    ↓
isolated candidate
    ↓
policy / effect checks
    ↓
tests
    ↓
behavioral evaluation
    ↓
complexity check
    ↓
human approval when required
    ↓
atomic promotion
    ↓
observation
    ↓
rollback on regression
```

The live system should not be changed first and validated afterward.

### Evolution ladder

Always evolve at the lowest sufficient layer:

```text
L0  transient reasoning
L1  memory / learned knowledge
L2  workflow / composition
L3  executable capability
L4  dependency / runtime extension
L5  kernel / governance
```

Do not jump directly to code generation when a lower layer is enough.

L5 is not part of autonomous self-evolution.

---

## Working method for coding agents

When given a task, use this sequence.

### 1. Understand the existing path first

Before editing:

- read the relevant code,
- find the current data flow,
- identify existing helpers,
- inspect relevant tests,
- understand the smallest boundary affected.

Do not refactor unrelated code just because you noticed it.

### 2. State the smallest viable change

Prefer the smallest change that solves the actual problem.

If the task can be solved by changing one function, do not redesign three modules.

If a refactor is genuinely necessary, keep it local and explain why it is necessary for the requested behavior.

### 3. Preserve existing behavior

Avoid breaking working behavior unless the task explicitly requires it.

When changing behavior:

- add or update tests,
- keep old behavior where still valid,
- make migration explicit when necessary.

### 4. Implement directly

Favor straightforward control flow.

Good:

```python
if condition:
    do_thing()
```

Be cautious with patterns that add indirection without real value.

### 5. Validate the change

Run the narrowest useful tests first.

Then run the broader relevant test suite.

For behavior changes, test failure modes as well as happy paths.

Do not claim success only because code imports.

### 6. Review for unnecessary complexity

Before finishing, ask:

- Did I add more code than necessary?
- Did I create a new abstraction that can be removed?
- Did I duplicate existing behavior?
- Did I add a dependency that can be avoided cleanly?
- Did I make the code harder to trace?
- Can any code now be deleted?

Simplify before finishing.

---

## Coding style

### Prefer

- small functions,
- obvious names,
- explicit inputs and outputs,
- flat control flow,
- standard library where it is sufficient,
- small modules with one clear responsibility,
- data structures over class hierarchies,
- boring code,
- comments that explain **why**, not obvious **what**.

### Avoid

- premature abstractions,
- clever metaprogramming,
- hidden magic,
- unnecessary decorators,
- deep inheritance,
- unnecessary async,
- unnecessary concurrency,
- broad exception swallowing,
- global mutable state without a strong reason,
- giant manager/controller classes,
- configuration systems more complex than the feature they configure.

### Naming

Use names that describe domain meaning.

Prefer:

```text
capability
candidate
permission
effect
journal
evolution
rollback
```

over vague names such as:

```text
manager
processor
handler2
utils
helper
engine
service
```

when a more specific name exists.

### Comments and documentation

Keep comments short.

Do not narrate every line.

Document:

- invariants,
- security boundaries,
- non-obvious tradeoffs,
- reasons for intentionally simple designs.

---

## Tests

Tests are part of the architecture, especially for self-evolution.

Prefer tests that verify observable behavior rather than implementation details.

Important classes of tests include:

- normal behavior,
- failure behavior,
- permission boundaries,
- rollback,
- duplicate capability rejection,
- execution limits,
- regression of existing capabilities,
- candidate isolation.

A passing test suite is necessary but not sufficient evidence that an evolution is good.

Also consider:

- complexity increase,
- duplicate functionality,
- permission expansion,
- behavioral regression.

---

## Safety rules

Safety should come from structural boundaries, not keyword blacklists.

For privileged operations, prefer:

- least privilege,
- scoped filesystem access,
- explicit effects,
- timeouts,
- execution budgets,
- controlled credential access,
- reversible operations where possible.

Do not treat a list of blocked shell commands as a security model.

Do not expose unrestricted low-level primitives when a safer high-level capability is sufficient.

---

## Non-technical user principle

The user should control:

- intent,
- permissions,
- external effects,
- irreversible consequences.

The user should not need to understand:

- Python diffs,
- internal module layout,
- raw shell commands,
- framework internals.

When a risky change is proposed, the system should eventually be able to explain:

- what it wants to change,
- why,
- what permission it needs,
- what it can affect,
- whether it is reversible,
- what validation passed.

---

## Scope discipline

Do not turn unrelated observations into extra work.

If you discover a separate problem:

- fix it only if it blocks the requested change or creates a clear correctness/safety issue,
- otherwise leave it for a dedicated issue.

Avoid broad cleanup PRs mixed with behavior changes.

Small, reviewable changes are preferred.

---

## Current repository reality

The current implementation is still a small coding-agent foundation.

Do not pretend the future architecture already exists.

Evolve the codebase incrementally toward the target architecture.

Do not perform a large rewrite only to make the folder structure match a diagram.

Architecture should emerge from real boundaries as they become necessary.

---

## Decision rule

When multiple implementations are possible, choose the one that is:

1. correct,
2. safe,
3. easiest to understand,
4. easiest to remove or change later,
5. smallest in conceptual complexity.

Not the one with the most abstraction or the fewest raw lines.

---

## Final checklist

Before completing a change, verify:

- [ ] I understood the existing implementation before editing.
- [ ] This is the smallest reasonable change.
- [ ] I reused existing behavior where possible.
- [ ] I did not add speculative abstractions.
- [ ] New dependencies are justified.
- [ ] Safety boundaries were not weakened.
- [ ] Relevant tests pass.
- [ ] Failure cases were considered.
- [ ] The change is easy to understand.
- [ ] I removed unnecessary code introduced during implementation.
- [ ] The result moves Nunnuncode toward **more capability without unnecessary complexity**.
