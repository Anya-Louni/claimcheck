# Versions

Confirmed on 2026-09-29 against the installed packages.

| Package | Version |
|---|---|
| langchain | 1.4.3 |
| langchain-core | 1.6.5 |
| langgraph | 1.2.12 |
| langgraph-checkpoint | 4.2.0 |
| langgraph-checkpoint-sqlite | 3.1.1 |
| langchain-google-genai | 4.4.0 |
| langchain-tavily | 0.2.18 |
| langchain-tests | 1.1.9 |
| google-genai | 2.25.0 |
| fastapi | 0.141.1 |
| langsmith | 0.14.1 |
| Python | 3.12 |

## Confirmed APIs

- `langchain.agents.create_agent(model, tools, *, system_prompt, middleware, response_format, state_schema, context_schema, checkpointer, store, ...)`
- `langchain.chat_models.init_chat_model(model, *, model_provider, configurable_fields, ...)`
- `langchain_core.tools.tool` decorator
- `AgentMiddleware` hooks: `before_agent`, `before_model`, `after_model`, `after_agent`, `wrap_model_call`, `wrap_tool_call`, plus async `a*` versions.
- Built-in middleware in `langchain.agents.middleware`: `ModelCallLimitMiddleware(thread_limit, run_limit, exit_behavior)`, `ToolCallLimitMiddleware(tool_name, thread_limit, run_limit, exit_behavior)`, `ModelRetryMiddleware`, `ToolRetryMiddleware`, `ModelFallbackMiddleware(first_model, *additional_models)`, `SummarizationMiddleware(model, trigger, keep)`, `HumanInTheLoopMiddleware(interrupt_on)`.
- Structured output strategies in `langchain.agents.structured_output`: `ToolStrategy`, `ProviderStrategy`, `AutoStrategy`.
- Checkpointers: `langgraph.checkpoint.memory.InMemorySaver`, `langgraph.checkpoint.sqlite.SqliteSaver`. Store: `langgraph.store.memory.InMemoryStore`.
- Stream modes: `values`, `updates`, `checkpoints`, `tasks`, `debug`, `messages`, `custom`.
- Content blocks in `langchain_core.messages.content`: `TextContentBlock`, `ImageContentBlock`, `AudioContentBlock`, `FileContentBlock` and others.
- Model profiles: `BaseChatModel.profile`. `ChatGoogleGenerativeAI(model="gemini-2.5-flash").profile` reports `tool_calling`, `structured_output`, `image_inputs`, `audio_inputs`, `max_input_tokens` and more. Source data ships in `langchain_google_genai/data/_profiles.py` and `profile_augmentations.toml`.
- `langchain-tests` ships suites for chat models, tools, embeddings, stores, caches, retrievers, vector stores and sandboxes. It has no middleware suite.
- `ToolErrorMiddleware(on_error=...)` turns tool exceptions into error tool messages. Used so a bad tool call does not end the run.
- `langchain_core.rate_limiters.InMemoryRateLimiter` paces model calls. Passed as `rate_limiter=` to `init_chat_model`.
- `JsonPlusSerializer(allowed_msgpack_modules=[...])` is needed for Pydantic types stored in checkpoints. Without it, LangGraph 1.2 warns and will block them later.
- `ToolStrategy(ProfileReport)` is used for the final report. `AutoStrategy` reads the model profile to choose, and some Gemini profiles are empty (see below), so the strategy is set explicitly.

## Gemini API facts checked on 2026-09-29

- `gemini-2.5-flash` returns 404 for new users.
- Free tier on this key: `gemini-3.8-flash` and `gemini-flash-latest` allow 20 requests per day per model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, from the 429 response).
- `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite` answered normally during development, so the agent runs on Flash-Lite by default.
- `langchain-google-genai` 4.4.0 (released 2026-09-01) has no profile for `gemini-3.8-flash` (released 2026-09-02), while models.dev has one.
- Model limits come from `client.models.get(model).input_token_limit` and `output_token_limit` in `google-genai`.
