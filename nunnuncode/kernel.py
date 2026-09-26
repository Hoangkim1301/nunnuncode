"""Protected capability dispatch and execution governance."""

import ntpath
from dataclasses import dataclass
import math
import os
from pathlib import Path
import shutil
import stat
import time
from types import MappingProxyType

from tools import CAPABILITIES


DEFAULT_MAX_STEPS = 20
DEFAULT_MAX_WALL_SECONDS = 120
DEFAULT_MAX_OUTPUT_BYTES = 65536
DEFAULT_PROTECTED_PATHS = (
    ".git",
    ".env",
    ".env.example",
    "AGENTS.md",
    "docs/ARCHITECTURE.md",
    "nunnuncode/config.py",
    "nunnuncode/kernel.py",
    "nunnuncode/llm.py",
    "nunnuncode/nunnuncode.py",
    "nunnuncode/tools.py",
)
REPARSE_POINT_ATTRIBUTE = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
SAFE_PROCESS_ENVIRONMENT = frozenset(
    {"COMSPEC", "LANG", "LC_ALL", "PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"}
)


@dataclass(frozen=True)
class ExecutableProfile:
    name: str
    executable: str
    destructive: bool = False
    max_timeout_seconds: float = 30.0
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES

    def __post_init__(self):
        if not self.name or not self.executable or "\x00" in self.executable:
            raise ValueError("executable profile requires a valid name and executable")
        if not math.isfinite(float(self.max_timeout_seconds)) or self.max_timeout_seconds <= 0:
            raise ValueError("profile timeout must be positive and finite")
        if int(self.max_output_bytes) < 0:
            raise ValueError("profile output limit must be non-negative")


class ExecutionBudget:
    """Immutable limits with monotonic, host-controlled accounting."""

    __slots__ = (
        "_max_steps",
        "_max_wall_seconds",
        "_max_output_bytes",
        "_started",
        "_steps",
        "_reason",
    )

    def __setattr__(self, name, value):
        if name in ("_max_steps", "_max_wall_seconds", "_max_output_bytes") and hasattr(self, name):
            raise AttributeError("execution budget limits are immutable")
        object.__setattr__(self, name, value)

    def __init__(
        self,
        max_steps=DEFAULT_MAX_STEPS,
        max_wall_seconds=DEFAULT_MAX_WALL_SECONDS,
        max_output_bytes=DEFAULT_MAX_OUTPUT_BYTES,
    ):
        if max_steps < 0 or max_wall_seconds < 0 or max_output_bytes < 0:
            raise ValueError("execution limits must be non-negative")
        self._max_steps = int(max_steps)
        self._max_wall_seconds = float(max_wall_seconds)
        self._max_output_bytes = int(max_output_bytes)
        self._started = time.monotonic()
        self._steps = 0
        self._reason = None

    @property
    def max_steps(self):
        return self._max_steps

    @property
    def max_wall_seconds(self):
        return self._max_wall_seconds

    @property
    def max_output_bytes(self):
        return self._max_output_bytes

    @property
    def steps(self):
        return self._steps

    @property
    def termination_reason(self):
        return self._reason

    @property
    def remaining_seconds(self):
        return max(0.0, self._max_wall_seconds - (time.monotonic() - self._started))

    def check(self):
        if self._reason:
            return False
        if self._steps >= self._max_steps:
            self._reason = "step limit exceeded"
        elif self.remaining_seconds <= 0:
            self._reason = "wall-clock limit exceeded"
        return self._reason is None

    def consume_step(self):
        if not self.check():
            return False
        self._steps += 1
        return True


