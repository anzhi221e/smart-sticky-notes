"""Read user config from Supabase smartstickynotes_config table."""
from supabase_client import get_client

DEFAULT_CONFIG = {
    "local_folder_path": "",
    "filename_template": "{date}_{time}_{type}_{id}",
    "default_calendar_view": "month",
}

def read_config() -> dict:
    client = get_client()
    rows = client.table("smartstickynotes_config").select("key, value").execute()
    cfg = dict(DEFAULT_CONFIG)
    for row in rows.data:
        cfg[row["key"]] = row["value"]
    return cfg

def get_config_last_updated() -> str | None:
    client = get_client()
    rows = client.table("smartstickynotes_config").select("updated_at").order("updated_at", desc=True).limit(1).execute()
    if rows.data:
        return rows.data[0]["updated_at"]
    return None
