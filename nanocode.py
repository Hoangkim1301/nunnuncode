#!/usr/bin/env python3
"""nanocode - micro coding agent"""

import glob as globlib, json, os, re, subprocess, urllib.error, urllib.request

def load_dotenv(path=None):
    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
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


# --- Tool implementations ---


def read(args):
    lines = open(args["path"]).readlines()
    offset = args.get("offset", 0)
    limit = args.get("limit", len(lines))
    selected = lines[offset : offset + limit]
    return "".join(f"{offset + idx + 1:4}| {line}" for idx, line in enumerate(selected))


def write(args):
    with open(args["path"], "w") as f:
        f.write(args["content"])
    return "ok"


def edit(args):
    text = open(args["path"]).read()
    old, new = args["old"], args["new"]
    if old not in text:
        return "error: old_string not found"
    count = text.count(old)
    if not args.get("all") and count > 1:
        return f"error: old_string appears {count} times, must be unique (use all=true)"
    replacement = (
        text.replace(old, new) if args.get("all") else text.replace(old, new, 1)
    )
    with open(args["path"], "w") as f:
        f.write(replacement)
    return "ok"


def glob(args):
    pattern = (args.get("path", ".") + "/" + args["pat"]).replace("//", "/")
    files = globlib.glob(pattern, recursive=True)
    files = sorted(
        files,
        key=lambda f: os.path.getmtime(f) if os.path.isfile(f) else 0,
        reverse=True,
    )
    return "\n".join(files) or "none"


def grep(args):
    pattern = re.compile(args["pat"])
    hits = []
    for filepath in globlib.glob(args.get("path", ".") + "/**", recursive=True):
        try:
            for line_num, line in enumerate(open(filepath), 1):
                if pattern.search(line):
                    hits.append(f"{filepath}:{line_num}:{line.rstrip()}")
        except Exception:
            pass
    return "\n".join(hits[:50]) or "none"


def bash(args):
    proc = subprocess.Popen(
        args["cmd"], shell=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True
    )
    output_lines = []
    try:
        while True:
            line = proc.stdout.readline()
            if not line and proc.poll() is not None:
                break
            if line:
                print(f"  {DIM}│ {line.rstrip()}{RESET}", flush=True)
                output_lines.append(line)
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
        output_lines.append("\n(timed out after 30s)")
    return "".join(output_lines).strip() or "(empty)"


# --- Tool definitions: (description, schema, function) ---

TOOLS = {
    "read": (
        "Read file with line numbers (file path, not directory)",
        {"path": "string", "offset": "number?", "limit": "number?"},
        read,
    ),
    "write": (
        "Write content to file",
        {"path": "string", "content": "string"},
        write,
    ),
    "edit": (
        "Replace old with new in file (old must be unique unless all=true)",
        {"path": "string", "old": "string", "new": "string", "all": "boolean?"},
        edit,
    ),
    "glob": (
        "Find files by pattern, sorted by mtime",
        {"pat": "string", "path": "string?"},
        glob,
    ),
    "grep": (
        "Search files for regex pattern",
        {"pat": "string", "path": "string?"},
        grep,
    ),
    "bash": (
        "Run shell command",
        {"cmd": "string"},
        bash,
    ),
}


def run_tool(name, args):
    try:
        return TOOLS[name][2](args)
    except Exception as err:
        return f"error: {err}"


def tool_specs():
    specs = {}
    for name, (description, params, _fn) in TOOLS.items():
        properties = {}
        required = []
        for param_name, param_type in params.items():
            is_optional = param_type.endswith("?")
            base_type = param_type.rstrip("?")
            properties[param_name] = {
                "type": "integer" if base_type == "number" else base_type
            }
            if not is_optional:
                required.append(param_name)
        specs[name] = (description, properties, required)
    return specs


def make_schema():
    return [
        {
            "name": name,
            "description": description,
            "input_schema": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        }
        for name, (description, properties, required) in tool_specs().items()
    ]


