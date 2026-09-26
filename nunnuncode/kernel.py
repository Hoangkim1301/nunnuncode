"""Protected capability dispatch and execution governance."""

import ntpath
import os
from pathlib import Path
import stat
import time

from tools import CAPABILITIES


DEFAULT_MAX_STEPS = 20
DEFAULT_MAX_WALL_SECONDS = 120
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


class ExecutionBudget:
    """Immutable limits with monotonic, host-controlled accounting."""

    __slots__ = ("_max_steps", "_max_wall_seconds", "_started", "_steps", "_reason")

    def __setattr__(self, name, value):
        if name in ("_max_steps", "_max_wall_seconds") and hasattr(self, name):
            raise AttributeError("execution budget limits are immutable")
        object.__setattr__(self, name, value)

    def __init__(self, max_steps=DEFAULT_MAX_STEPS, max_wall_seconds=DEFAULT_MAX_WALL_SECONDS):
        if max_steps < 0 or max_wall_seconds < 0:
            raise ValueError("execution limits must be non-negative")
        self._max_steps = int(max_steps)
        self._max_wall_seconds = float(max_wall_seconds)
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

    def __init__(self, workspace, budget=None, confirm=None, protected_paths=None):
        self.workspace = Path(workspace).resolve()
        self.budget = budget or ExecutionBudget()
        self._confirm = confirm
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
            if capability.permission not in {"workspace.read", "workspace.write"}:
                return f"error: permission denied: {capability.permission}"
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
