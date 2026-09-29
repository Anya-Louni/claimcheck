"""SQLite-backed short-term memory (checkpointer) and long-term memory (store)."""

import sqlite3
from functools import cache

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.store.sqlite import SqliteStore

from claimcheck.config import settings

# Only our own report types may be rebuilt from a checkpoint.
SAFE_TYPES = [("claimcheck.schemas", "ProfileReport"), ("claimcheck.schemas", "ClaimVerdict")]


@cache
def checkpointer() -> SqliteSaver:
    """Conversation state per thread_id, so follow-up questions work."""
    conn = sqlite3.connect(settings.data_dir / "checkpoints.sqlite", check_same_thread=False)
    return SqliteSaver(conn, serde=JsonPlusSerializer(allowed_msgpack_modules=SAFE_TYPES))


@cache
def store() -> SqliteStore:
    """Saved findings that outlive a thread."""
    conn = sqlite3.connect(
        settings.data_dir / "store.sqlite", check_same_thread=False, isolation_level=None
    )
    saver = SqliteStore(conn)
    saver.setup()
    return saver


def in_memory() -> InMemorySaver:
    """In-memory checkpointer for notebooks and evals, with the same safe types."""
    return InMemorySaver(serde=JsonPlusSerializer(allowed_msgpack_modules=SAFE_TYPES))
