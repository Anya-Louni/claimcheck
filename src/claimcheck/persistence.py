"""SQLite-backed short-term memory (checkpointer) and long-term memory (store)."""

import sqlite3
from functools import cache

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.store.sqlite import SqliteStore

from claimcheck.config import settings


@cache
def checkpointer() -> SqliteSaver:
    """Conversation state per thread_id, so follow-up questions work."""
    conn = sqlite3.connect(settings.data_dir / "checkpoints.sqlite", check_same_thread=False)
    return SqliteSaver(conn)


@cache
def store() -> SqliteStore:
    """Saved findings that outlive a thread."""
    conn = sqlite3.connect(
        settings.data_dir / "store.sqlite", check_same_thread=False, isolation_level=None
    )
    saver = SqliteStore(conn)
    saver.setup()
    return saver
