"""
miniLib/utils.py — Helper utilities for MiniLib.

This file is part of the RapidPay paper's running example (Section 3.5).
It contains one candidate comment (c4) that passes the lexical filter
(contains the keyword TODO) but is rejected by the LLM in Stage 1 (SID)
because it is a documentation chore, not a structural SATD instance.

Candidate comment (from Table 1 of the paper):
  c4 (line 3): # TODO: add user manual link to README
    LLM verdict: FALSE / confidence 0.35  →  filtered out at τ = 0.7
    This illustrates how the hybrid pipeline avoids false positives that
    a purely lexical detector would incorrectly accept.
"""

# TODO: add user manual link to README
# This is an administrative task (add a hyperlink to documentation).
# It does NOT represent a deferred design or implementation decision
# and is therefore correctly classified as non-SATD by the LLM.


def format_error(code: int, message: str) -> str:
    """Return a standardised error string."""
    return f"[ERR {code}] {message}"


def sanitize_username(name: str) -> str:
    """Strip whitespace and lower-case a username."""
    return name.strip().lower()
