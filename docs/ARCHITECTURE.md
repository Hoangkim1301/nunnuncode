# Architecture

## North star

> **A tiny agent that can safely grow itself.**

Nunnuncode is a minimal governed seed agent. It should begin with very few built-in capabilities and acquire, validate, reuse, simplify, replace, and retire capabilities as real needs appear.

The goal is not maximum feature count.

> **Grow capability without growing unnecessary complexity.**

Nunnuncode is not defined by a specific use case such as coding, email, calendar, browsing, or automation. Those should be capabilities built on top of the foundation when needed.

## Design principles

### Minimal, not artificially tiny

Single-file and zero-dependency are not goals.

A design is minimal when a developer can quickly understand the important control flow, boundaries, and state.

Dependencies are acceptable when they clearly reduce custom code, improve safety, or make the system easier to understand.

### Implementation may evolve; governance may not

The agent may eventually evolve:

- capabilities,
- workflows,
- memory behavior,
- prompts and learned behavior,
- explicitly approved dependencies.

The protected governance layer controls:

- permissions and effects,
- validation,
- evolution rules,
- execution budgets,
- audit history,
- rollback.

The agent must not be able to weaken those rules through normal self-evolution.

### Complexity is a cost

Prefer:

```text
reuse → compose → simplify → refactor → add code
```

A successful change may remove code.

A system that can only add is accumulating, not evolving.

## Conceptual primitives

Keep the foundation centered on a small set of concepts:

```text
Loop
Journal
Capabilities
Policy
Evolution
```

Do not turn every concern into a new framework primitive.

### Loop

Runs the agent interaction cycle and coordinates model responses, capability calls, and termination.

It should remain explicit and bounded.

### Journal

Append-only record of important state transitions and side effects.

Possible events include:

```text
task.started
capability.requested
permission.granted
tool.completed
evolution.proposed
evolution.promoted
evolution.reverted
task.completed
```

The journal can support recovery, audit, debugging, and evolution history without creating separate logging systems for each concern.

### Capabilities

Capabilities are evolvable abilities outside the protected kernel.

Installed capabilities are not the same as active capabilities. Only the capabilities relevant to the current task should need to enter model context.

This allows capability count to grow without making prompt/context size grow linearly.

### Policy

Policy enforces authority and effects.

Non-technical users should control understandable things such as:

- intent,
- permissions,
- external effects,
- irreversible consequences.

They should not need to review implementation details to stay safe.

### Evolution

Evolution is a controlled transaction, not live self-editing.

Target flow:

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

## Evolution ladder

Always change the lowest sufficient layer:

```text
L0  transient reasoning
L1  memory / learned knowledge
L2  workflow / composition
L3  executable capability
L4  dependency / runtime extension
L5  kernel / governance
```

Do not generate code when memory or composition is enough.

L5 is outside autonomous self-evolution.

## One evolution transaction

Avoid separate mutation frameworks for memory, prompts, tools, workflows, and dependencies.

Long term, persistent mutations should share one conceptual transaction:

```text
surface
intent
candidate
effects
permissions
evidence
complexity_delta
rollback
```

The kernel should only need to understand a small lifecycle:

```text
propose → validate → authorize → promote → observe → revert
```

## Capability lifecycle

A capability should not be simply installed or absent.

Useful lifecycle:

```text
ephemeral
   ↓
candidate
   ↓
probation
   ↓
stable
   ↓
deprecated
   ↓
retired
```

A one-off solution does not automatically deserve permanent code.

Repeated usefulness can justify graduation.

Overlap should trigger merge or simplification.

Obsolete behavior should be retired.

## Evidence-carrying evolution

Passing tests is necessary but not enough.

A candidate should eventually carry evidence such as:

- requested behavior works,
- existing behavior does not regress,
- authority did not expand silently,
- the evaluator was not modified to force success,
- rollback works,
- no existing capability already solves the need,
- added complexity is justified.

Avoid a single self-reported fitness score as the only promotion criterion.

## Scaling model

Scale through composition and selective activation.

Do not add large subsystems preemptively.

Examples such as semantic retrieval, browser automation, schedulers, multi-agent execution, or a vector store should appear only when a real recurring limitation demonstrates the need.

The foundation should make such growth possible without requiring those systems up front.

## Current reality

The current repository is still a small coding-agent harness.

This document describes direction and invariants, not an instruction to perform a large rewrite.

New boundaries should become code boundaries when real implementation pressure justifies them.
