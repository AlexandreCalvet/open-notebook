"""
Polling-based sync: checks Drive folders for changes and triggers the existing
source ingestion pipeline. Reuses core domain models without duplicating logic.
"""
import os
from datetime import datetime, timezone

from loguru import logger

from open_notebook.database.repository import (
    ensure_record_id,
    repo_create,
    repo_query,
    repo_relate,
    repo_upsert,
)

from integrations.google_drive import service as drive_service


async def sync_all() -> None:
    """
    Main polling entry point. Called by the APScheduler every N minutes.
    Iterates all enabled drive_sync records and syncs each folder.
    """
    if not os.environ.get("GOOGLE_DRIVE_CLIENT_ID"):
        return

    cred = await drive_service.get_credential()
    if not cred:
        logger.debug("Drive sync skipped: no credential configured")
        return

    syncs = await repo_query("SELECT * FROM drive_sync WHERE enabled = true")
    if not syncs:
        logger.debug("Drive sync: no active sync configurations")
        return

    logger.info(f"Drive sync: processing {len(syncs)} folder(s)")
    for sync in syncs:
        try:
            await _sync_folder(sync)
        except Exception as e:
            logger.error(
                f"Drive sync failed for folder {sync.get('folder_id')}: {e}"
            )


async def _sync_folder(sync: dict) -> None:
    """Sync a single drive_sync record."""
    sync_id = sync["id"]
    folder_id = sync["folder_id"]
    notebook_id = sync["notebook_id"]

    logger.info(f"Syncing Drive folder '{sync.get('folder_name')}' → notebook {notebook_id}")

    files = await drive_service.list_folder_contents(folder_id)
    logger.debug(f"Found {len(files)} supported file(s) in folder {folder_id}")

    for file in files:
        try:
            await _process_file(file, notebook_id)
        except Exception as e:
            logger.error(f"Failed to process Drive file {file.get('id')}: {e}")

    await repo_upsert(
        "drive_sync",
        sync_id,
        {"last_sync_at": datetime.now(timezone.utc).isoformat()},
    )


async def _process_file(file: dict, notebook_id: str) -> None:
    """
    Create or update a Source for a Drive file.
    Skips if the file's modifiedTime hasn't changed since last indexing.

    drive_file_id and drive_modified_time are stored as top-level fields on
    the source record (not inside asset) so they survive the source_graph
    processing step, which overwrites asset with a plain Asset(url, file_path).
    """
    drive_file_id = file["id"]
    drive_modified_time = file["modifiedTime"]

    existing = await repo_query(
        "SELECT * FROM source WHERE drive_file_id = $fid LIMIT 1",
        {"fid": drive_file_id},
    )

    if existing:
        source_data = existing[0]
        existing_modified = source_data.get("drive_modified_time")
        if existing_modified == drive_modified_time:
            logger.debug(f"Drive file {drive_file_id} unchanged, skipping")
            return
        logger.info(f"Drive file {drive_file_id} changed ({existing_modified} → {drive_modified_time}), re-indexing")
        await _reindex_source(source_data, file)
    else:
        logger.info(f"New Drive file {drive_file_id} ('{file['name']}'), creating source")
        await _create_source(file, notebook_id)


async def _reindex_source(source_data: dict, file: dict) -> None:
    """Re-download and re-index an existing source whose Drive file changed."""
    import commands.source_commands  # noqa: F401 — must be imported to register the command
    from surreal_commands import submit_command
    from commands.source_commands import SourceProcessingInput

    source_id = source_data["id"]
    file_path = await drive_service.download_file(
        file_id=file["id"],
        file_name=file["name"],
        mime_type=file["mimeType"],
    )

    # Update the file path in asset, and keep drive tracking fields at top level
    # (drive_file_id / drive_modified_time are top-level so source_graph doesn't overwrite them)
    await repo_upsert("source", source_id, {
        "asset": {"file_path": file_path},
        "drive_file_id": file["id"],
        "drive_modified_time": file["modifiedTime"],
    })

    command_input = SourceProcessingInput(
        source_id=str(source_id),
        content_state={"file_path": file_path, "delete_source": True},
        notebook_ids=[],
        transformations=[],
        embed=True,
    )
    submit_command("open_notebook", "process_source", command_input.model_dump())
    logger.info(f"Re-indexing triggered for source {source_id}")


async def _create_source(file: dict, notebook_id: str) -> None:
    """Download a new Drive file and create a Source + notebook reference."""
    import commands.source_commands  # noqa: F401 — must be imported to register the command
    from surreal_commands import submit_command
    from commands.source_commands import SourceProcessingInput

    file_path = await drive_service.download_file(
        file_id=file["id"],
        file_name=file["name"],
        mime_type=file["mimeType"],
    )

    # drive_file_id and drive_modified_time are top-level fields (not inside asset)
    # so source_graph processing does not overwrite them when it sets source.asset
    source_record = await repo_create(
        "source",
        {
            "title": file["name"],
            "asset": {"file_path": file_path},
            "drive_file_id": file["id"],
            "drive_modified_time": file["modifiedTime"],
        },
    )
    source_id = source_record["id"]

    await repo_relate(
        ensure_record_id(source_id),
        "reference",
        ensure_record_id(notebook_id),
    )

    command_input = SourceProcessingInput(
        source_id=str(source_id),
        content_state={"file_path": file_path, "delete_source": True},
        notebook_ids=[notebook_id],
        transformations=[],
        embed=True,
    )
    submit_command("open_notebook", "process_source", command_input.model_dump())
    logger.info(f"Created source {source_id} for Drive file '{file['name']}'")


async def force_sync(sync_id: str) -> None:
    """Manually trigger sync for a specific drive_sync record."""
    results = await repo_query(
        "SELECT * FROM drive_sync WHERE id = $id LIMIT 1",
        {"id": ensure_record_id(sync_id)},
    )
    if not results:
        raise ValueError(f"Drive sync '{sync_id}' not found")

    cred = await drive_service.get_credential()
    if not cred:
        raise ValueError("No Google Drive credential configured")

    await _sync_folder(results[0])
