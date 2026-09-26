import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
PKG = REPO / "nunnuncode"
sys.path.insert(0, str(PKG))

from kernel import ExecutionBudget, Kernel
from tools import make_openai_schema


class TestKernel(unittest.TestCase):
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
                ("_max_steps", 99),
                ("_max_wall_seconds", 999),
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
