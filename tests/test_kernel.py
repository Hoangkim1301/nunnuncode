import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
PKG = REPO / "nunnuncode"
sys.path.insert(0, str(PKG))

from kernel import ExecutableProfile, ExecutionBudget, Kernel
from tools import make_openai_schema


class TestKernel(unittest.TestCase):
    def _python_profile(self, **kwargs):
        return ExecutableProfile("python", sys.executable, **kwargs)

    def _process(self, workspace, argv, timeout=None, **kwargs):
        profile = self._python_profile(**kwargs.pop("profile", {}))
        kernel = Kernel(workspace, process_profiles=[profile], confirm=lambda _name, _args: True)
        args = {"profile": "python", "argv": [sys.executable] + argv}
        if timeout is not None:
            args["timeout"] = timeout
        return kernel.dispatch(
            "process_exec",
            args,
        ), kernel

    def test_read_is_limited_to_the_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            inside = workspace / "note.txt"
            outside = workspace.parent / "outside.txt"
            inside.write_text("inside", encoding="utf-8")
            outside.write_text("outside", encoding="utf-8")
            try:
                kernel = Kernel(workspace)
                self.assertIn("inside", kernel.dispatch("read", {"path": "note.txt"}))
                result = kernel.dispatch("read", {"path": "../outside.txt"})
                self.assertIn("outside workspace", result)
            finally:
                outside.unlink()

    def test_write_requires_host_confirmation_and_protects_kernel(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            approval = lambda _name, _args: False
            kernel = Kernel(workspace, confirm=approval)

            denied = kernel.dispatch(
                "write", {"path": "new.txt", "content": "not written"}
            )
            self.assertIn("confirmation required", denied)
            self.assertFalse((workspace / "new.txt").exists())

            approved = Kernel(workspace, confirm=lambda _name, _args: True)
            self.assertEqual(
                approved.dispatch("write", {"path": "new.txt", "content": "written"}),
                "ok",
            )
            self.assertEqual((workspace / "new.txt").read_text(encoding="utf-8"), "written")

            protected = approved.dispatch(
                "write", {"path": "nunnuncode/kernel.py", "content": "unsafe"}
            )
            self.assertIn("protected path", protected)
            for path in (
                "nunnuncode/tools.py",
                "nunnuncode/config.py",
                "nunnuncode/llm.py",
                "nunnuncode/nunnuncode.py",
            ):
                result = approved.dispatch("write", {"path": path, "content": "unsafe"})
                self.assertIn("protected path", result)
            dotenv = approved.dispatch(
                "write", {"path": ".env", "content": "MAX_STEPS=999999"}
            )
            self.assertIn("protected path", dotenv)

    def test_ads_path_is_rejected_before_file_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            kernel = Kernel(tmp, confirm=lambda _name, _args: True)
            result = kernel.dispatch(
                "write", {"path": "AGENTS.md:review", "content": "unsafe"}
            )
            self.assertIn("alternate data stream", result)

    def test_existing_hard_link_is_rejected_for_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            outside = workspace.parent / "nunnuncode-hard-link-outside.txt"
            target = workspace / "linked.txt"
            outside.write_text("outside", encoding="utf-8")
            try:
                try:
                    os.link(outside, target)
                except (OSError, NotImplementedError) as err:
                    self.skipTest(f"hard links unavailable: {err}")
                kernel = Kernel(workspace, confirm=lambda _name, _args: True)
                result = kernel.dispatch(
                    "write", {"path": "linked.txt", "content": "must not change"}
                )
                self.assertIn("hard-linked", result)
                self.assertEqual(outside.read_text(encoding="utf-8"), "outside")
            finally:
                outside.unlink(missing_ok=True)

    def test_recursive_search_rejects_directory_junction(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            outside = workspace.parent / "nunnuncode-junction-target"
            junction = workspace / "linked-directory"
            outside.mkdir()
            (outside / "secret.txt").write_text("junction secret", encoding="utf-8")
            try:
                try:
                    result = subprocess.run(
                        [
                            "cmd.exe",
                            "/c",
                            "mklink",
                            "/J",
                            str(junction),
                            str(outside),
                        ],
                        capture_output=True,
                        text=True,
                    )
                except OSError as err:
                    self.skipTest(f"junction creation unavailable: {err}")
                if result.returncode != 0 or not junction.exists():
                    self.skipTest(
                        "junction creation unavailable: "
                        + (result.stderr or result.stdout).strip()
                    )

                kernel = Kernel(workspace)
                listed = kernel.dispatch("glob", {"path": ".", "pat": "**/*"})
                searched = kernel.dispatch("grep", {"path": ".", "pat": "junction secret"})
                self.assertIn("reparse point", listed)
                self.assertIn("reparse point", searched)
                self.assertNotIn("junction secret", listed + searched)
            finally:
                if junction.exists():
                    os.rmdir(junction)
                (outside / "secret.txt").unlink(missing_ok=True)
                outside.rmdir()

    def test_normal_schema_has_no_unrestricted_shell(self):
        names = [item["function"]["name"] for item in make_openai_schema()]
        self.assertNotIn("bash", names)
        self.assertEqual(set(names), {"read", "write", "edit", "glob", "grep"})

    def test_process_uses_argv_and_shell_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile = self._python_profile()
            kernel = Kernel(tmp, process_profiles=[profile], confirm=lambda _name, _args: True)
            with mock.patch("tools.subprocess.Popen", wraps=subprocess.Popen) as popen:
                result = kernel.dispatch(
                    "process_exec",
                    {
                        "profile": "python",
                        "argv": [
                            sys.executable,
                            "-c",
                            "import sys; print(sys.argv[1])",
                            "literal & argument",
                        ],
                    },
                )
            self.assertIn("literal & argument", result)
            self.assertFalse(popen.call_args.kwargs["shell"])
            self.assertEqual(
                popen.call_args.args[0][-1],
                "literal & argument",
            )

    def test_process_forces_workspace_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, _kernel = self._process(
                tmp, ["-c", "import os; print(os.getcwd())"]
            )
            self.assertIn(str(Path(tmp).resolve()), result)

    def test_process_rejects_caller_cwd_and_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile = self._python_profile()
            kernel = Kernel(tmp, process_profiles=[profile], confirm=lambda _name, _args: True)
            for forbidden in ("cwd", "env"):
                result = kernel.dispatch(
                    "process_exec",
                    {
                        "profile": "python",
                        "argv": [sys.executable, "-c", "print('unexpected')"],
                        forbidden: {} if forbidden == "env" else str(Path(tmp).parent),
                    },
                )
                self.assertIn("not allowed", result)

    def test_process_strips_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(
                os.environ,
                {
                    "OPENROUTER_API_KEY": "openrouter-secret",
                    "ANTHROPIC_API_KEY": "anthropic-secret",
                    "API_KEY": "api-secret",
                },
                clear=False,
            ):
                result, _kernel = self._process(
                    tmp,
                    [
                        "-c",
                        "import os; print(os.getenv('OPENROUTER_API_KEY')); "
                        "print(os.getenv('ANTHROPIC_API_KEY')); print(os.getenv('API_KEY'))",
                    ],
                )
            self.assertNotIn("secret", result)
            self.assertIn("None", result)

    def test_process_requires_process_exec_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile = self._python_profile()
            kernel = Kernel(tmp, process_profiles=[profile])
            result = kernel.dispatch(
                "process_exec",
                {"profile": "python", "argv": [sys.executable, "-c", "print('no')"]},
            )
            self.assertIn("confirmation required", result)

    def test_unapproved_or_destructive_process_is_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            no_profiles = Kernel(tmp, confirm=lambda _name, _args: True)
            result = no_profiles.dispatch(
                "process_exec",
                {"profile": "python", "argv": [sys.executable, "-c", "print('no')"]},
            )
            self.assertIn("profile unavailable", result)

            destructive = Kernel(
                tmp,
                process_profiles=[self._python_profile(destructive=True)],
                confirm=lambda _name, _args: False,
            )
            result = destructive.dispatch(
                "process_exec",
                {"profile": "python", "argv": [sys.executable, "-c", "print('no')"]},
            )
            self.assertIn("destructive", result)

    def test_destructive_process_is_denied_even_when_confirmed(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "destructive-ran.txt"
            profile = self._python_profile(destructive=True)
            confirmations = []
            kernel = Kernel(
                tmp,
                process_profiles=[profile],
                confirm=lambda name, args: confirmations.append((name, args)) or True,
            )
            result = kernel.dispatch(
                "process_exec",
                {
                    "profile": "python",
                    "argv": [
                        sys.executable,
                        "-c",
                        "import pathlib; pathlib.Path('destructive-ran.txt').write_text('ran')",
                    ],
                },
            )
            self.assertIn("destructive", result)
            self.assertFalse(marker.exists())
            self.assertEqual(confirmations, [])

    def test_process_output_limit_handles_truncated_utf8_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            result, _kernel = self._process(
                tmp,
                [
                    "-c",
                    "import sys; sys.stdout.buffer.write(bytes([195])); sys.stdout.flush()",
                ],
                profile={"max_output_bytes": 1},
            )
            self.assertLessEqual(len(result.encode("utf-8")), 1)

    @unittest.skipUnless(
        os.name != "nt",
        "POSIX process-group cleanup is not exercised on Windows",
    )
    def test_process_timeout_terminates_sigterm_ignoring_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            pid_file = Path(tmp) / "child.pid"
            script = (
                "import pathlib, signal, subprocess, sys, time; "
                "child = subprocess.Popen([sys.executable, '-c', "
                "'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)']); "
                "pathlib.Path('child.pid').write_text(str(child.pid)); time.sleep(30)"
            )
            result, _kernel = self._process(
                tmp,
                ["-c", script],
                timeout=0.3,
                profile={"max_timeout_seconds": 10},
            )
            self.assertTrue(pid_file.exists(), result)
            child_pid = int(pid_file.read_text(encoding="utf-8"))
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    os.kill(child_pid, 0)
                except OSError:
                    break
                time.sleep(0.05)
            else:
                self.fail("SIGTERM-ignoring child process was not reaped")

    def test_process_timeout_terminates_and_reaps_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            pid_file = Path(tmp) / "child.pid"
            script = (
                "import pathlib, subprocess, sys, time; "
                "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']); "
                "pathlib.Path('child.pid').write_text(str(child.pid)); time.sleep(30)"
            )
            result, _kernel = self._process(
                tmp,
                ["-c", script],
                timeout=0.3,
                profile={"max_timeout_seconds": 10},
            )
            self.assertTrue(pid_file.exists(), result)
            child_pid = int(pid_file.read_text(encoding="utf-8"))
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    os.kill(child_pid, 0)
                except OSError:
                    break
                time.sleep(0.05)
            else:
                self.fail("timed-out child process was not reaped")

    def test_process_output_limit_terminates_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            started = time.monotonic()
            result, _kernel = self._process(
                tmp,
                ["-c", "import sys, time; print('x' * 100000, flush=True); time.sleep(30)"],
                profile={"max_output_bytes": 1024},
            )
            self.assertLess(time.monotonic() - started, 3)
            self.assertLessEqual(len(result.encode("utf-8")), 1024)

    def test_process_timeout_is_capped_by_execution_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            budget = ExecutionBudget(max_steps=5, max_wall_seconds=0.2)
            profile = self._python_profile(max_timeout_seconds=30)
            kernel = Kernel(
                tmp,
                budget=budget,
                process_profiles=[profile],
                confirm=lambda _name, _args: True,
            )
            started = time.monotonic()
            kernel.dispatch(
                "process_exec",
                {
                    "profile": "python",
                    "argv": [sys.executable, "-c", "import time; time.sleep(30)"],
                    "timeout": 30,
                },
            )
            self.assertLess(time.monotonic() - started, 3)
            self.assertEqual(budget.termination_reason, "wall-clock limit exceeded")

    def test_normal_schema_excludes_bash_and_unapproved_process(self):
        names = [item["function"]["name"] for item in make_openai_schema()]
        self.assertNotIn("bash", names)
        self.assertNotIn("process_exec", names)

    def test_budget_is_protected_and_dispatch_stops_at_step_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.txt"
            path.write_text("ok", encoding="utf-8")
            budget = ExecutionBudget(max_steps=1, max_wall_seconds=30)
            kernel = Kernel(tmp, budget=budget)

            self.assertIn("ok", kernel.dispatch("read", {"path": str(path)}))
            stopped = kernel.dispatch("read", {"path": str(path)})
            self.assertIn("step limit exceeded", stopped)
            self.assertEqual(budget.max_steps, 1)
            for attr, value in (
                ("max_steps", 99),
                ("max_wall_seconds", 999),
                ("max_output_bytes", 999),
                ("_max_steps", 99),
                ("_max_wall_seconds", 999),
                ("_max_output_bytes", 999),
            ):
                with self.assertRaises(AttributeError):
                    setattr(budget, attr, value)

    def test_expired_budget_reports_wall_clock_reason(self):
        budget = ExecutionBudget(max_steps=5, max_wall_seconds=0)
        kernel = Kernel(tempfile.gettempdir(), budget=budget)
        result = kernel.dispatch("glob", {"path": ".", "pat": "*"})
        self.assertIn("wall-clock limit exceeded", result)


if __name__ == "__main__":
    unittest.main()
