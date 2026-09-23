import json, os, shutil, subprocess, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PKG = REPO / "nunnuncode"
NANO = PKG / "nunnuncode.py"
sys.path.insert(0, str(PKG))

LOG = []


def make_handler(message_for_body):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            LOG.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
            result = message_for_body(body)
            if isinstance(result, tuple):
                status, payload = result
            else:
                status, payload = 200, {
                    "choices": [{"message": result, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
                }
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    return Handler


def start_server(message_for_body):
    server = HTTPServer(("127.0.0.1", 0), make_handler(message_for_body))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_isolated(stdin_text, env_extra):
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copytree(PKG, Path(tmp) / "nunnuncode")
        script = Path(tmp) / "nunnuncode" / "nunnuncode.py"
        return run_nanocode(stdin_text, env_extra, script=script, cwd=Path(tmp))


def run_nanocode(stdin_text, env_extra, script=None, cwd=None):
    script = script or NANO
    env = dict(os.environ)
    for var in ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "MODEL", "API_BASE_URL", "API_KEY", "CONTEXT_WINDOW"):
        env.pop(var, None)
    env.update(env_extra)
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [sys.executable, str(script)],
        input=stdin_text.encode(),
        capture_output=True,
        env=env,
        cwd=str(cwd or script.parent),
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


class TestOpenAICompatibleProvider(unittest.TestCase):
    def setUp(self):
        LOG.clear()

    def test_agentic_loop_with_tool_call(self):
        def message_for_body(body):
            has_tool_result = any(m.get("role") == "tool" for m in body["messages"])
            if has_tool_result:
                return {"content": "Done. The answer is 4.", "tool_calls": []}
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "bash", "arguments": json.dumps({"cmd": "echo hello"})},
                    }
                ],
            }

        server = start_server(message_for_body)
        port = server.server_address[1]
        code, out, _err = run_isolated(
            "what is 2+2?\n",
            {"API_BASE_URL": f"http://127.0.0.1:{port}/v1", "API_KEY": "test-key", "MODEL": "test-model"},
        )
        server.shutdown()
        server.server_close()

        self.assertEqual(code, 0)
        self.assertEqual(len(LOG), 2, "expected 2 API calls (tool call + final answer)")

        r1, r2 = LOG
        self.assertEqual(r1["path"], "/v1/chat/completions")
        self.assertEqual(r1["auth"], "Bearer test-key")
        self.assertEqual(r1["body"]["model"], "test-model")
        self.assertEqual(r1["body"]["messages"][0]["role"], "system")
        self.assertEqual(r1["body"]["messages"][1], {"role": "user", "content": "what is 2+2?"})
        tool0 = r1["body"]["tools"][0]
        self.assertEqual(tool0["type"], "function")
        self.assertIn("parameters", tool0["function"])

        roles = [m["role"] for m in r2["body"]["messages"]]
        self.assertEqual(roles, ["system", "user", "assistant", "tool"])
        self.assertEqual(r2["body"]["messages"][2]["tool_calls"][0]["id"], "call_1")
        self.assertEqual(r2["body"]["messages"][2]["tool_calls"][0]["function"]["name"], "bash")
        self.assertEqual(r2["body"]["messages"][3]["tool_call_id"], "call_1")

        self.assertIn("hello", out)
        self.assertIn("Done. The answer is 4.", out)
        self.assertIn(f"custom http://127.0.0.1:{port}/v1", out)
        self.assertIn("tokens 100 in / 20 out", out)

    def test_sliding_window_on_context_overflow(self):
        def message_for_body(body):
            turns = sum(
                1
                for m in body["messages"]
                if m.get("role") == "user" and isinstance(m.get("content"), str)
            )
            if turns >= 2:
                return (400, {"error": {"message": "maximum context length exceeded"}})
            return {"content": f"Answer {len(LOG)}", "tool_calls": []}

        server = start_server(message_for_body)
        port = server.server_address[1]
        code, out, _err = run_isolated(
            "first question\nsecond question\n",
            {
                "API_BASE_URL": f"http://127.0.0.1:{port}/v1",
                "API_KEY": "test-key",
                "MODEL": "test-model",
            },
        )
        server.shutdown()
        server.server_close()
        self.assertEqual(code, 0)
        self.assertIn("Answer 1", out)
        self.assertIn("Answer 3", out)
        self.assertNotIn("Answer 2", out)
        self.assertIn("trimmed history", out)
        self.assertEqual(len(LOG), 3)

    def test_usage_percent_with_context_window(self):
        def message_for_body(body):
            return {"content": "Answer.", "tool_calls": []}

        server = start_server(message_for_body)
        port = server.server_address[1]
        code, out, _err = run_isolated(
            "hi\n",
            {
                "API_BASE_URL": f"http://127.0.0.1:{port}/v1",
                "API_KEY": "test-key",
                "MODEL": "test-model",
                "CONTEXT_WINDOW": "1000",
            },
        )
        server.shutdown()
        server.server_close()
        self.assertEqual(code, 0)
        self.assertIn("◔ ctx 120/1,000 (12.00%)", out)

    def test_model_required_with_custom_base_url(self):
        code, _out, err = run_isolated("hi\n", {"API_BASE_URL": "http://127.0.0.1:9/v1"})
        self.assertEqual(code, 1)
        self.assertIn("MODEL environment variable is required", err)


class TestDotenv(unittest.TestCase):
    def test_parses_and_does_not_override_existing_vars(self):
        import config

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text(
                "# comment\n"
                "\n"
                "NANO_TEST_A=preexisting-check\n"
                "export NANO_TEST_B=\"quoted\"\n"
                "NANO_TEST_C='single'\n",
                encoding="utf-8",
            )
            os.environ["NANO_TEST_A"] = "preexisting"
            try:
                config.load_dotenv(path)
                self.assertEqual(os.environ["NANO_TEST_A"], "preexisting")
                self.assertEqual(os.environ["NANO_TEST_B"], "quoted")
                self.assertEqual(os.environ["NANO_TEST_C"], "single")
            finally:
                for var in ("NANO_TEST_A", "NANO_TEST_B", "NANO_TEST_C"):
                    os.environ.pop(var, None)

    def test_missing_file_is_noop(self):
        import config

        config.load_dotenv(Path("/nonexistent/.env"))


if __name__ == "__main__":
    unittest.main()
