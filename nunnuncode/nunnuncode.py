#!/usr/bin/env python3
"""nunnuncode - micro coding agent"""

import os, re

from config import (
    API_FORMAT,
    BOLD,
    BLUE,
    CONTEXT_WINDOW,
    CYAN,
    DIM,
    GREEN,
    MODEL,
    PROVIDER,
    RED,
    RESET,
    YELLOW,
)
from llm import call_api, is_context_error, trim_messages
from kernel import ExecutionBudget, Kernel


def separator():
    try:
        width = os.get_terminal_size().columns
    except OSError:
        width = 80
    return f"{DIM}{'─' * min(width, 80)}{RESET}"


def render_markdown(text):
    return re.sub(r"\*\*(.+?)\*\*", f"{BOLD}\\1{RESET}", text)


def confirm_capability(name, args):
    target = args.get("path")
    if target is None:
        target = " ".join(repr(value) for value in args.get("argv", []))
    try:
        answer = input(f"Allow {name} for {target}? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer in ("y", "yes")


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
            budget = ExecutionBudget()
            kernel = Kernel(os.getcwd(), budget=budget, confirm=confirm_capability)
            while True:
                if not budget.consume_step():
                    print(f"{YELLOW}⏹ Terminated: {budget.termination_reason}{RESET}")
                    break
                if not budget.check():
                    print(f"{YELLOW}⏹ Terminated: {budget.termination_reason}{RESET}")
                    break
                try:
                    response = call_api(
                        messages,
                        system_prompt,
                        timeout=budget.remaining_seconds,
                    )
                except RuntimeError as err:
                    trimmed = trim_messages(messages)
                    if context_retries >= 3 or not is_context_error(err) or trimmed is None:
                        raise
                    context_retries += 1
                    messages = trimmed
                    print(f"{YELLOW}⏺ context full — trimmed history, retry {context_retries}/3{RESET}")
                    continue
                except (OSError, TimeoutError, ValueError):
                    if not budget.check():
                        print(f"{YELLOW}⏹ Terminated: {budget.termination_reason}{RESET}")
                        break
                    raise
                content_blocks = response.get("content", [])
                usage = response.get("usage")
                tool_results = []
                has_tool_use = any(block["type"] == "tool_use" for block in content_blocks)

                for block in content_blocks:
                    if block["type"] == "thinking":
                        thinking_text = block.get("thinking", "")
                        #preview = thinking_text.replace("\n", " ").strip()[:200]
                        print(f"\n{DIM}</... thinking ... {thinking_text}\n>{RESET}")

                    if block["type"] == "text":
                        label = "Commentary:" if has_tool_use else "Answer:"
                        color = DIM if has_tool_use else CYAN
                        print(f"\n{color}{label}{RESET} {render_markdown(block['text'])}")

                    if block["type"] == "tool_use":
                        tool_name = block["name"]
                        tool_args = block["input"]
                        arg_preview = str(list(tool_args.values())[0])[:50]
                        print(
                            f"\n{GREEN}⏺ {tool_name.capitalize()}{RESET}({DIM}{arg_preview}{RESET})"
                        )

                        result = kernel.dispatch(tool_name, tool_args)
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
                        if kernel.termination_reason:
                            print(
                                f"{YELLOW}⏹ Terminated: {kernel.termination_reason}{RESET}"
                            )
                            break

                messages.append({"role": "assistant", "content": content_blocks})

                if kernel.termination_reason:
                    break
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
