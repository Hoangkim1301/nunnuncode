"""nunnuncode - agent capabilities."""

from dataclasses import dataclass
import glob as globlib
import os
import re
import signal
import subprocess
import threading
import time


# --- Workspace capability implementations ---


def read(args):
    with open(args["path"]) as stream:
        lines = stream.readlines()
    offset = args.get("offset", 0)
    limit = args.get("limit", len(lines))
    selected = lines[offset : offset + limit]
    return "".join(f"{offset + idx + 1:4}| {line}" for idx, line in enumerate(selected))


def write(args):
    with open(args["path"], "w") as stream:
        stream.write(args["content"])
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
    with open(args["path"], "w") as stream:
        stream.write(replacement)
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


def _terminate_process_tree(proc):
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (OSError, ProcessLookupError):
            pass
    try:
        proc.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        pass
    if os.name != "nt":
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass


def _bounded_process_output(data, limit, status=None):
    def fit_utf8(text, byte_limit):
        result = []
        used = 0
        for character in text:
            encoded = character.encode("utf-8")
            if used + len(encoded) > byte_limit:
                break
            result.append(character)
            used += len(encoded)
        return "".join(result)

    decoded = data.decode("utf-8", errors="replace")
    if not status:
        return fit_utf8(decoded, limit)
    marker = f"\n(process {status})"
    marker = fit_utf8(marker, limit)
    content_limit = max(0, limit - len(marker.encode("utf-8")))
    return fit_utf8(decoded, content_limit) + marker


def process_exec(args):
    argv = args["argv"]
    timeout = args["_timeout"]
    output_limit = args["_output_limit"]
    popen_args = {
        "cwd": args["_cwd"],
        "env": args["_env"],
        "shell": False,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
    }
    if os.name == "nt":
        popen_args["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_args["start_new_session"] = True
    proc = subprocess.Popen(argv, **popen_args)
    output = bytearray()
    output_limit_reached = threading.Event()

    def collect_output():
        total = 0
        try:
            while True:
                chunk = proc.stdout.read(8192)
                if not chunk:
                    return
                total += len(chunk)
                if len(output) < output_limit:
                    output.extend(chunk[: output_limit - len(output)])
                if total > output_limit:
                    output_limit_reached.set()
        except OSError:
            return

    reader = threading.Thread(target=collect_output, daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    status = None
    while proc.poll() is None:
        if output_limit_reached.is_set():
            status = "output limit exceeded"
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            status = "timed out"
            break
        try:
            proc.wait(timeout=min(0.05, remaining))
        except subprocess.TimeoutExpired:
            pass
    if status:
        _terminate_process_tree(proc)
    else:
        proc.wait()
    reader.join(timeout=2)
    if reader.is_alive():
        _terminate_process_tree(proc)
        reader.join(timeout=2)
    proc.stdout.close()
    if status is None and output_limit_reached.is_set():
        status = "output limit exceeded"
    return _bounded_process_output(bytes(output), output_limit, status)


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


# The process capability is registered for host-side dispatch but omitted from
# the normal model schema unless the host explicitly supplies profiles.
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
    "process_exec": CapabilityDefinition(
        "Run an approved executable with an explicit argv (requires confirmation)",
        {"profile": "string", "argv": "array", "timeout": "number?"},
        process_exec,
        "process.exec",
        confirmation_required=True,
    ),
}


def tool_specs(process_profiles=None):
    specs = {}
    for name, capability in CAPABILITIES.items():
        if name == "process_exec" and not process_profiles:
            continue
        properties = {}
        required = []
        for param_name, param_type in capability.parameters.items():
            is_optional = param_type.endswith("?")
            base_type = param_type.rstrip("?")
            if base_type == "number":
                properties[param_name] = {"type": "integer"}
            elif base_type == "array":
                properties[param_name] = {
                    "type": "array",
                    "items": {"type": "string"},
                }
            else:
                properties[param_name] = {"type": base_type}
            if not is_optional:
                required.append(param_name)
        specs[name] = (capability.description, properties, required)
    return specs


def make_schema(process_profiles=None):
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
        for name, (description, properties, required) in tool_specs(process_profiles).items()
    ]


def make_openai_schema(process_profiles=None):
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
        for name, (description, properties, required) in tool_specs(process_profiles).items()
    ]
