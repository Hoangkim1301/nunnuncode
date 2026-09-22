# Roadmap

This roadmap is organized around foundation capabilities, not end-user use cases.

Do not build the project in the order:

```text
email → calendar → browser → scheduler → ...
```

Those are future capabilities. The foundation should make them possible without knowing about them in advance.

GitHub issues remain the implementation backlog. This file describes the intended sequencing and purpose.

## Phase 0 — Evolution evaluation

Before giving self-evolution significant authority, define small evaluation scenarios for the behavior we expect from evolution.

Examples:

- missing capability can be acquired,
- existing capabilities are reused before code is added,
- repeated useful behavior can graduate,
- bad candidates are rejected,
- regressions trigger rollback,
- permission escalation is blocked,
- overlapping capabilities can be simplified,
- unsafe or corrupted experience does not silently become permanent.

Goal: measure quality of growth, not only task success.

## Phase 1 — Seed kernel

Refactor only when real boundaries require it.

Establish the smallest reliable foundation for:

- bounded agent loop,
- journal,
- capability registry,
- policy/effect checks,
- execution budgets,
- provider abstraction where necessary.

Do not add end-user feature subsystems in this phase.

## Phase 2 — Capability substrate

Give capabilities a small explicit contract.

Likely metadata:

- purpose,
- input/output schema,
- required permissions/effects,
- dependencies,
- version/status,
- validation/tests.

Add discovery and selective activation so installed capability count does not directly become model-context size.

## Phase 3 — Effects and authority

Build a least-privilege authority model suitable for non-technical users.

Prefer explicit effects over vague "safe/unsafe" labels.

Examples:

```text
filesystem.read(scope)
filesystem.write(scope)
network(domain)
external.send(target)
credential.use(name)
process.exec(scope)
```

The agent may request authority but must not grant it to itself.

## Phase 4 — Evolution transaction v1

Implement one complete guarded evolution path for executable capabilities:

```text
gap
→ lowest-layer check
→ proposal
→ isolated candidate
→ validation
→ evaluation
→ complexity check
→ approval if needed
→ atomic promotion
→ observation
→ rollback
```

Do not generalize to every evolution surface until this path is trustworthy.

## Phase 5 — Graduation and entropy control

Make simplification a first-class part of evolution.

Support:

- ephemeral capabilities,
- probation,
- graduation,
- deprecation,
- retirement,
- merging overlap,
- removing dead code,
- removing unnecessary dependencies.

Track whether capability growth is justified by reuse and value.

## Phase 6 — Generalize persistent evolution

Once capability evolution is reliable, extend the same transaction model to:

- memory,
- workflows,
- prompts/behavior,
- dependencies.

Do not build separate evolution engines for each surface.

Memory in particular should keep provenance, support correction/removal, and avoid turning model guesses into durable facts.

## Phase 7 — Bounded autonomous evolution

Allow the agent to initiate low-risk evolution without explicit user prompting only after the earlier phases are reliable.

Autonomy remains bounded by:

- effects,
- execution budgets,
- external validation,
- rollback,
- protected governance.

Permission expansion, destructive effects, and governance changes remain human-controlled.

## Phase 8 — Scale by composition

At larger capability counts, prefer composing existing capabilities and workflows over creating more code.

Only add major infrastructure when a demonstrated recurring limitation requires it.

If the agent eventually needs semantic retrieval, scheduling, browser automation, or multi-agent execution, those should arise as justified capability gaps rather than initial architecture assumptions.

## Metrics

Track growth quality, not only success rate.

Useful dimensions include:

- capability gain,
- transfer/reuse,
- regression rate,
- complexity delta,
- dependency growth,
- active-context growth,
- reuse vs new-code ratio,
- pruning/retirement ability,
- permission safety,
- rollback success,
- portability across model providers.

A system that gains a little task performance while multiplying core complexity is not evolving well.

## Non-goals

Avoid turning Nunnuncode into:

- another coding-agent clone,
- a generic workflow framework,
- a multi-agent orchestration platform,
- a large personal-agent application suite,
- a RAG/vector-database framework,
- a plugin marketplace,
- a framework whose abstractions are larger than the problems they solve.

The project should remain a seed from which justified capabilities can grow.
