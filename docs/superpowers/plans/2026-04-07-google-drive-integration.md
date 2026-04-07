# Google Drive Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully isolated Google Drive integration to Open Notebook that polls watched folders and auto-indexes changed files as Sources, with minimal coupling to the core codebase.

**Architecture:** The integration lives in `integrations/google_drive/` (backend) and `frontend/src/integrations/google-drive/` (frontend), completely separated from core code. The only core touches are 4 conditional lines in `api/main.py` (guarded by `GOOGLE_DRIVE_CLIENT_ID` env var), and 2 optional deps in `pyproject.toml`. The Drive module manages its own SurrealDB schema via `DEFINE TABLE IF NOT EXISTS` at startup (no change to `async_migrate.py`).

**Tech Stack:** `google-auth-oauthlib`, `google-api-python-client`, `apscheduler`, FastAPI Router, SurrealDB FLEXIBLE asset field (existing), Next.js + TanStack Query + Shadcn/ui.

---

## File Map

### New files (backend)
| File | Responsibility |
|------|---------------|
| `integrations/__init__.py` | Package marker |
| `integrations/google_drive/__init__.py` | Exports `router`, `startup_hook` |
| `integrations/google_drive/models.py` | Pydantic schemas for Drive API |
| `integrations/google_drive/schema.py` | SurrealDB schema init (`DEFINE TABLE IF NOT EXISTS`) |
| `integrations/google_drive/service.py` | OAuth flow, Drive API calls, file download |
| `integrations/google_drive/sync_service.py` | Polling logic: compare modifiedTime, trigger source pipeline |
| `integrations/google_drive/scheduler.py` | APScheduler setup, registers polling job |
| `integrations/google_drive/router.py` | FastAPI router: `/api/drive/*` endpoints |

### New files (frontend)
| File | Responsibility |
|------|---------------|
| `frontend/src/integrations/google-drive/lib/api.ts` | All Drive API calls |
| `frontend/src/integrations/google-drive/components/DriveConnectCard.tsx` | OAuth connect/disconnect UI |
| `frontend/src/integrations/google-drive/components/DriveFolderSelector.tsx` | Browse & pick Drive folders |
| `frontend/src/integrations/google-drive/components/DriveSyncList.tsx` | List synced folders for a notebook |
| `frontend/src/integrations/google-drive/components/DriveSyncBadge.tsx` | Badge on Source cards showing Drive status |
| `frontend/src/app/(dashboard)/settings/integrations/page.tsx` | New "Integrations" settings page |

### Modified files (minimal core touches)
| File | Change |
|------|--------|
| `api/main.py` | +4 lines: conditional import + router + scheduler start |
| `pyproject.toml` | +optional deps group `google-drive` |

---

## Task 1: Repository & Dependencies Setup

**Files:**
- Create: `integrations/__init__.py`
- Create: `integrations/google_drive/__init__.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Create branch (already done)**

```bash
git branch  # Should show feature/google-drive-integration
```

- [ ] **Step 2: Create package structure**

```bash
mkdir -p integrations/google_drive
touch integrations/__init__.py
touch integrations/google_drive/__init__.py
```

- [ ] **Step 3: Add optional dependencies to `pyproject.toml`**

Add after the `[project.optional-dependencies]` `dev` section:

```toml
[project.optional-dependencies]
dev = [
    # ... existing dev deps unchanged
]
google-drive = [
    "google-auth>=2.0.0",
    "google-auth-oauthlib>=1.0.0",
    "google-api-python-client>=2.0.0",
    "apscheduler>=3.10.0",
]
```

- [ ] **Step 4: Install the new optional deps**

```bash
uv add --optional google-drive google-auth google-auth-oauthlib google-api-python-client apscheduler
```

Expected: packages installed, `uv.lock` updated.

- [ ] **Step 5: Commit**

```bash
git add integrations/ pyproject.toml uv.lock
git commit -m "feat(drive): add package structure and optional dependencies"
```

---

## Task 2: Pydantic Models

**Files:**
- Create: `integrations/google_drive/models.py`

- [ ] **Step 1: Write models**

```python
# integrations/google_drive/models.py
from typing import Optional, List
from pydantic import BaseModel


class DriveCredentialResponse(BaseModel):
    id: str
    user_email: str
    connected_at: Optional[str] = None


class DriveSyncCreate(BaseModel):
    notebook_id: str
    folder_id: str
    folder_name: str
    poll_interval_minutes: int = 15


class DriveSyncResponse(BaseModel):
    id: str
    notebook_id: str
    folder_id: str
    folder_name: str
    poll_interval_minutes: int
    last_sync_at: Optional[str] = None
    enabled: bool = True
    created: Optional[str] = None


class DriveFile(BaseModel):
    id: str
    name: str
    mimeType: str
    modifiedTime: str
    size: Optional[str] = None


