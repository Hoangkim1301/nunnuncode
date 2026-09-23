"""nunnuncode - environment configuration"""

import os


def load_dotenv(path=None):
    if path is None:
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, ".env")
        if not os.path.exists(path):
            # .env lives at the repo root (next to .env.example), one level above
            path = os.path.join(os.path.dirname(here), ".env")
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
