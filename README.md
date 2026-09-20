# nunnuncode

[🇬🇧 English](README.md) · [🇻🇳 Tiếng Việt](README_VI.md) · [🇩🇪 Deutsch](README_DE.md)

> **A tiny agent that can safely grow itself.**

Nunnuncode is an experiment in building a minimal personal agent for non-technical users: an agent that can extend its own capabilities while staying understandable, permission-bounded, tested, and reversible.

The project started as a tiny coding agent inspired by [nanocode](https://github.com/1rgs/nanocode). The current implementation is still that small foundation. The long-term goal is not to build another large agent framework, but to discover the smallest clean architecture that can support safe self-evolution.

![screenshot](screenshot.png)

## Current status

Today Nunnuncode is a small coding-agent harness with:

- an LLM + tools + history agent loop
- tools: `read`, `write`, `edit`, `glob`, `grep`, `bash`
- Anthropic, OpenRouter, and OpenAI-compatible providers
- reasoning/thinking support
- basic context-overflow recovery
- end-to-end tests

These are the primitives. Safe self-evolution is the roadmap.

## Design principles

### 1. Minimal, not artificially tiny

Small code is useful because one person should be able to read the project and understand it quickly. But single-file and zero-dependency are not goals by themselves.

Dependencies are allowed when they clearly reduce complexity or improve safety. Every dependency and abstraction must justify its existence.

### 2. The agent may evolve implementation, not governance

The agent may create or change capabilities, workflows, prompts, and learned behavior.

It must not be able to weaken the rules that govern its own evolution: permission checks, testing requirements, rollback, audit history, or the protected kernel boundary.

### 3. Evolution is a transaction

Self-modification should never mean "edit live code and hope".

The intended flow is:

```text
capability gap
    ↓
smallest proposal
    ↓
isolated candidate
    ↓
policy + permission checks
    ↓
tests + behavioral evaluation
    ↓
human approval when required
    ↓
promote
    ↓
observe
    ↓
rollback on regression
```

### 4. Human control is about intent and permissions

Nunnuncode targets non-technical users. They should not need to review Python diffs.

For risky changes, the agent should explain in plain language:

- what capability it wants to add or change
- why it is needed
- which permissions it requires
- what data or external systems it can affect
- whether the change is reversible
- whether validation passed

The human controls intent, permissions, and irreversible consequences. The system controls implementation safety.

### 5. Complexity is a cost

A change is not good merely because it works.

The agent should prefer, in order:

```text
reuse → compose → simplify → refactor → add code
```

It must be able to remove and merge capabilities, not only accumulate new ones. Duplicate abstractions, dead code, unnecessary dependencies, and speculative architecture are regressions.

### 6. Every evolution must be understandable and reversible

Each accepted evolution should leave an audit trail:

- what changed
- why it changed
- required permissions
- tests/evaluations performed
- result
- previous version / rollback path

## Target architecture

The exact structure will evolve, but the intended boundary is simple:

```text
Kernel
  ├─ agent loop
  ├─ permissions
  ├─ capability loading
  ├─ evolution policy
  └─ rollback / audit
        ↓ governs
Agent
  ├─ memory
  ├─ workflows
  └─ behavior
        ↓ uses / evolves
Capabilities
```

The **kernel is small and human-maintained**. The agent can evolve capabilities, but cannot grant itself new permissions or rewrite the rules that validate evolution.

## Roadmap

The detailed roadmap lives in [Epic #1](https://github.com/Hoangkim1301/nunnuncode/issues/1).

### Foundation — safety before autonomy

- protected kernel vs evolvable code
- permission model and safe defaults
- shell/filesystem boundaries
- execution budgets
- reliable API behavior

### Stage 1 — usable by non-technical users

- persistent memory with provenance
- plain-language output
- human-readable approval flows

### Stage 2 — capabilities

- dynamic capability registry
- capability modules with explicit metadata, permissions, and dependencies
- reuse/composition before creating new capability code

### Stage 3 — guarded evolution

- isolated candidate changes
- tests + behavioral evaluation
- promotion only after validation
- automatic rollback
- version/evolution history
- simplification and cleanup as first-class evolution operations

## Usage

### Anthropic

```bash
export ANTHROPIC_API_KEY="your-key"
python nanocode.py
```

### OpenRouter

```bash
export OPENROUTER_API_KEY="your-key"
python nanocode.py
```

To use a different model:

```bash
export OPENROUTER_API_KEY="your-key"
export MODEL="openai/gpt-5.2"
python nanocode.py
```

### Custom OpenAI-compatible provider

```bash
export API_BASE_URL="https://your-provider.example/v1"
export API_KEY="your-key"
export MODEL="your-model-name"
python nanocode.py
```

### Tests

```bash
python -m unittest discover tests
```

## Commands

| Command | Description |
|---------|-------------|
| `/c` | Clear conversation |
| `/q` or `exit` | Quit |

## Credits

Originally based on [nanocode](https://github.com/1rgs/nanocode) by [1rgs](https://github.com/1rgs).

## License

MIT