class Kernel:
    """The only model-facing entrypoint for registered capabilities."""

    def __init__(
        self,
        workspace,
        budget=None,
        confirm=None,
        protected_paths=None,
        process_profiles=None,
    ):
        self.workspace = Path(workspace).resolve()
        self.budget = budget or ExecutionBudget()
        self._confirm = confirm
        profiles = process_profiles.values() if isinstance(process_profiles, dict) else process_profiles or ()
        profile_map = {}
        for profile in profiles:
            if not isinstance(profile, ExecutableProfile):
                raise TypeError("process profiles must be ExecutableProfile instances")
            if profile.name in profile_map:
                raise ValueError(f"duplicate executable profile: {profile.name}")
            profile_map[profile.name] = profile
        self._process_profiles = MappingProxyType(profile_map)
        paths = protected_paths or DEFAULT_PROTECTED_PATHS
        self._protected_paths = tuple(self._resolve_configured_path(path) for path in paths)

    @property
    def registry(self):
        return CAPABILITIES

    @property
    def termination_reason(self):
        return self.budget.termination_reason

    def dispatch(self, name, args):
        """Validate, authorize, and execute one registered capability call."""
        if not self.budget.consume_step():
            return self._termination_result()
        capability = CAPABILITIES.get(name)
        if capability is None:
            return f"error: capability unavailable: {name}"
        try:
            safe_args = dict(args)
            if capability.permission not in {"workspace.read", "workspace.write", "process.exec"}:
                return f"error: permission denied: {capability.permission}"
            if name == "process_exec":
                return self._dispatch_process(args, capability)
            for field in capability.path_fields:
                if field in safe_args:
                    safe_args[field] = str(self._validate_workspace_path(safe_args[field]))
                elif field == "path":
                    safe_args[field] = str(self.workspace)
            for field in capability.pattern_fields:
                self._validate_pattern(safe_args.get(field, ""))
            if capability.confirmation_required:
                self._validate_existing_file(Path(safe_args["path"]))
            if name in ("glob", "grep"):
                self._reject_reparse_points()
            if capability.confirmation_required and not self._confirmed(name, safe_args):
                return "error: permission denied: confirmation required"
            return capability.handler(safe_args)
        except Exception as err:
            return f"error: {err}"

    def _dispatch_process(self, args, capability):
        if not isinstance(args, dict):
            raise ValueError("process arguments must be an object")
        forbidden = {"cwd", "env", "_cwd", "_env", "output_limit", "_output_limit", "_timeout"}
        if forbidden.intersection(args):
            raise ValueError("cwd, env, and internal process controls are not allowed")
        profile_name = args.get("profile")
        profile = self._process_profiles.get(profile_name)
        if profile is None:
            raise ValueError("process profile unavailable")
        if profile.destructive:
            raise ValueError("destructive process profiles are unavailable")
        argv = args.get("argv")
        if not isinstance(argv, list) or not argv or any(
            not isinstance(value, str) or not value or "\x00" in value for value in argv
        ):
            raise ValueError("argv must be a non-empty list of strings")
        executable = self._resolve_executable(profile.executable)
        supplied_executable = self._resolve_executable(argv[0])
        if os.path.normcase(executable) != os.path.normcase(supplied_executable):
            raise ValueError("argv executable does not match process profile")
        if "executable" in args:
            requested_executable = self._resolve_executable(args["executable"])
            if os.path.normcase(executable) != os.path.normcase(requested_executable):
                raise ValueError("executable does not match process profile")
        requested_timeout = args.get("timeout", profile.max_timeout_seconds)
        if isinstance(requested_timeout, bool) or not isinstance(requested_timeout, (int, float)):
            raise ValueError("timeout must be a finite number")
        if not math.isfinite(float(requested_timeout)) or requested_timeout <= 0:
            raise ValueError("timeout must be a positive finite number")
        if not self.budget.check():
            return self._termination_result()
        timeout = min(
            float(requested_timeout),
            float(profile.max_timeout_seconds),
            self.budget.remaining_seconds,
        )
        if timeout <= 0:
            self.budget.check()
            return self._termination_result()
        output_limit = min(int(profile.max_output_bytes), self.budget.max_output_bytes)
        confirmation_args = {
            "profile": profile.name,
            "argv": [executable] + argv[1:],
            "destructive": profile.destructive,
        }
        if not self._confirmed("process_exec", confirmation_args):
            return "error: permission denied: confirmation required"
        safe_args = {
            "argv": [executable] + argv[1:],
            "_cwd": str(self.workspace),
            "_env": self._safe_process_environment(),
            "_timeout": timeout,
            "_output_limit": output_limit,
        }
        result = capability.handler(safe_args)
        self.budget.check()
        return result

    @staticmethod
    def _resolve_executable(value):
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError("executable must be a non-empty string")
        resolved = shutil.which(value)
        if not resolved:
            raise ValueError("executable unavailable")
        return str(Path(resolved).resolve())

    @staticmethod
    def _safe_process_environment():
        environment = {
            name: value
            for name, value in os.environ.items()
            if name.upper() in SAFE_PROCESS_ENVIRONMENT
        }
        environment["PYTHONIOENCODING"] = "utf-8"
        return environment

    def _confirmed(self, name, args):
        if self._confirm is None:
            return False
        try:
            return bool(self._confirm(name, args))
        except Exception:
            return False

    def _resolve_configured_path(self, path):
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = self.workspace / candidate
        return candidate.resolve()

    def _validate_workspace_path(self, value):
        if not isinstance(value, str) or not value:
            raise ValueError("path must be a non-empty string")
        self._reject_ads_syntax(value)
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = self.workspace / candidate
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.workspace)
        except ValueError as err:
            raise ValueError("path is outside workspace") from err
        if self._is_protected(resolved):
            raise ValueError("path is protected path")
        return resolved

    def _validate_pattern(self, pattern):
        if not isinstance(pattern, str) or not pattern:
            raise ValueError("pattern must be a non-empty string")
        self._reject_ads_syntax(pattern)
        if ntpath.isabs(pattern) or Path(pattern).is_absolute():
            raise ValueError("pattern is outside workspace")
        parts = pattern.replace("\\", "/").split("/")
        if ".." in parts:
            raise ValueError("pattern is outside workspace")

    @staticmethod
    def _reject_ads_syntax(value):
        _drive, remainder = ntpath.splitdrive(value)
        if ":" in remainder:
            raise ValueError("alternate data stream paths are not allowed")

    def _validate_existing_file(self, path):
        if path.exists() and path.stat().st_nlink > 1:
            raise ValueError("existing hard-linked files are not writable")

    def _reject_reparse_points(self):
        pending = [self.workspace]
        while pending:
            current = pending.pop()
            try:
                entries = os.scandir(current)
            except OSError as err:
                raise ValueError("workspace traversal is unavailable") from err
            with entries:
                for entry in entries:
                    try:
                        metadata = entry.stat(follow_symlinks=False)
                    except OSError as err:
                        raise ValueError("workspace traversal is unavailable") from err
                    attributes = getattr(metadata, "st_file_attributes", 0)
                    if (
                        stat.S_ISLNK(metadata.st_mode)
                        or attributes & REPARSE_POINT_ATTRIBUTE
                    ):
                        raise ValueError("workspace contains a reparse point")
                    if stat.S_ISDIR(metadata.st_mode):
                        pending.append(entry.path)

    def _is_protected(self, path):
        for protected in self._protected_paths:
            try:
                path.relative_to(protected)
                return True
            except ValueError:
                continue
        return False

    def _termination_result(self):
        return f"error: execution terminated: {self.budget.termination_reason}"
