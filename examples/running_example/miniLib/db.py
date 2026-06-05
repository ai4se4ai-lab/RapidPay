"""
miniLib/db.py — Database access module for MiniLib.

This file is part of the RapidPay paper's running example (Section 3.5).
It contains one SATD instance (c3) that is reachable from c1 in auth.py
via both a call dependency (login → connect) and a data dependency
(shared variable `user`).

SATD instances (from Table 1 of the paper):
  c3 (line 8): # HACK: hardcoded credentials for dev
"""

# HACK: hardcoded credentials for dev
# These credentials are embedded directly in source for local development convenience.
# Must be replaced with environment-variable-based configuration before any deployment.
_DB_HOST = "localhost"
_DB_USER = "admin"
_DB_PASS = "admin123"  # noqa: S105


def connect(username: str) -> bool:
    """Open a database connection and verify the user exists.

    Uses hardcoded dev credentials (see HACK above). The `username` parameter
    is consumed here and also read by the caller (auth.login) via the shared
    module-level `user` variable — establishing the data dependency edge c1→c3.
    """
    try:
        # Simulated connection using hardcoded credentials
        print(f"[db] Connecting to {_DB_HOST} as {_DB_USER} to look up '{username}'")
        # In a real implementation this would open a DB connection
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[db] Connection failed: {exc}")
        return False
