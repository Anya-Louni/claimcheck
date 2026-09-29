"""Shared test setup: isolated data dir and a fake chat model that can call tools."""

import os
import tempfile
from collections.abc import Iterator
from typing import Any

import pytest

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="claimcheck-test-"))
os.environ.setdefault("GOOGLE_API_KEY", "test-key")
os.environ["FALLBACK_MODEL"] = ""
os.environ["LANGSMITH_TRACING"] = "false"

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402


class FakeToolModel(GenericFakeChatModel):
    """GenericFakeChatModel that accepts bind_tools, so create_agent can use it.

    Streaming is off because the base fake drops tool calls when it streams.
    """

    disable_streaming: bool = True

    def bind_tools(self, tools: Any, **kwargs: Any) -> "FakeToolModel":
        return self


def fake_model(*messages: AIMessage) -> FakeToolModel:
    return FakeToolModel(messages=iter(messages))


def tool_call(name: str, args: dict[str, Any], call_id: str = "call_1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


@pytest.fixture
def data_dir(tmp_path: Any) -> Iterator[Any]:
    yield tmp_path
