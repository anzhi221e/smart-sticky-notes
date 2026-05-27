"""Manage Supabase auth for headless PC sync script.

On first run, opens browser for OAuth/magic link login.
Stores refresh_token in Windows Credential Manager via keyring.
Auto-refreshes session JWT before expiry.
"""
import os
import webbrowser
import time
import keyring
from supabase_client import get_client

SERVICE_NAME = "SmartStickyNotes"
ACCOUNT_NAME = "supabase_refresh_token"

def _store_token(token: str) -> None:
    keyring.set_password(SERVICE_NAME, ACCOUNT_NAME, token)

def _get_stored_token() -> str | None:
    return keyring.get_password(SERVICE_NAME, ACCOUNT_NAME)

def _delete_stored_token() -> None:
    try:
        keyring.delete_password(SERVICE_NAME, ACCOUNT_NAME)
    except keyring.errors.PasswordDeleteError:
        pass

def login() -> bool:
    """Open browser for OAuth login. Returns True if successful."""
    client = get_client()
    url = os.environ.get("SUPABASE_URL", "")

    print(f"Opening browser for login at: {url}")
    webbrowser.open(f"{url}/auth/v1/authorize?provider=email&redirect_to=http://localhost:9999/callback")
    print("After logging in, copy your refresh_token from the session.")

    token = input("Paste your refresh_token: ").strip()
    if token:
        _store_token(token)
        _set_session(token)
        return True
    return False

def _set_session(refresh_token: str) -> None:
    client = get_client()
    try:
        resp = client.auth.refresh_session(refresh_token)
        _store_token(resp.session.refresh_token)
    except Exception as e:
        raise RuntimeError(f"Failed to refresh session: {e}") from e

def ensure_session() -> None:
    """Ensure we have a valid session. Call on startup and before each poll cycle."""
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
            _set_session(token)
            return
        except Exception:
            _delete_stored_token()

    raise RuntimeError("Not authenticated. Run login().")

def logout() -> None:
    _delete_stored_token()
    client = get_client()
    try:
        client.auth.sign_out()
    except Exception:
        pass
