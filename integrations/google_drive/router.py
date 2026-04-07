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

from open_notebook.database.repository import (
    ensure_record_id,
    repo_create,
    repo_delete,
    repo_query,
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
# Folder browsing
# ---------------------------------------------------------------------------


@router.get("/folders")
async def list_folders():
    """List Drive folders accessible to the connected user."""
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")
    folders = await drive_service.list_user_folders()
    return {"folders": folders}


@router.get("/folders/{folder_id}/files")
async def list_folder_files(folder_id: str):
    """List supported files in a specific Drive folder."""
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")
    files = await drive_service.list_folder_contents(folder_id)
    return {"files": files}


# ---------------------------------------------------------------------------
# Drive Sync CRUD
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

    record = await repo_create(
        "drive_sync",
        {
            "notebook_id": data.notebook_id,
            "folder_id": data.folder_id,
            "folder_name": data.folder_name,
            "poll_interval_minutes": data.poll_interval_minutes,
            "enabled": True,
        },
    )
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
