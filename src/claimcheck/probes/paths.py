"""The two ways a probe reaches a model: through LangChain, or through the provider SDK.

Each function sends one request and returns an Observation. Scoring happens
elsewhere, so both paths are judged by exactly the same rules.
"""

from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from claimcheck.media import audio_block, image_block
from claimcheck.probes import tasks
from claimcheck.probes.base import Observation


def _openai_tool(spec: dict[str, Any]) -> dict[str, Any]:
    return {"type": "function", "function": spec}


def _from_ai(message: Any) -> Observation:
    if not isinstance(message, AIMessage):
        return Observation(text=str(message))
    calls = [{"name": c["name"], "args": c["args"]} for c in message.tool_calls]
    return Observation(text=message.text, tool_calls=calls)


# LangChain path ------------------------------------------------------------


def lc_tool_calling(model: BaseChatModel) -> Observation:
    bound = model.bind_tools([_openai_tool(tasks.WEATHER_TOOL)])
    return _from_ai(bound.invoke(tasks.TOOL_CALLING_PROMPT))


def lc_tool_choice(model: BaseChatModel) -> Observation:
    tools = [_openai_tool(tasks.WEATHER_TOOL), _openai_tool(tasks.ADD_TOOL)]
    bound = model.bind_tools(tools, tool_choice="add_numbers")
    return _from_ai(bound.invoke(tasks.TOOL_CHOICE_PROMPT))


def lc_parallel(model: BaseChatModel) -> Observation:
    bound = model.bind_tools([_openai_tool(tasks.WEATHER_TOOL)])
    return _from_ai(bound.invoke(tasks.PARALLEL_PROMPT))


def lc_structured(model: BaseChatModel) -> Observation:
    """Native structured output (json_schema), not tool calling."""
    runnable = model.with_structured_output(
        tasks.BOOK_SCHEMA, method="json_schema", include_raw=True
    )
    result = runnable.invoke(tasks.STRUCTURED_PROMPT)
    raw = result.get("raw")
    error = result.get("parsing_error")
    parsed = result.get("parsed")
    return Observation(
        text=getattr(raw, "text", ""),
        tool_calls=[{"name": c["name"], "args": c["args"]} for c in getattr(raw, "tool_calls", [])],
        parsed=parsed if isinstance(parsed, dict) else None,
        error=f"parsing error: {error}" if error else None,
    )


def lc_image(model: BaseChatModel, case: tasks.ImageCase) -> Observation:
    message = HumanMessage(
        content=[{"type": "text", "text": tasks.IMAGE_PROMPT}, image_block(case.png)]
    )
    return _from_ai(model.invoke([message]))


def lc_audio(model: BaseChatModel, case: tasks.AudioCase) -> Observation:
    message = HumanMessage(
        content=[
            {"type": "text", "text": tasks.AUDIO_PROMPT},
            audio_block(case.wav, "audio/wav"),
        ]
    )
    return _from_ai(model.invoke([message]))


# Provider SDK path (Google) ------------------------------------------------


def _sdk_observation(response: Any) -> Observation:
    calls = [
        {"name": fc.name, "args": dict(fc.args or {})} for fc in (response.function_calls or [])
    ]
    parts = response.candidates[0].content.parts if response.candidates else []
    text = "".join(p.text for p in parts or [] if getattr(p, "text", None) and not p.thought)
    return Observation(text=text, tool_calls=calls)


def _declarations(*specs: dict[str, Any]) -> list[Any]:
    from google.genai import types

    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name=s["name"],
                    description=s["description"],
                    parameters_json_schema=s["parameters"],
                )
                for s in specs
            ]
        )
    ]


def sdk_call(client: Any, model: str, capability: str, case: Any = None) -> Observation:
    """Send the same probe request with google-genai directly."""
    from google.genai import types

    config: dict[str, Any] = {}
    contents: Any
    if capability == "tool_calling":
        contents = tasks.TOOL_CALLING_PROMPT
        config["tools"] = _declarations(tasks.WEATHER_TOOL)
    elif capability == "tool_choice":
        contents = tasks.TOOL_CHOICE_PROMPT
        config["tools"] = _declarations(tasks.WEATHER_TOOL, tasks.ADD_TOOL)
        config["tool_config"] = types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(
                mode="ANY", allowed_function_names=["add_numbers"]
            )
        )
    elif capability == "parallel_tool_calls":
        contents = tasks.PARALLEL_PROMPT
        config["tools"] = _declarations(tasks.WEATHER_TOOL)
    elif capability == "structured_output":
        contents = tasks.STRUCTURED_PROMPT
        config["response_mime_type"] = "application/json"
        config["response_json_schema"] = tasks.BOOK_SCHEMA
    elif capability == "image_inputs":
        contents = [types.Part.from_bytes(data=case.png, mime_type="image/png"), tasks.IMAGE_PROMPT]
    elif capability == "audio_inputs":
        contents = [types.Part.from_bytes(data=case.wav, mime_type="audio/wav"), tasks.AUDIO_PROMPT]
    else:
        raise ValueError(f"unknown capability {capability}")
    if "tools" in config:
        config["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)
    response = client.models.generate_content(
        model=model, contents=contents, config=types.GenerateContentConfig(**config)
    )
    obs = _sdk_observation(response)
    if capability == "structured_output":
        obs.parsed = tasks.parse_json_text(obs.text)
    return obs
