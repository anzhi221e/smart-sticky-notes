"""Manage Supabase auth for headless PC sync script.

Reads refresh_token from SUPABASE_REFRESH_TOKEN env var.
Stores in Windows Credential Manager after first refresh.
"""
import os
import time
import keyring
from supabase_client import get_client

SERVICE_NAME = "SmartStickyNotes"
ACCOUNT_NAME = "supabase_refresh_token"


def _store_token(token: str) -> None:
    keyring.set_password(SERVICE_NAME, ACCOUNT_NAME, token)


def _get_stored_token() -> str | None:
    return keyring.get_password(SERVICE_NAME, ACCOUNT_NAME)


def initial_auth() -> bool:
    """Use refresh_token from env var to create session. Stores token for future use."""
    token = os.environ.get("SUPABASE_REFRESH_TOKEN", "").strip()
    if not token:
        print("Set SUPABASE_REFRESH_TOKEN env var for first-time auth.")
        print("To get it: open PWA in browser → F12 → Application → Local Storage")
        print("→ find key 'supabase-auth-token' → copy the refresh_token value")
        return False

    client = get_client()
    try:
        resp = client.auth.refresh_session(token)
        _store_token(resp.session.refresh_token)
        print("Authentication successful.")
        return True
    except Exception as e:
        print(f"Auth failed: {e}")
        return False


def ensure_session() -> None:
    """Ensure valid session. Tries stored token first, then env var."""
    client = get_client()
    try:
        session = client.auth.get_session()
        if session and session.expires_at and session.expires_at > time.time() + 300:
            return
    except Exception:
        pass

    token = _get_stored_token()
    if token:
        try:
            resp = client.auth.refresh_session(token)
            _store_token(resp.session.refresh_token)
            return
        except Exception:
            pass

    if not initial_auth():
        raise RuntimeError("Not authenticated. Set SUPABASE_REFRESH_TOKEN and try again.")
