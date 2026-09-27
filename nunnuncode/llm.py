"""nunnuncode - LLM API calls"""

import copy
import json
import os
import urllib.error
import urllib.request

from config import (
    API_FORMAT,
    API_URL,
    CONTEXT_WINDOW,
    CUSTOM_KEY,
    MAX_TOKENS,
    MODEL,
    OPENROUTER_KEY,
    THINKING,
    THINKING_BUDGET,
)
from tools import make_openai_schema, make_schema


CONTEXT_CHECKPOINT_MARKER = "[context checkpoint: earlier history omitted]"
TOOL_RESULT_TRUNCATION_MARKER = "[tool result truncated]"
DEFAULT_TOOL_RESULT_BYTES = 4096


class ContextProjectionError(RuntimeError):
    """The canonical context cannot be reduced for another provider attempt."""


def _provider_payload(messages, system_prompt=""):
    if API_FORMAT == "openai":
        payload = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "messages": [{"role": "system", "content": system_prompt}]
            + to_openai_messages(messages),
            "tools": make_openai_schema(),
        }
        if THINKING:
            payload["reasoning"] = {"effort": "high"}
        return payload
    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt,
        "messages": messages,
        "tools": make_schema(),
    }
    if THINKING:
        payload["thinking"] = {"type": "enabled", "budget_tokens": THINKING_BUDGET}
    return payload


def _serialized_context(messages, system_prompt=""):
    return json.dumps(
        _provider_payload(messages, system_prompt),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def estimate_context_tokens(messages, system_prompt=""):
    """Conservatively estimate serialized context at roughly four chars/token."""

    serialized = _serialized_context(messages, system_prompt)
    return (len(serialized) + 3) // 4


def context_size(messages, system_prompt=""):
    return len(_serialized_context(messages, system_prompt))


def _utf8_prefix(text, byte_limit):
    result = []
    used = 0
    for character in text:
        encoded = character.encode("utf-8")
        if used + len(encoded) > byte_limit:
            break
        result.append(character)
        used += len(encoded)
    return "".join(result)


def _utf8_suffix(text, byte_limit):
    result = []
    used = 0
    for character in reversed(text):
        encoded = character.encode("utf-8")
        if used + len(encoded) > byte_limit:
            break
        result.append(character)
        used += len(encoded)
    return "".join(reversed(result))


def truncate_tool_result(text, max_bytes=DEFAULT_TOOL_RESULT_BYTES):
    """Return a deterministic UTF-8-safe head/tail projection of tool text."""

    if not isinstance(text, str) or len(text.encode("utf-8")) <= max_bytes:
        return text
    if max_bytes <= 0:
        return ""
    marker = f"\n...{TOOL_RESULT_TRUNCATION_MARKER}...\n"
    if len(marker.encode("utf-8")) >= max_bytes:
        return _utf8_prefix(marker, max_bytes)
    available = max_bytes - len(marker.encode("utf-8"))
    head_budget = available // 2
    head = _utf8_prefix(text, head_budget)
    tail_budget = available - len(head.encode("utf-8"))
    tail = _utf8_suffix(text[len(head) :], tail_budget)
    return head + marker + tail


def _has_tool_use(message):
    return message.get("role") == "assistant" and isinstance(message.get("content"), list) and any(
        block.get("type") == "tool_use" for block in message["content"]
    )


def _has_tool_result(message):
    return message.get("role") == "user" and isinstance(message.get("content"), list) and any(
        block.get("type") == "tool_result" for block in message["content"]
    )


def _tool_call_group_matches(assistant_message, result_message):
    call_ids = [
        block.get("id")
        for block in assistant_message.get("content", [])
        if block.get("type") == "tool_use"
    ]
    result_ids = [
        block.get("tool_use_id")
        for block in result_message.get("content", [])
        if block.get("type") == "tool_result"
    ]
    if not call_ids or any(not isinstance(identifier, str) for identifier in call_ids + result_ids):
        return False
    return len(call_ids) == len(set(call_ids)) and sorted(call_ids) == sorted(result_ids)


def _complete_segments(messages):
    prefix = []
    segments = []
    current = None
    for message in messages:
        if message.get("role") == "user" and isinstance(message.get("content"), str):
            if current is not None:
                segments.append(current)
            current = [message]
        elif current is None:
            prefix.append(message)
        else:
            current.append(message)
    if current is not None:
        segments.append(current)

    complete = []
    for segment in segments:
        retained = []
        index = 0
        while index < len(segment):
            message = segment[index]
            if _has_tool_use(message):
                if (
                    index + 1 < len(segment)
                    and _has_tool_result(segment[index + 1])
                    and _tool_call_group_matches(message, segment[index + 1])
                ):
                    retained.extend((message, segment[index + 1]))
                    index += 2
                else:
                    index += 2 if index + 1 < len(segment) and _has_tool_result(segment[index + 1]) else 1
            elif _has_tool_result(message):
                index += 1
            else:
                retained.append(message)
                index += 1
        if retained:
            complete.append(retained)
    return prefix, complete


def _truncate_active_tool_results(messages, max_bytes):
    projected = copy.deepcopy(messages)
    for message in projected:
        if not _has_tool_result(message):
            continue
        for block in message["content"]:
            if block.get("type") == "tool_result" and isinstance(block.get("content"), str):
                block["content"] = truncate_tool_result(block["content"], max_bytes)
    return projected


def _insert_checkpoint_marker(messages):
    projected = copy.deepcopy(messages)
    if CONTEXT_CHECKPOINT_MARKER in json.dumps(projected, ensure_ascii=False):
        return projected
    for message in projected:
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str) and CONTEXT_CHECKPOINT_MARKER in content:
            return projected
        if isinstance(content, list) and any(
            block.get("type") == "text"
            and CONTEXT_CHECKPOINT_MARKER in block.get("text", "")
            for block in content
        ):
            return projected
    for message in projected:
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            if CONTEXT_CHECKPOINT_MARKER not in content:
                message["content"] = f"{CONTEXT_CHECKPOINT_MARKER}\n{content}"
        elif isinstance(content, list):
            inserted = False
            for block in content:
                if block.get("type") == "text":
                    if CONTEXT_CHECKPOINT_MARKER not in block.get("text", ""):
                        block["text"] = f"{CONTEXT_CHECKPOINT_MARKER}\n{block.get('text', '')}"
                    inserted = True
                    break
            if not inserted:
                content.insert(0, {"type": "text", "text": CONTEXT_CHECKPOINT_MARKER})
        break
    return projected


