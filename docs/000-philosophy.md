# 000 — Philosophy

nunnuncode is an always-on personal agent, and also a way of working with an agent.

Core principle:

**Take as little human attention as possible, and give as much value as possible.**

Every part of the project is judged by the attention it costs. A message, a
notification, a question, a panel element and a paragraph of documentation each
cost the user's attention, and each has to give more value than that, or it is
removed. (This principle is adopted, with credit, from DeepSeek's
dsh-superagent philosophy — it said plainly what we believed.)

## What follows for the agent

- **It acts only when asked, or when a written rule allows it.** Work nobody
  asked for needs a rule the user wrote. Proactive work starts in observe-only
  mode: it records what it would have done, and does nothing.
- **It speaks only when a person must act or can use a result.** It confirms a
  request once, stays quiet while it works, and writes again when a result is
  ready, when it needs a decision, or when it cannot finish.
- **It asks one concrete question at a time**, in a structured form.
- **It stops by impact, not by effort.** A local change goes as far as a
  reviewable result. A change that needs a decision stops with a clear question.
- **It reports honestly.** A draft is marked unfinished; a failure is reported
  as a failure; a limit is never bypassed to avoid asking.

## What follows for the design

Four properties, set once, never traded away:

1. **Own the code.** The agent loop, session log, plugin runtime, memory, and
   skills are written in this repository. The only borrowed layer is pi-ai
   (vendored, MIT) — the plumbing that talks to model providers. The loop is
   not a framework's; it is ours, and readable.
2. **Local-first.** Storage and memory stay on the user's machine. The LLM API
   is the only cloud dependency. Honest caveat: what the agent *reads* is what
   leaves the machine — the trust model governs that surface.
3. **Inspectable.** Memory is plain markdown the user can read and edit; state
   is SQLite the user can query; sessions are JSONL the user can replay. No
   hidden context, no unexplainable behavior.
4. **Minimal attention.** Silence is the default. The agent wakes, checks its
   own notes, and acts or stays quiet. It messages only when a person must act
   or can use a result.

## What follows for the implementation

- **Everything is a plugin.** Model provider, tools, memory, skills, scheduler —
  registered on one shared context, replaceable from configuration. The core has
  no dependency on any capability.
- **Few concepts.** A business need becomes an attribute of an existing concept
  or a prompt, never a new subsystem.
- **Few settings.** A default replaces a setting when one value suits almost
  every user. Behavior a user describes in words is prompt text, not a setting.
- **Minimal where it differentiates, pragmatic where it doesn't.** The memory
  system and the trust pipeline are built deliberately; plumbing is borrowed.

## Responsibility

The agent reads, writes and runs commands on the user's machine under accounts
the user owns. Every action it takes costs the user's trust:

- **Start narrow.** Reads are free; writes and shell commands are confirmed.
  The daemon records what it would do before it does anything.
- **Own what it does.** Read the session logs; correct it in prompts when it is
  wrong; delete memory it wrote wrongly.
- **The goal is the right help at the right time, and nothing at any other
  time.**