def make_openai_schema():
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        }
        for name, (description, properties, required) in tool_specs().items()
    ]


def to_openai_messages(messages):
    result = []
    for msg in messages:
        role, content = msg["role"], msg["content"]
        if role == "assistant" and isinstance(content, list):
            text = "".join(
                b.get("text", "") for b in content if b.get("type") == "text"
            )
            tool_calls = [
                {
                    "id": b["id"],
                    "type": "function",
                    "function": {
                        "name": b["name"],
                        "arguments": json.dumps(b["input"]),
                    },
                }
                for b in content
                if b.get("type") == "tool_use"
            ]
            out = {"role": "assistant", "content": text if text else None}
            if tool_calls:
                out["tool_calls"] = tool_calls
            result.append(out)
        elif role == "user" and isinstance(content, list):
            for block in content:
                if block.get("type") == "tool_result":
                    result.append(
                        {
                            "role": "tool",
                            "tool_call_id": block["tool_use_id"],
                            "content": block.get("content", ""),
                        }
                    )
                else:
                    result.append({"role": "user", "content": block.get("text", "")})
        else:
            result.append({"role": role, "content": content})
    return result


def call_api(messages, system_prompt):
    if API_FORMAT == "openai":
        return call_api_openai(messages, system_prompt)
    body = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt,
        "messages": messages,
        "tools": make_schema(),
    }
    if THINKING:
        body["thinking"] = {"type": "enabled", "budget_tokens": THINKING_BUDGET}
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(
            body
        ).encode(),
        headers={
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            **({"Authorization": f"Bearer {OPENROUTER_KEY}"} if OPENROUTER_KEY else {"x-api-key": os.environ.get("ANTHROPIC_API_KEY", "")}),
        },
    )
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}") from err
    return json.loads(response.read())


def call_api_openai(messages, system_prompt):
    body = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {"role": "system", "content": system_prompt}
        ] + to_openai_messages(messages),
        "tools": make_openai_schema(),
    }
    if THINKING:
        body["reasoning"] = {"effort": "high"}
    headers = {"Content-Type": "application/json"}
    if CUSTOM_KEY:
        headers["Authorization"] = f"Bearer {CUSTOM_KEY}"
    request = urllib.request.Request(
        API_URL, data=json.dumps(body).encode(), headers=headers
    )
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}") from err
    response = json.loads(response.read())
    message = response["choices"][0]["message"]
    blocks = []
    reasoning = message.get("reasoning_content") or message.get("reasoning") or ""
    if reasoning:
        blocks.append({"type": "thinking", "thinking": reasoning})
    if message.get("content"):
        blocks.append({"type": "text", "text": message["content"]})
    for tool_call in message.get("tool_calls") or []:
        blocks.append(
            {
                "type": "tool_use",
                "id": tool_call["id"],
                "name": tool_call["function"]["name"],
                "input": json.loads(tool_call["function"]["arguments"] or "{}"),
            }
        )
    return {"content": blocks, "usage": response.get("usage")}


def separator():
    try:
        width = os.get_terminal_size().columns
    except OSError:
        width = 80
    return f"{DIM}{'─' * min(width, 80)}{RESET}"


def render_markdown(text):
    return re.sub(r"\*\*(.+?)\*\*", f"{BOLD}\\1{RESET}", text)


CONTEXT_ERROR_HINTS = ("context", "too long", "maximum context", "context_length", "length_exceeded")


def is_context_error(err):
    text = str(err).lower()
    return "http 400" in text and any(hint in text for hint in CONTEXT_ERROR_HINTS)