class DriveFolderListResponse(BaseModel):
    files: List[DriveFile]
    nextPageToken: Optional[str] = None


class DriveSyncStatusResponse(BaseModel):
    sync_id: str
    status: str  # "ok" | "running" | "error"
    last_sync_at: Optional[str] = None
    files_count: int = 0
    message: Optional[str] = None
```

- [ ] **Step 2: Commit**

```bash
git add integrations/google_drive/models.py
git commit -m "feat(drive): add Pydantic models for Drive API"
```

---

## Task 3: SurrealDB Schema (isolated, no migration system touch)

**Files:**
- Create: `integrations/google_drive/schema.py`

This module registers its own tables at startup via `DEFINE TABLE IF NOT EXISTS` — completely independent from `open_notebook/database/async_migrate.py`.

- [ ] **Step 1: Write schema initializer**

```python
# integrations/google_drive/schema.py
"""
Drive integration schema initialization.
Uses DEFINE TABLE IF NOT EXISTS — no touch to the core migration system.
Called at API startup via the Drive module startup hook.
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
"""


async def init_drive_schema() -> None:
    """Initialize Drive integration tables. Safe to call multiple times."""
    try:
        async with db_connection() as conn:
            await conn.query(DRIVE_SCHEMA_SQL)
        logger.success("Google Drive schema initialized")
    except Exception as e:
        logger.error(f"Failed to initialize Google Drive schema: {e}")
        raise
```

- [ ] **Step 2: Commit**

```bash
git add integrations/google_drive/schema.py
git commit -m "feat(drive): add isolated SurrealDB schema initialization"
```

---

## Task 4: Google OAuth & Drive API Service

**Files:**
- Create: `integrations/google_drive/service.py`

- [ ] **Step 1: Write the service**

```python
# integrations/google_drive/service.py
"""
Google Drive OAuth flow and API operations.
All Google-specific logic lives here.
"""
import os
import tempfile
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from loguru import logger

from open_notebook.database.repository import repo_create, repo_query, repo_upsert, repo_delete

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/html",
    "text/markdown",
    "application/vnd.google-apps.document",       # Google Docs → export as docx
    "application/vnd.google-apps.presentation",   # Google Slides → export as pptx
    "application/vnd.google-apps.spreadsheet",    # Google Sheets → export as xlsx
}

GOOGLE_EXPORT_MAP = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
}


def _get_client_config() -> Dict[str, Any]:
    return {
        "web": {
            "client_id": os.environ["GOOGLE_DRIVE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_DRIVE_CLIENT_SECRET"],
            "redirect_uris": [os.environ.get("GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback")],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }


def build_auth_url(state: str) -> str:
    flow = Flow.from_client_config(_get_client_config(), scopes=SCOPES)
    flow.redirect_uri = os.environ.get("GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback")
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=state,
        prompt="consent",
    )
    return auth_url


