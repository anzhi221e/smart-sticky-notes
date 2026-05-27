"""Auth module — no-op when using service_role key.

With service_role, the client has full access and doesn't need user-level auth.
This module exists for API compatibility; ensure_session() always succeeds.
"""

def ensure_session() -> None:
    """No-op: service_role key bypasses RLS and needs no session management."""
    pass
