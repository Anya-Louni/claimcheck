"""Build the Claimcheck agent with create_agent."""

from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import (
    HumanInTheLoopMiddleware,
    ModelCallLimitMiddleware,
    SummarizationMiddleware,
    ToolCallLimitMiddleware,
    ToolErrorMiddleware,
)
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.store.base import BaseStore

from claimcheck.budget import BudgetMiddleware
from claimcheck.config import Limits, settings
from claimcheck.evidence_check import EvidenceCheckMiddleware
from claimcheck.models import make_model, reliability_middleware
from claimcheck.probes import daily_cap
from claimcheck.prompts import SYSTEM_PROMPT
from claimcheck.schemas import ProfileReport
from claimcheck.tools import ALL_TOOLS, APPROVAL_TOOLS


def build_middleware(model: BaseChatModel, limits: Limits) -> list[Any]:
    """Middleware order matters: limits first, approvals and checks last."""
    return [
        BudgetMiddleware(
            max_tokens=limits.tokens_per_run,
            max_seconds=limits.seconds_per_run,
            daily_cap=daily_cap,
        ),
        ModelCallLimitMiddleware(run_limit=limits.model_calls_per_run, exit_behavior="end"),
        ToolCallLimitMiddleware(run_limit=limits.tool_calls_per_run, exit_behavior="end"),
        *reliability_middleware(),
        SummarizationMiddleware(model, trigger=("tokens", 60_000), keep=("messages", 20)),
        HumanInTheLoopMiddleware(
            interrupt_on={
                name: {"allowed_decisions": ["approve", "edit", "reject"]}
                for name in APPROVAL_TOOLS
            }
        ),
        ToolErrorMiddleware(on_error=_tool_error),
        EvidenceCheckMiddleware(),
    ]


def _tool_error(exc: Exception, request: Any) -> str:
    """Tell the model a tool failed without echoing internal details."""
    name = request.tool_call["name"]
    return (
        f"{name} failed with {type(exc).__name__}. Check the arguments. "
        "If it fails again, list this check under unverified."
    )


def build_agent(
    *,
    model: BaseChatModel | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
    store: BaseStore | None = None,
    tools: list[Any] | None = None,
    limits: Limits | None = None,
) -> Any:
    """Create the agent. Pass a fake model and in-memory savers in tests."""
    chat_model = model or make_model()
    return create_agent(
        chat_model,
        tools=tools if tools is not None else ALL_TOOLS,
        system_prompt=SYSTEM_PROMPT,
        middleware=build_middleware(chat_model, limits or settings.limits),
        response_format=ToolStrategy(ProfileReport),
        checkpointer=checkpointer,
        store=store,
        name="claimcheck",
    )
