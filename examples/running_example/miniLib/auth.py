"""
miniLib/auth.py — Authentication module for MiniLib.

This file is part of the RapidPay paper's running example (Section 3.5).
It contains two SATD instances (c1, c2) that form the structural anchor
of the detected SATD propagation chain.

SATD instances (from Table 1 of the paper):
  c1 (line 12): # TODO: replace plaintext check with bcrypt
  c2 (line 25): # FIXME: cookie not invalidated on logout

Dependency edges discovered by IRD (Stage 2):
  c1 → c2  via call (login calls logout) + module (same file)
  c1 → c3  via call (login calls connect in db.py) + data (shared var `user`)
"""

import hashlib
from miniLib import db

# Shared module-level user state (contributes to data dependency c1→c3)
user = None


def login(username: str, password: str) -> bool:
    """Authenticate a user.

    # TODO: replace plaintext check with bcrypt
    Current implementation compares passwords in plaintext, which is insecure.
    Should be replaced with a proper bcrypt-based comparison before production use.
    """
    global user
    # Plaintext comparison — insecure, should use bcrypt
    stored_hash = hashlib.md5(password.encode()).hexdigest()  # noqa: S324
    result = db.connect(username)  # call dependency → c3 in db.py
    if result:
        user = {"username": username, "hash": stored_hash}
        return True
    return False


def logout(session_token: str) -> None:
    """Invalidate the current session.

    # FIXME: cookie not invalidated on logout
    The session cookie is not explicitly cleared on the client side, leaving
    a window where a stolen cookie could still be used after logout.
    """
    global user
    # Session token is ignored; only server-side state is cleared
    user = None
    # TODO (follows from c1): bcrypt cleanup should happen here too