def _flatten_segments(prefix, segments):
    flattened = copy.deepcopy(prefix)
    for segment in segments:
        flattened.extend(copy.deepcopy(segment))
    return flattened


def compact_messages(
    messages,
    system_prompt="",
    context_window=CONTEXT_WINDOW,
    output_tokens=MAX_TOKENS,
    force=False,
    tool_result_bytes=DEFAULT_TOOL_RESULT_BYTES,
):
    """Build an active projection without mutating the canonical message list."""

    original = copy.deepcopy(messages)
    budget = None
    if context_window and context_window > 0:
        budget = max(0, int(context_window) - int(output_tokens))
    if not force and (budget is None or estimate_context_tokens(original, system_prompt) <= budget):
        return original

    prefix, segments = _complete_segments(original)
    if not segments:
        return original
    selected = [segments[-1]]
    marker_needed = len(segments) > 1 or force

    def build(selected_segments, result_bytes, add_marker):
        projected = _truncate_active_tool_results(
            _flatten_segments(prefix, selected_segments), result_bytes
        )
        return _insert_checkpoint_marker(projected) if add_marker else projected

    def fit(selected_segments, add_marker):
        candidate = build(selected_segments, tool_result_bytes, add_marker)
        if budget is None or estimate_context_tokens(candidate, system_prompt) <= budget:
            return candidate
        low, high = 0, max(0, int(tool_result_bytes))
        best = None
        zero_result_candidate = build(selected_segments, 0, add_marker)
        if estimate_context_tokens(zero_result_candidate, system_prompt) <= budget:
            best = zero_result_candidate
        while low <= high:
            middle = (low + high) // 2
            trial = build(selected_segments, middle, add_marker)
            if estimate_context_tokens(trial, system_prompt) <= budget:
                best = trial
                low = middle + 1
            else:
                high = middle - 1
        return best

    if budget is not None and not force:
        for index in range(len(segments) - 2, -1, -1):
            candidate_segments = [segments[index]] + selected
            candidate = fit(candidate_segments, False)
            if candidate is not None and estimate_context_tokens(candidate, system_prompt) <= budget:
                selected = candidate_segments
            else:
                break
    projected = fit(selected, marker_needed)
    if projected is None:
        raise ContextProjectionError("context cannot reduce to a budget-fitting projection")
    if not marker_needed and context_size(projected, system_prompt) < context_size(original, system_prompt):
        projected = _insert_checkpoint_marker(projected)
    if context_size(projected, system_prompt) >= context_size(original, system_prompt):
        raise ContextProjectionError("context cannot reduce to a strictly smaller projection")
    if budget is not None and estimate_context_tokens(projected, system_prompt) > budget:
        raise ContextProjectionError("context projection exceeds the reserved input budget")
    return projected


def rebuild_context(messages, system_prompt="", context_window=CONTEXT_WINDOW, output_tokens=MAX_TOKENS):
    """Build the one allowed overflow retry and require a strict reduction."""

    projected = compact_messages(
        messages,
        system_prompt=system_prompt,
        context_window=context_window,
        output_tokens=output_tokens,
        force=True,
    )
    if context_size(projected, system_prompt) >= context_size(messages, system_prompt):
        raise ContextProjectionError("context cannot reduce without dropping current content")
    return projected


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


def call_api(messages, system_prompt, timeout=None):
    if API_FORMAT == "openai":
        return call_api_openai(messages, system_prompt, timeout=timeout)
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
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}") from err
    return json.loads(response.read())


def call_api_openai(messages, system_prompt, timeout=None):
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
        response = urllib.request.urlopen(request, timeout=timeout)
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


CONTEXT_ERROR_HINTS = ("context", "too long", "maximum context", "context_length", "length_exceeded")


def is_context_error(err):
    text = str(err).lower()
    return "http 400" in text and any(hint in text for hint in CONTEXT_ERROR_HINTS)


def trim_messages(messages):
    """Compatibility wrapper for callers of the former sliding-window helper."""

    return compact_messages(messages, force=True)
