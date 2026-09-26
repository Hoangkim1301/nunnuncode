"""nunnuncode - agent capabilities."""

from dataclasses import dataclass
import glob as globlib, os, re, subprocess

from config import DIM, RESET


# --- Tool implementations ---


def read(args):
    with open(args["path"]) as stream:
        lines = stream.readlines()
    offset = args.get("offset", 0)
    limit = args.get("limit", len(lines))
    selected = lines[offset : offset + limit]
    return "".join(f"{offset + idx + 1:4}| {line}" for idx, line in enumerate(selected))


def write(args):
    with open(args["path"], "w") as f:
        f.write(args["content"])
    return "ok"


def edit(args):
    with open(args["path"]) as stream:
        text = stream.read()
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
            with open(filepath) as stream:
                for line_num, line in enumerate(stream, 1):
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


@dataclass(frozen=True)
class CapabilityDefinition:
    """Fixed metadata consumed by the protected kernel."""

    description: str
    parameters: dict
    handler: object
    permission: str
    path_fields: tuple = ()
    pattern_fields: tuple = ()
    confirmation_required: bool = False


# This is the normal model-visible capability set.  In particular, bash is not
# registered here, so it cannot be reached through the kernel or provider schema.
CAPABILITIES = {
    "read": CapabilityDefinition(
        "Read file with line numbers (file path, not directory)",
        {"path": "string", "offset": "number?", "limit": "number?"},
        read,
        "workspace.read",
        path_fields=("path",),
    ),
    "write": CapabilityDefinition(
        "Write content to a workspace file (requires confirmation)",
        {"path": "string", "content": "string"},
        write,
        "workspace.write",
        path_fields=("path",),
        confirmation_required=True,
    ),
    "edit": CapabilityDefinition(
        "Replace old with new in a workspace file (requires confirmation)",
        {"path": "string", "old": "string", "new": "string", "all": "boolean?"},
        edit,
        "workspace.write",
        path_fields=("path",),
        confirmation_required=True,
    ),
    "glob": CapabilityDefinition(
        "Find workspace files by pattern, sorted by mtime",
        {"pat": "string", "path": "string?"},
        glob,
        "workspace.read",
        path_fields=("path",),
        pattern_fields=("pat",),
    ),
    "grep": CapabilityDefinition(
        "Search workspace files for a regex pattern",
        {"pat": "string", "path": "string?"},
        grep,
        "workspace.read",
        path_fields=("path",),
    ),
}


def tool_specs():
    specs = {}
    for name, capability in CAPABILITIES.items():
        description = capability.description
        params = capability.parameters
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