def trim_messages(messages):
    starts = [
        i
        for i, m in enumerate(messages)
        if m["role"] == "user" and isinstance(m["content"], str)
    ]
    if len(starts) < 2:
        return None
    return messages[starts[len(starts) // 2] :]


def render_usage(usage):
    if not usage:
        return None
    if API_FORMAT == "openai":
        prompt = usage.get("prompt_tokens", 0)
        completion = usage.get("completion_tokens", 0)
    else:
        prompt = usage.get("input_tokens", 0)
        completion = usage.get("output_tokens", 0)
    if CONTEXT_WINDOW > 0:
        total = prompt + completion
        pct = (total / CONTEXT_WINDOW) * 100
        color = RED if pct >= 90 else (YELLOW if pct >= 80 else DIM)
        pie = "◔◑◕◓◖◐◗●"[min(7, int(pct * 8 // 100))]
        return f"{color}{pie} ctx {total:,}/{CONTEXT_WINDOW:,} ({pct:.2f}%){RESET}"
    return f"{DIM}⏺ tokens {prompt:,} in / {completion:,} out{RESET}"


def main():
    print(f"{BOLD}nanocode{RESET} | {DIM}{MODEL} ({PROVIDER}) | {os.getcwd()}{RESET}\n")
    messages = []
    system_prompt = f"You are a mini coding agent assistant. Your task is to assist with coding tasks and self detect improve your own harness. cwd: {os.getcwd()}"

    while True:
        try:
            print(separator())
            user_input = input(f"{BOLD}{BLUE}❯{RESET} ").strip()
            print(separator())
            if not user_input:
                continue
            if user_input in ("/q", "exit"):
                break
            if user_input == "/c":
                messages = []
                print(f"{GREEN}⏺ Cleared conversation{RESET}")
                continue

            if user_input == "/compact":
                messages = []
                print(f"{GREEN}⏺ WIP: Compacted conversation coming soon{RESET}")
                continue

            messages.append({"role": "user", "content": user_input})

            # agentic loop: keep calling API until no more tool calls
            usage = None
            context_retries = 0
            while True:
                try:
                    response = call_api(messages, system_prompt)
                except RuntimeError as err:
                    trimmed = trim_messages(messages)
                    if context_retries >= 3 or not is_context_error(err) or trimmed is None:
                        raise
                    context_retries += 1
                    messages = trimmed
                    print(f"{YELLOW}⏺ context full — trimmed history, retry {context_retries}/3{RESET}")
                    continue
                content_blocks = response.get("content", [])
                usage = response.get("usage")
                tool_results = []

                for block in content_blocks:
                    if block["type"] == "thinking":
                        thinking_text = block.get("thinking", "")
                        #preview = thinking_text.replace("\n", " ").strip()[:200]
                        print(f"\n{DIM}</... thinking ... {thinking_text}\n>{RESET}")

                    if block["type"] == "text":
                        print(f"\n{CYAN}⏺{RESET} {render_markdown(block['text'])}")

                    if block["type"] == "tool_use":
                        tool_name = block["name"]
                        tool_args = block["input"]
                        arg_preview = str(list(tool_args.values())[0])[:50]
                        print(
                            f"\n{GREEN}⏺ {tool_name.capitalize()}{RESET}({DIM}{arg_preview}{RESET})"
                        )

                        result = run_tool(tool_name, tool_args)
                        result_lines = result.split("\n")
                        preview = result_lines[0][:60]
                        if len(result_lines) > 1:
                            preview += f" ... +{len(result_lines) - 1} lines"
                        elif len(result_lines[0]) > 60:
                            preview += "..."
                        print(f"  {DIM}⎿  {preview}{RESET}")

                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": block["id"],
                                "content": result,
                            }
                        )

                messages.append({"role": "assistant", "content": content_blocks})

                if not tool_results:
                    break
                messages.append({"role": "user", "content": tool_results})

            usage_line = render_usage(usage)
            if usage_line:
                print(usage_line)
            print()

        except (KeyboardInterrupt, EOFError):
            break
        except Exception as err:
            print(f"{RED}⏺ Error: {err}{RESET}")


if __name__ == "__main__":
    main()
