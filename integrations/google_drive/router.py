"""
FastAPI router for the Google Drive integration.
Registered in api/main.py only when GOOGLE_DRIVE_CLIENT_ID is set.
All endpoints are under /api/drive/.
"""
import os
import secrets
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from loguru import logger
from pydantic import BaseModel

from open_notebook.database.repository import (
    ensure_record_id,
    repo_create,
    repo_delete,
    repo_query,
    repo_relate,
    repo_upsert,
)

from integrations.google_drive import service as drive_service
from integrations.google_drive import sync_service
from integrations.google_drive.models import (
    DriveSyncCreate,
    DriveSyncResponse,
)

router = APIRouter(prefix="/drive", tags=["google-drive"])


# ---------------------------------------------------------------------------
# Status & OAuth
# ---------------------------------------------------------------------------


@router.get("/status")
async def get_drive_status():
    """Check if the Drive integration is configured and an account is connected."""
    configured = bool(os.environ.get("GOOGLE_DRIVE_CLIENT_ID"))
    cred = await drive_service.get_credential() if configured else None
    return {
        "configured": configured,
        "connected": cred is not None,
        "user_email": cred.get("user_email") if cred else None,
    }


@router.get("/auth/url")
async def get_auth_url():
    """Return the Google OAuth URL the frontend should redirect the user to."""
    state = secrets.token_urlsafe(16)
    url = drive_service.build_auth_url(state=state)
    return {"url": url, "state": state}


@router.get("/callback")
async def oauth_callback(code: str, state: Optional[str] = None):
    """
    Handle the OAuth redirect from Google.
    Exchanges the authorization code for tokens and redirects back to the frontend.
    """
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:8502")
    try:
        result = await drive_service.exchange_code_for_tokens(code, state=state)
        return RedirectResponse(
            url=(
                f"{frontend_url}/settings/integrations"
                f"?drive_connected=true&email={result['user_email']}"
            )
        )
    except Exception as e:
        logger.error(f"OAuth callback failed: {e}")
        return RedirectResponse(
            url=f"{frontend_url}/settings/integrations?drive_error=true"
        )


@router.delete("/disconnect")
async def disconnect_drive():
    """Remove the stored Drive credential and disable all sync configurations."""
    await drive_service.disconnect()
    return {"message": "Disconnected from Google Drive"}


# ---------------------------------------------------------------------------
# Google Picker support
# ---------------------------------------------------------------------------


@router.get("/picker-config")
async def get_picker_config():
    """
    Return everything the frontend needs to open the full Google Picker.
    The API key (GOOGLE_DRIVE_API_KEY) is required for the rich Picker UI;
    without it Google falls back to a degraded view with raw folder IDs.
    """
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")

    token = await drive_service.get_fresh_access_token()
    if not token:
        raise HTTPException(status_code=400, detail="Unable to obtain access token")

    client_id = os.environ["GOOGLE_DRIVE_CLIENT_ID"]
    app_id = client_id.split("-")[0] if "-" in client_id else ""
    api_key = os.environ.get("GOOGLE_DRIVE_API_KEY", "")
    origin = os.environ.get("FRONTEND_URL", "")

    return {
        "access_token": token,
        "api_key": api_key,
        "app_id": app_id,
        "origin": origin,
    }


# ---------------------------------------------------------------------------
# Import individual files (from Picker selection)
# ---------------------------------------------------------------------------


class ImportFilesRequest(BaseModel):
    notebook_id: str
    files: List[dict]  # [{id, name, mimeType}]


@router.post("/import-files")
async def import_files(data: ImportFilesRequest):
    """
    Import individual Drive files as sources in a notebook.
    Downloads each file and submits it to the standard source processing pipeline.
    """
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")

    import commands.source_commands  # noqa: F401
    from surreal_commands import submit_command
    from commands.source_commands import SourceProcessingInput

    notebook_rid = ensure_record_id(data.notebook_id)
    imported = []

    for file_info in data.files:
        try:
            file_path = await drive_service.download_file(
                file_id=file_info["id"],
                file_name=file_info["name"],
                mime_type=file_info["mimeType"],
            )

            source_result = await repo_create(
                "source",
                {
                    "title": file_info["name"],
                    "asset": {"file_path": file_path},
                    "drive_file_id": file_info["id"],
                    "drive_modified_time": file_info.get("modifiedTime", ""),
                },
            )
            source_record = source_result[0] if isinstance(source_result, list) else source_result
            source_id = source_record["id"]

            await repo_relate(
                ensure_record_id(source_id),
                "reference",
                notebook_rid,
            )

            command_input = SourceProcessingInput(
                source_id=str(source_id),
                content_state={"file_path": file_path, "delete_source": True},
                notebook_ids=[data.notebook_id],
                transformations=[],
                embed=True,
            )
            submit_command("open_notebook", "process_source", command_input.model_dump())
            imported.append({"file_name": file_info["name"], "source_id": source_id})
            logger.info(f"Imported Drive file '{file_info['name']}' → source {source_id}")

        except Exception as e:
            logger.error(f"Failed to import Drive file {file_info.get('id')}: {e}")
            imported.append({"file_name": file_info.get("name", "?"), "error": str(e)})

    return {"imported": imported}


# ---------------------------------------------------------------------------
# Drive Sync CRUD (folder-level polling)
# ---------------------------------------------------------------------------


@router.post("/sync", response_model=DriveSyncResponse)
async def create_sync(data: DriveSyncCreate):
    """Register a Drive folder for automatic sync to a notebook."""
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")

    existing = await repo_query(
        "SELECT * FROM drive_sync WHERE folder_id = $fid AND notebook_id = $nid LIMIT 1",
        {"fid": data.folder_id, "nid": data.notebook_id},
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="This folder is already synced to this notebook",
        )

    result = await repo_create(
        "drive_sync",
        {
            "notebook_id": data.notebook_id,
            "folder_id": data.folder_id,
            "folder_name": data.folder_name,
            "poll_interval_minutes": data.poll_interval_minutes,
            "enabled": True,
        },
    )
    record = result[0] if isinstance(result, list) else result
    return DriveSyncResponse(**record)


@router.get("/sync", response_model=List[DriveSyncResponse])
async def list_syncs(notebook_id: Optional[str] = Query(None)):
    """List all Drive sync configurations, optionally filtered by notebook."""
    if notebook_id:
        results = await repo_query(
            "SELECT * FROM drive_sync WHERE notebook_id = $nid",
            {"nid": notebook_id},
        )
    else:
        results = await repo_query("SELECT * FROM drive_sync")
    return [DriveSyncResponse(**r) for r in results]


@router.delete("/sync/{sync_id}")
async def delete_sync(sync_id: str):
    """Remove a Drive sync configuration."""
    await repo_delete(ensure_record_id(sync_id))
    return {"message": "Sync configuration removed"}


@router.post("/sync/{sync_id}/trigger")
async def trigger_sync(sync_id: str):
    """Manually trigger a sync for a specific folder (does not wait for result)."""
    try:
        await sync_service.force_sync(sync_id)
        return {"message": "Sync completed successfully"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Manual sync trigger failed for {sync_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")
