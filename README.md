# nunnuncode

[🇬🇧 English](README.md) · [🇻🇳 Tiếng Việt](README_VI.md) · [🇩🇪 Deutsch](README_DE.md)

> A personal project for learning how coding agents work — built by reading code, then rewriting it from scratch.

Micro Coding Agent. Single Python file, zero dependencies, ~250 lines.

![screenshot](screenshot.png)

## Why this project

This is my self-learning playground for **self-developed coding agents**. I started by studying how a minimal agent loop works — LLM + tools + history — and then rebuilt it line by line to really understand it. No frameworks, no dependencies, just the core mechanics.

## Features

- Full agentic loop with tool use
- Tools: `read`, `write`, `edit`, `glob`, `grep`, `bash`
- Conversation history
- Colored terminal output
- Single file, zero dependencies

## Usage

```bash
export ANTHROPIC_API_KEY="your-key"
python nanocode.py
```

### OpenRouter

Use [OpenRouter](https://openrouter.ai) to access any model:

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

Works with any OpenAI-compatible endpoint (your company LLM gateway, Ollama, vLLM, LM Studio, ...):

```bash
export API_BASE_URL="https://api.siemens.com/llm/v1"
export API_KEY="your-key"
export MODEL="your-model-name"
python nanocode.py
```

- `API_BASE_URL` — base URL up to `/v1`; nanocode appends `/chat/completions`
- `API_KEY` — sent as `Authorization: Bearer` (omit for local servers without auth)
- `MODEL` — required when using `API_BASE_URL`

### Tests

```bash
python -m unittest discover tests
```

## Commands

| Command | Description |
|---------|-------------|
| `/c` | Clear conversation |
| `/q` or `exit` | Quit |

## Tools

| Tool | Description |
|------|-------------|
| `read` | Read file with line numbers, offset/limit |
| `write` | Write content to file |
| `edit` | Replace string in file (must be unique) |
| `glob` | Find files by pattern, sorted by mtime |
| `grep` | Search files for regex |
| `bash` | Run shell command |

## Example

```
────────────────────────────────────────
❯ what files are here?
────────────────────────────────────────

⏺ Glob(**/*.py)
  ⎿  nanocode.py

⏺ There's one Python file: nanocode.py
```

## Learning notes

Things I learned while building this:

- **The agent loop is just a while loop**: send messages → LLM replies with tool calls → run tools → send results back → repeat until no tool calls.
- **Tools are just JSON schemas + Python functions**: the LLM never "sees" the code, only the schema.
- **Constraint design matters more than model choice**: making `edit` require a unique match prevents most file-corruption bugs.

## Roadmap

- [ ] Custom API base URL (any Anthropic-compatible provider)
- [x] OpenAI-compatible provider support
- [ ] Conversation persistence
- [ ] Web fetch tool

## Credits

Based on [nanocode](https://github.com/1rgs/nanocode) by [1rgs](https://github.com/1rgs).

## License

MIT
