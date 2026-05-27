"""Supabase client factory. Reads credentials from environment or .env file."""
import os
from pathlib import Path
from supabase import create_client, Client

_ENV_LOADED = False


def _load_dotenv():
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip()
                if key not in os.environ:
                    os.environ[key] = value
    _ENV_LOADED = True


def get_client(use_service_role: bool = True) -> Client:
    _load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    if use_service_role:
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    else:
        key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. "
            "Copy sync/.env.example to sync/.env and fill in your values."
        )
    return create_client(url, key)
