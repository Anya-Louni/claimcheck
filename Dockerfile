# API image for Render or any container host.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src
COPY fixtures ./fixtures
COPY demo ./demo
RUN uv sync --locked --no-dev

# Runs as any user; only /tmp needs to be writable.
ENV DATA_DIR=/tmp/claimcheck \
    PATH="/app/.venv/bin:$PATH" \
    TRUST_PROXY=1 \
    PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn claimcheck.api.app:app --host 0.0.0.0 --port ${PORT}"]
