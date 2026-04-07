"""
Drive integration schema initialization.
Uses DEFINE TABLE IF NOT EXISTS — completely independent from the core migration system.
Called at API startup via the Drive module startup hook in api/main.py.
"""
from loguru import logger

from open_notebook.database.repository import db_connection


DRIVE_SCHEMA_SQL = """
DEFINE TABLE IF NOT EXISTS drive_credential SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user_email ON TABLE drive_credential TYPE string;
DEFINE FIELD IF NOT EXISTS access_token ON TABLE drive_credential TYPE string;
DEFINE FIELD IF NOT EXISTS refresh_token ON TABLE drive_credential TYPE string;
DEFINE FIELD IF NOT EXISTS expires_at ON TABLE drive_credential TYPE option<string>;
DEFINE FIELD IF NOT EXISTS connected_at ON TABLE drive_credential TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created ON TABLE drive_credential TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS updated ON TABLE drive_credential TYPE option<datetime>;

DEFINE TABLE IF NOT EXISTS drive_sync SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS notebook_id ON TABLE drive_sync TYPE string;
DEFINE FIELD IF NOT EXISTS folder_id ON TABLE drive_sync TYPE string;
DEFINE FIELD IF NOT EXISTS folder_name ON TABLE drive_sync TYPE string;
DEFINE FIELD IF NOT EXISTS poll_interval_minutes ON TABLE drive_sync TYPE int DEFAULT 15;
DEFINE FIELD IF NOT EXISTS last_sync_at ON TABLE drive_sync TYPE option<string>;
DEFINE FIELD IF NOT EXISTS enabled ON TABLE drive_sync TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS created ON TABLE drive_sync TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS updated ON TABLE drive_sync TYPE option<datetime>;

-- Extend core source schema for stable Drive dedupe tracking.
DEFINE FIELD IF NOT EXISTS drive_file_id ON TABLE source TYPE option<string>;
DEFINE FIELD IF NOT EXISTS drive_modified_time ON TABLE source TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_source_drive_file_id ON TABLE source FIELDS drive_file_id;
"""


async def init_drive_schema() -> None:
    """Initialize Drive integration tables. Safe to call multiple times."""
    try:
        async with db_connection() as conn:
            await conn.query(DRIVE_SCHEMA_SQL)
            await conn.query(
                "DELETE drive_sync WHERE notebook_id IS NONE OR notebook_id = NONE"
            )
        logger.success("Google Drive schema initialized")
    except Exception as e:
        logger.error(f"Failed to initialize Google Drive schema: {e}")
        raise
