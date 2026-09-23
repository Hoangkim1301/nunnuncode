"""nunnuncode - LLM API calls"""

import json, os, urllib.error, urllib.request

from config import (
    API_FORMAT,
    API_URL,
    CUSTOM_KEY,
    MAX_TOKENS,
    MODEL,
    OPENROUTER_KEY,
    THINKING,
    THINKING_BUDGET,
)
from tools import make_openai_schema, make_schema


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


def call_api(messages, system_prompt):
    if API_FORMAT == "openai":
        return call_api_openai(messages, system_prompt)
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
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"HTTP {err.code}: {err.read().decode(errors='replace')[:500]}") from err
    return json.loads(response.read())


def call_api_openai(messages, system_prompt):
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
        response = urllib.request.urlopen(request)
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
    starts = [
        i
        for i, m in enumerate(messages)
        if m["role"] == "user" and isinstance(m["content"], str)
    ]
    if len(starts) < 2:
        return None
    return messages[starts[len(starts) // 2] :]