async def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    """Exchange OAuth code for tokens and save to DB. Returns user_email."""
    flow = Flow.from_client_config(_get_client_config(), scopes=SCOPES)
    flow.redirect_uri = os.environ.get("GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback")
    flow.fetch_token(code=code)

    creds = flow.credentials
    service = build("oauth2", "v2", credentials=creds)
    user_info = service.userinfo().get().execute()
    user_email = user_info["email"]

    # Upsert credential (one record per user email)
    existing = await repo_query(
        "SELECT * FROM drive_credential WHERE user_email = $email LIMIT 1",
        {"email": user_email},
    )
    token_data = {
        "user_email": user_email,
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "expires_at": creds.expiry.isoformat() if creds.expiry else None,
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    if existing:
        await repo_upsert("drive_credential", existing[0]["id"], token_data)
    else:
        await repo_create("drive_credential", token_data)

    return {"user_email": user_email}


async def get_credential() -> Optional[Dict[str, Any]]:
    """Get the stored Drive credential (first one found)."""
    results = await repo_query("SELECT * FROM drive_credential LIMIT 1")
    return results[0] if results else None


async def disconnect() -> None:
    """Remove stored Drive credential and disable all syncs."""
    await repo_query("DELETE drive_credential")
    await repo_query("UPDATE drive_sync SET enabled = false")


def _build_drive_service(cred_data: Dict[str, Any]):
    """Build authenticated Drive service, refreshing token if needed."""
    creds = Credentials(
        token=cred_data["access_token"],
        refresh_token=cred_data.get("refresh_token"),
        client_id=os.environ["GOOGLE_DRIVE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_DRIVE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Persist refreshed token
        import asyncio
        asyncio.create_task(
            repo_upsert("drive_credential", cred_data["id"], {
                "access_token": creds.token,
                "expires_at": creds.expiry.isoformat() if creds.expiry else None,
            })
        )
    return build("drive", "v3", credentials=creds)


async def list_folder_contents(folder_id: str) -> List[Dict[str, Any]]:
    """List files in a Drive folder (non-recursive, supported types only)."""
    cred_data = await get_credential()
    if not cred_data:
        raise ValueError("No Google Drive credential found")

    service = _build_drive_service(cred_data)
    mime_filter = " or ".join(
        f"mimeType='{m}'" for m in SUPPORTED_MIME_TYPES
    )
    query = f"'{folder_id}' in parents and trashed=false and ({mime_filter})"

    result = service.files().list(
        q=query,
        fields="files(id,name,mimeType,modifiedTime,size)",
        pageSize=100,
    ).execute()
    return result.get("files", [])


async def list_user_folders() -> List[Dict[str, Any]]:
    """List top-level Drive folders accessible to the user."""
    cred_data = await get_credential()
    if not cred_data:
        raise ValueError("No Google Drive credential found")

    service = _build_drive_service(cred_data)
    result = service.files().list(
        q="mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields="files(id,name,modifiedTime)",
        pageSize=50,
        orderBy="name",
    ).execute()
    return result.get("files", [])


async def download_file(file_id: str, file_name: str, mime_type: str) -> str:
    """
    Download a Drive file to a temp path and return the path.
    Caller is responsible for cleanup.
    """
    cred_data = await get_credential()
    if not cred_data:
        raise ValueError("No Google Drive credential found")

    service = _build_drive_service(cred_data)

    suffix = os.path.splitext(file_name)[1] or ".bin"

    if mime_type in GOOGLE_EXPORT_MAP:
        export_mime, export_ext = GOOGLE_EXPORT_MAP[mime_type]
        suffix = export_ext
        request = service.files().export_media(fileId=file_id, mimeType=export_mime)
    else:
        request = service.files().get_media(fileId=file_id)

    uploads_dir = os.environ.get("UPLOADS_FOLDER", "/data/uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, dir=uploads_dir, prefix=f"drive_{file_id}_"
    )
    downloader = MediaIoBaseDownload(tmp, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    tmp.close()
    return tmp.name
```

- [ ] **Step 2: Commit**

```bash
git add integrations/google_drive/service.py
git commit -m "feat(drive): add OAuth flow and Drive API service"
```

---

## Task 5: Sync Service (Polling Logic)

**Files:**
- Create: `integrations/google_drive/sync_service.py`

This service contains the polling logic. It calls the Drive API, compares `modifiedTime`, and triggers the existing source ingestion pipeline.

- [ ] **Step 1: Write the sync service**

```python
# integrations/google_drive/sync_service.py
"""
Polling-based sync: checks Drive folders for changes and triggers source indexing.
Uses the existing Source domain model and source pipeline — no duplication.
"""
import os
from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from open_notebook.database.repository import repo_query, repo_upsert, repo_create
from open_notebook.domain.notebook import Source
from integrations.google_drive import service as drive_service


async def sync_all() -> None:
    """
    Main polling entry point. Called by the scheduler every N minutes.
    Iterates all enabled drive_sync records and syncs each one.
    """
    if not os.environ.get("GOOGLE_DRIVE_CLIENT_ID"):
        return

    cred = await drive_service.get_credential()
    if not cred:
        logger.debug("Drive sync skipped: no credential configured")
        return

    syncs = await repo_query("SELECT * FROM drive_sync WHERE enabled = true")
    for sync in syncs:
        try:
            await _sync_folder(sync, cred)
        except Exception as e:
            logger.error(f"Drive sync failed for folder {sync.get('folder_id')}: {e}")


async def _sync_folder(sync: dict, cred: dict) -> None:
    """Sync a single drive_sync record."""
    sync_id = sync["id"]
    folder_id = sync["folder_id"]
    notebook_id = sync["notebook_id"]

    logger.info(f"Syncing Drive folder {folder_id} → notebook {notebook_id}")

    files = await drive_service.list_folder_contents(folder_id)

    for file in files:
        try:
            await _process_file(file, notebook_id, sync_id)
        except Exception as e:
            logger.error(f"Failed to process Drive file {file.get('id')}: {e}")

    # Update last_sync_at
    await repo_upsert("drive_sync", sync_id, {
        "last_sync_at": datetime.now(timezone.utc).isoformat()
    })


async def _process_file(file: dict, notebook_id: str, sync_id: str) -> None:
    """
    Create or update a Source for a Drive file.
    Skips if the file hasn't changed since last indexed.
    """
    drive_file_id = file["id"]
    drive_modified_time = file["modifiedTime"]

    # Check if source already exists for this drive_file_id
    existing = await repo_query(
        "SELECT * FROM source WHERE asset.drive_file_id = $fid LIMIT 1",
        {"fid": drive_file_id},
    )

    if existing:
        source_data = existing[0]
        existing_modified = source_data.get("asset", {}).get("drive_modified_time")
        if existing_modified == drive_modified_time:
            logger.debug(f"Drive file {drive_file_id} unchanged, skipping")
            return
        logger.info(f"Drive file {drive_file_id} changed, re-indexing")
        # Update the existing source by re-triggering the pipeline
        source = Source(**source_data)
        file_path = await _download_and_get_path(file)
        await _trigger_source_pipeline(source.id, file_path, notebook_id, drive_file_id, drive_modified_time, update=True)
    else:
        logger.info(f"New Drive file {drive_file_id}, creating source")
        file_path = await _download_and_get_path(file)
        await _trigger_source_pipeline(None, file_path, notebook_id, drive_file_id, drive_modified_time, update=False)


async def _download_and_get_path(file: dict) -> str:
    return await drive_service.download_file(
        file_id=file["id"],
        file_name=file["name"],
        mime_type=file["mimeType"],
    )


async def _trigger_source_pipeline(
    source_id: Optional[str],
    file_path: str,
    notebook_id: str,
    drive_file_id: str,
    drive_modified_time: str,
    update: bool,
) -> None:
    """
    Trigger the existing source ingestion pipeline.
    Reuses the commands layer to avoid duplicating pipeline logic.
    """
    from open_notebook.domain.notebook import Source, Asset
    from open_notebook.database.repository import ensure_record_id
    from surreal_commands import submit_command

    if update and source_id:
        # Update asset metadata to reflect the new file
        source = await Source.get(source_id)
        asset = source.asset or Asset()
        asset.file_path = file_path
        asset_dict = asset.model_dump() if hasattr(asset, "model_dump") else {}
        asset_dict["drive_file_id"] = drive_file_id
        asset_dict["drive_modified_time"] = drive_modified_time
        await repo_upsert("source", source_id, {"asset": asset_dict})
        await submit_command("process_source", {"source_id": source_id, "file_path": file_path, "embed": True})
    else:
        # Create new source then trigger pipeline
        asset_data = {
            "file_path": file_path,
            "drive_file_id": drive_file_id,
            "drive_modified_time": drive_modified_time,
        }
        new_source = Source(
            title=f"[Drive] {drive_file_id}",
            asset=asset_data,
        )
        await new_source.save()
        # Link to notebook
        from open_notebook.database.repository import repo_relate, ensure_record_id
        await repo_relate(
            ensure_record_id(new_source.id),
            "reference",
            ensure_record_id(notebook_id),
        )
        await submit_command("process_source", {"source_id": new_source.id, "file_path": file_path, "embed": True})


async def force_sync(sync_id: str) -> None:
    """Manually trigger sync for a specific drive_sync record."""
    results = await repo_query(
        "SELECT * FROM drive_sync WHERE id = $id LIMIT 1",
        {"id": sync_id},
    )
    if not results:
        raise ValueError(f"Drive sync {sync_id} not found")
    cred = await drive_service.get_credential()
    if not cred:
        raise ValueError("No Google Drive credential configured")
    await _sync_folder(results[0], cred)
```

- [ ] **Step 2: Commit**

```bash
git add integrations/google_drive/sync_service.py
git commit -m "feat(drive): add polling sync service"
```

---

## Task 6: APScheduler Setup

**Files:**
- Create: `integrations/google_drive/scheduler.py`

- [ ] **Step 1: Write the scheduler**

```python
# integrations/google_drive/scheduler.py
"""
APScheduler setup for Drive polling.
Registered in api/main.py lifespan when GOOGLE_DRIVE_CLIENT_ID is set.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger

from integrations.google_drive.sync_service import sync_all

_scheduler: AsyncIOScheduler | None = None


def start_drive_scheduler(interval_minutes: int = 15) -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        sync_all,
        trigger="interval",
        minutes=interval_minutes,
        id="drive_sync_poll",
        replace_existing=True,
        misfire_grace_time=300,
    )
    _scheduler.start()
    logger.success(f"Drive sync scheduler started (every {interval_minutes} min)")


def stop_drive_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Drive sync scheduler stopped")
```

- [ ] **Step 2: Commit**

```bash
git add integrations/google_drive/scheduler.py
git commit -m "feat(drive): add APScheduler for polling"
```

---

## Task 7: FastAPI Router

**Files:**
- Create: `integrations/google_drive/router.py`

- [ ] **Step 1: Write the router**

```python
# integrations/google_drive/router.py
import os
import secrets
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from loguru import logger

from integrations.google_drive import service as drive_service
from integrations.google_drive import sync_service
from integrations.google_drive.models import (
    DriveSyncCreate,
    DriveSyncResponse,
    DriveCredentialResponse,
    DriveSyncStatusResponse,
)
from open_notebook.database.repository import repo_create, repo_query, repo_upsert, repo_delete, ensure_record_id

router = APIRouter(prefix="/drive", tags=["google-drive"])


@router.get("/status")
async def get_drive_status():
    """Check if Drive integration is configured and connected."""
    configured = bool(os.environ.get("GOOGLE_DRIVE_CLIENT_ID"))
    cred = await drive_service.get_credential() if configured else None
    return {
        "configured": configured,
        "connected": cred is not None,
        "user_email": cred.get("user_email") if cred else None,
    }


@router.get("/auth/url")
async def get_auth_url():
    """Get the Google OAuth authorization URL."""
    state = secrets.token_urlsafe(16)
    url = drive_service.build_auth_url(state=state)
    return {"url": url, "state": state}


@router.get("/callback")
async def oauth_callback(code: str, state: Optional[str] = None):
    """Handle OAuth callback from Google. Redirects to frontend settings page."""
    try:
        result = await drive_service.exchange_code_for_tokens(code)
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(
            url=f"{frontend_url}/settings/integrations?drive_connected=true&email={result['user_email']}"
        )
    except Exception as e:
        logger.error(f"OAuth callback failed: {e}")
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(
            url=f"{frontend_url}/settings/integrations?drive_error=true"
        )


@router.delete("/disconnect")
async def disconnect_drive():
    """Remove stored Drive credential and disable all syncs."""
    await drive_service.disconnect()
    return {"message": "Disconnected from Google Drive"}


@router.get("/folders")
async def list_folders():
    """List accessible Drive folders for the connected user."""
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")
    folders = await drive_service.list_user_folders()
    return {"folders": folders}


@router.get("/folders/{folder_id}/files")
async def list_folder_files(folder_id: str):
    """List supported files in a Drive folder."""
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")
    files = await drive_service.list_folder_contents(folder_id)
    return {"files": files}


# --- Drive Sync CRUD ---

@router.post("/sync", response_model=DriveSyncResponse)
async def create_sync(data: DriveSyncCreate):
    """Register a Drive folder for automatic sync with a notebook."""
    cred = await drive_service.get_credential()
    if not cred:
        raise HTTPException(status_code=400, detail="Not connected to Google Drive")

    # Prevent duplicate syncs for same folder+notebook
    existing = await repo_query(
        "SELECT * FROM drive_sync WHERE folder_id = $fid AND notebook_id = $nid LIMIT 1",
        {"fid": data.folder_id, "nid": data.notebook_id},
    )
    if existing:
        raise HTTPException(status_code=409, detail="This folder is already synced to this notebook")

    record = await repo_create("drive_sync", {
        "notebook_id": data.notebook_id,
        "folder_id": data.folder_id,
        "folder_name": data.folder_name,
        "poll_interval_minutes": data.poll_interval_minutes,
        "enabled": True,
    })
    return DriveSyncResponse(**record)


@router.get("/sync", response_model=List[DriveSyncResponse])
async def list_syncs(notebook_id: Optional[str] = Query(None)):
    """List all drive sync configurations, optionally filtered by notebook."""
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
    """Remove a drive sync configuration."""
    await repo_delete(ensure_record_id(sync_id))
    return {"message": "Sync configuration removed"}


@router.post("/sync/{sync_id}/trigger")
async def trigger_sync(sync_id: str):
    """Manually trigger a sync for a specific folder."""
    try:
        await sync_service.force_sync(sync_id)
        return {"message": "Sync triggered successfully"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Manual sync trigger failed: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")
```

- [ ] **Step 2: Write `integrations/google_drive/__init__.py`**

```python
# integrations/google_drive/__init__.py
from integrations.google_drive.router import router
from integrations.google_drive.schema import init_drive_schema
from integrations.google_drive.scheduler import start_drive_scheduler, stop_drive_scheduler

__all__ = ["router", "init_drive_schema", "start_drive_scheduler", "stop_drive_scheduler"]
```

- [ ] **Step 3: Commit**

```bash
git add integrations/google_drive/router.py integrations/google_drive/__init__.py
git commit -m "feat(drive): add FastAPI router with OAuth + sync CRUD endpoints"
```

---

## Task 8: Hook into api/main.py (Core Touch — Minimal)

**Files:**
- Modify: `api/main.py` (+4 lines conditional on env var, isolated in their own block)

- [ ] **Step 1: Add Drive startup/shutdown in lifespan**

Find the `lifespan` function in `api/main.py`. After the existing podcast migration block and before `logger.success("API initialization completed successfully")`, add:

```python
    # Google Drive integration (optional — only if GOOGLE_DRIVE_CLIENT_ID is set)
    if os.environ.get("GOOGLE_DRIVE_CLIENT_ID"):
        try:
            from integrations.google_drive import init_drive_schema, start_drive_scheduler
            await init_drive_schema()
            start_drive_scheduler()
            logger.success("Google Drive integration started")
        except Exception as e:
            logger.warning(f"Google Drive integration failed to start: {e}")
```

And in the shutdown section (after `yield`), add:

```python
    if os.environ.get("GOOGLE_DRIVE_CLIENT_ID"):
        try:
            from integrations.google_drive import stop_drive_scheduler
            stop_drive_scheduler()
        except Exception:
            pass
```

- [ ] **Step 2: Register the router**

At the end of `api/main.py`, after all existing `app.include_router(...)` calls, add:

```python
# Google Drive integration (optional)
if os.environ.get("GOOGLE_DRIVE_CLIENT_ID"):
    try:
        from integrations.google_drive import router as drive_router
        app.include_router(drive_router, prefix="/api", tags=["google-drive"])
        logger.info("Google Drive router registered")
    except ImportError as e:
        logger.warning(f"Google Drive integration not available: {e}")
```

Note: `import os` is already in the lifespan function; add `import os` at the top of `main.py` if not already there.

- [ ] **Step 3: Verify no other core files touched**

```bash
git diff --name-only HEAD
# Should only show: api/main.py
```

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat(drive): hook Drive integration into API lifespan (conditional on env var)"
```

---

## Task 9: Frontend — Drive API Client

**Files:**
- Create: `frontend/src/integrations/google-drive/lib/api.ts`

- [ ] **Step 1: Create directory and API client**

```bash
mkdir -p frontend/src/integrations/google-drive/lib
mkdir -p frontend/src/integrations/google-drive/components
```

```typescript
// frontend/src/integrations/google-drive/lib/api.ts
import apiClient from '@/lib/api/client'

export interface DriveStatus {
  configured: boolean
  connected: boolean
  user_email: string | null
}

export interface DriveFolder {
  id: string
  name: string
  modifiedTime: string
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
}

export interface DriveSyncConfig {
  id: string
  notebook_id: string
  folder_id: string
  folder_name: string
  poll_interval_minutes: number
  last_sync_at: string | null
  enabled: boolean
  created: string | null
}

export interface CreateDriveSyncRequest {
  notebook_id: string
  folder_id: string
  folder_name: string
  poll_interval_minutes?: number
}

export const driveApi = {
  getStatus: async (): Promise<DriveStatus> => {
    const res = await apiClient.get('/drive/status')
    return res.data
  },

  getAuthUrl: async (): Promise<{ url: string; state: string }> => {
    const res = await apiClient.get('/drive/auth/url')
    return res.data
  },

  disconnect: async (): Promise<void> => {
    await apiClient.delete('/drive/disconnect')
  },

  listFolders: async (): Promise<{ folders: DriveFolder[] }> => {
    const res = await apiClient.get('/drive/folders')
    return res.data
  },

  listFolderFiles: async (folderId: string): Promise<{ files: DriveFile[] }> => {
    const res = await apiClient.get(`/drive/folders/${folderId}/files`)
    return res.data
  },

  listSyncs: async (notebookId?: string): Promise<DriveSyncConfig[]> => {
    const params = notebookId ? { notebook_id: notebookId } : {}
    const res = await apiClient.get('/drive/sync', { params })
    return res.data
  },

  createSync: async (data: CreateDriveSyncRequest): Promise<DriveSyncConfig> => {
    const res = await apiClient.post('/drive/sync', data)
    return res.data
  },

  deleteSync: async (syncId: string): Promise<void> => {
    await apiClient.delete(`/drive/sync/${syncId}`)
  },

  triggerSync: async (syncId: string): Promise<void> => {
    await apiClient.post(`/drive/sync/${syncId}/trigger`)
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/integrations/
git commit -m "feat(drive): add frontend Drive API client"
```

---

## Task 10: Frontend — Drive Connect Card (Settings UI)

**Files:**
- Create: `frontend/src/integrations/google-drive/components/DriveConnectCard.tsx`
- Create: `frontend/src/app/(dashboard)/settings/integrations/page.tsx`

- [ ] **Step 1: Write the connect card**

```tsx
// frontend/src/integrations/google-drive/components/DriveConnectCard.tsx
'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { HardDrive, ExternalLink, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { driveApi } from '../lib/api'

export function DriveConnectCard() {
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['drive-status'],
    queryFn: driveApi.getStatus,
    retry: false,
  })

  const disconnectMutation = useMutation({
    mutationFn: driveApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-status'] })
      queryClient.invalidateQueries({ queryKey: ['drive-syncs'] })
      toast.success('Disconnected from Google Drive')
    },
    onError: () => toast.error('Failed to disconnect'),
  })

  const handleConnect = async () => {
    try {
      const { url } = await driveApi.getAuthUrl()
      window.location.href = url
    } catch {
      toast.error('Failed to start Google Drive authorization')
    }
  }

  if (isLoading) return <LoadingSpinner />

  if (!status?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Google Drive
          </CardTitle>
          <CardDescription>
            Set <code>GOOGLE_DRIVE_CLIENT_ID</code> and <code>GOOGLE_DRIVE_CLIENT_SECRET</code> environment variables to enable this integration.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Google Drive
          </CardTitle>
          <Badge variant={status.connected ? 'default' : 'secondary'}>
            {status.connected ? 'Connected' : 'Not connected'}
          </Badge>
        </div>
        <CardDescription>
          {status.connected
            ? `Connected as ${status.user_email}. Watched folders will be automatically re-indexed when files change.`
            : 'Connect your Google Drive account to automatically sync folders as sources.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status.connected ? (
          <Button
            variant="outline"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            <Unplug className="h-4 w-4 mr-2" />
            Disconnect
          </Button>
        ) : (
          <Button onClick={handleConnect}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Connect Google Drive
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write the Integrations settings page**

```tsx
// frontend/src/app/(dashboard)/settings/integrations/page.tsx
'use client'

import { AppShell } from '@/components/layout/AppShell'
import { DriveConnectCard } from '@/integrations/google-drive/components/DriveConnectCard'

export default function IntegrationsPage() {
  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-6">Integrations</h1>
            <div className="space-y-4">
              <DriveConnectCard />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/integrations/google-drive/components/DriveConnectCard.tsx \
        frontend/src/app/(dashboard)/settings/integrations/page.tsx
git commit -m "feat(drive): add Drive connect card and integrations settings page"
```

---

## Task 11: Frontend — DriveSyncList (per-notebook folder management)

**Files:**
- Create: `frontend/src/integrations/google-drive/components/DriveSyncList.tsx`

This component is placed inside the notebook view (Sources column), allowing users to add/remove Drive folder syncs for a specific notebook.

- [ ] **Step 1: Write the DriveSyncList component**

```tsx
// frontend/src/integrations/google-drive/components/DriveSyncList.tsx
'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { FolderSync, Plus, Trash2, RefreshCw, HardDrive } from 'lucide-react'
import { toast } from 'sonner'
import { driveApi, DriveFolder } from '../lib/api'

interface DriveSyncListProps {
  notebookId: string
}

export function DriveSyncList({ notebookId }: DriveSyncListProps) {
  const queryClient = useQueryClient()
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)

  const { data: status } = useQuery({
    queryKey: ['drive-status'],
    queryFn: driveApi.getStatus,
    retry: false,
  })

  const { data: syncs, isLoading: syncsLoading } = useQuery({
    queryKey: ['drive-syncs', notebookId],
    queryFn: () => driveApi.listSyncs(notebookId),
    enabled: status?.connected === true,
  })

  const { data: foldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['drive-folders'],
    queryFn: driveApi.listFolders,
    enabled: folderDialogOpen && status?.connected === true,
  })

  const addSyncMutation = useMutation({
    mutationFn: (folder: DriveFolder) =>
      driveApi.createSync({
        notebook_id: notebookId,
        folder_id: folder.id,
        folder_name: folder.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-syncs', notebookId] })
      setFolderDialogOpen(false)
      toast.success('Folder sync added. First sync will run within 15 minutes.')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || 'Failed to add folder sync'),
  })

  const deleteSyncMutation = useMutation({
    mutationFn: driveApi.deleteSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-syncs', notebookId] })
      toast.success('Folder sync removed')
    },
  })

  const triggerSyncMutation = useMutation({
    mutationFn: driveApi.triggerSync,
    onSuccess: () => toast.success('Sync triggered'),
    onError: () => toast.error('Sync failed'),
  })

  if (!status?.configured || !status?.connected) return null

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium flex items-center gap-1 text-muted-foreground">
          <HardDrive className="h-4 w-4" />
          Drive Syncs
        </h3>
        <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Drive Folder Sync</DialogTitle>
            </DialogHeader>
            {foldersLoading ? (
              <LoadingSpinner />
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {foldersData?.folders.map((folder) => (
                  <Button
                    key={folder.id}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => addSyncMutation.mutate(folder)}
                    disabled={addSyncMutation.isPending}
                  >
                    <FolderSync className="h-4 w-4 mr-2" />
                    {folder.name}
                  </Button>
                ))}
                {!foldersData?.folders.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">No folders found</p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {syncsLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-2">
          {syncs?.map((sync) => (
            <Card key={sync.id} className="p-0">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{sync.folder_name}</p>
                    {sync.last_sync_at && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {new Date(sync.last_sync_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => triggerSyncMutation.mutate(sync.id)}
                      disabled={triggerSyncMutation.isPending}
                      title="Force sync now"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteSyncMutation.mutate(sync.id)}
                      title="Remove sync"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {syncs?.length === 0 && (
            <p className="text-xs text-muted-foreground">No Drive folders synced to this notebook.</p>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/integrations/google-drive/components/DriveSyncList.tsx
git commit -m "feat(drive): add DriveSyncList component for per-notebook folder management"
```

---

## Task 12: Add Navigation Link + Handle OAuth Callback Params

**Files:**
- Modify: `frontend/src/components/layout/AppSidebar.tsx` (add "Integrations" link)
- Modify: `frontend/src/app/(dashboard)/settings/integrations/page.tsx` (handle `?drive_connected=true`)

- [ ] **Step 1: Add Integrations link in sidebar**

In `AppSidebar.tsx`, find the settings navigation section and add a link to `/settings/integrations`. Look for existing settings nav items and follow the same pattern. Do NOT restructure the file — just add one nav entry following the existing pattern.

- [ ] **Step 2: Handle OAuth callback query params in the integrations page**

Update `frontend/src/app/(dashboard)/settings/integrations/page.tsx` to read `?drive_connected=true` and show a success toast:

```tsx
'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { DriveConnectCard } from '@/integrations/google-drive/components/DriveConnectCard'
import { toast } from 'sonner'

export default function IntegrationsPage() {
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get('drive_connected') === 'true') {
      const email = searchParams.get('email')
      toast.success(`Connected to Google Drive${email ? ` as ${email}` : ''}`)
    }
    if (searchParams.get('drive_error') === 'true') {
      toast.error('Failed to connect Google Drive. Please try again.')
    }
  }, [searchParams])

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-6">Integrations</h1>
            <div className="space-y-4">
              <DriveConnectCard />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/AppSidebar.tsx \
        frontend/src/app/(dashboard)/settings/integrations/page.tsx
git commit -m "feat(drive): add sidebar nav link and handle OAuth callback params"
```

---

## Task 13: Environment Variables Documentation

**Files:**
- Create: `integrations/google_drive/README.md`

- [ ] **Step 1: Write documentation**

```markdown
# Google Drive Integration

Polls watched Google Drive folders and automatically indexes new/changed files as Sources in Open Notebook notebooks.

## Setup

### 1. Create Google Cloud OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `http://your-server:5055/api/drive/callback`
7. Copy **Client ID** and **Client Secret**

### 2. Set Environment Variables

Add to your `.env` file:

```env
GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=your-client-secret
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5055/api/drive/callback
FRONTEND_URL=http://localhost:3000
```

If `GOOGLE_DRIVE_CLIENT_ID` is not set, the integration is completely disabled with zero impact.

### 3. Connect Account

- Go to **Settings → Integrations** in Open Notebook
- Click **Connect Google Drive** and complete the OAuth flow

### 4. Add Folder Syncs

- Open a Notebook
- In the Sources panel, find **Drive Syncs**
- Click **+** to add a Drive folder
- The folder will be polled every 15 minutes

## Supported File Types

- PDF, DOCX, PPTX, XLSX, TXT, MD, HTML
- Google Docs, Google Slides, Google Sheets (exported automatically)

## Architecture

This integration is fully isolated:
- Backend: `integrations/google_drive/` — no changes to `open_notebook/` core
- Frontend: `frontend/src/integrations/google-drive/` — no changes to core components  
- DB: Creates own tables (`drive_credential`, `drive_sync`) at startup via `DEFINE TABLE IF NOT EXISTS`
- Core touch: 4 conditional lines in `api/main.py` only

## Polling

- Default interval: 15 minutes
- Checks `modifiedTime` from Drive API before re-downloading
- Files unchanged since last index are skipped
- Manual sync available via "Force sync" button or `POST /api/drive/sync/{id}/trigger`
```

- [ ] **Step 2: Commit**

```bash
git add integrations/google_drive/README.md
git commit -m "docs(drive): add integration setup documentation"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Check all modified core files**

```bash
git log --oneline main..HEAD
git diff main -- api/main.py | grep "^+" | wc -l
# Should be < 20 new lines in main.py
git diff main -- api/main.py
# Verify only the Drive conditional block was added
```

- [ ] **Step 2: Verify no open_notebook/ core files were modified**

```bash
git diff main -- open_notebook/
# Should show no changes
```

- [ ] **Step 3: Lint check**

```bash
cd /path/to/open-notebook
uv run ruff check integrations/
```

- [ ] **Step 4: Test without Drive env vars (integration disabled)**

```bash
# Ensure the API starts cleanly without Drive vars
GOOGLE_DRIVE_CLIENT_ID="" uv run uvicorn api.main:app --port 5055
# Should start with no Drive-related warnings
```

- [ ] **Step 5: Final commit**

```bash
git tag -a v0.1-google-drive -m "Google Drive integration initial implementation"
```

---

## Merging Future Upstream Releases

```bash
# When upstream releases a new version:
git fetch upstream
git checkout feature/google-drive-integration
git merge upstream/main

# Expected conflicts: ONLY api/main.py (the 4 Drive lines)
# Resolution: keep both the upstream changes AND the Drive conditional block
# All other files in integrations/ and frontend/src/integrations/ → no conflicts
```
