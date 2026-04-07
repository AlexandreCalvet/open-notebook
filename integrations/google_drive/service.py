"""
Google Drive OAuth flow and API operations.
All Google-specific logic lives here — no leakage to core modules.
"""
import asyncio
import os
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from loguru import logger

from open_notebook.database.repository import (
    repo_create,
    repo_query,
    repo_upsert,
)

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

# Supported MIME types for indexing
SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/html",
    "text/markdown",
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.presentation",
    "application/vnd.google-apps.spreadsheet",
}

# Google Workspace formats → export targets
GOOGLE_EXPORT_MAP: Dict[str, tuple[str, str]] = {
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
    redirect_uri = os.environ.get(
        "GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback"
    )
    return {
        "web": {
            "client_id": os.environ["GOOGLE_DRIVE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_DRIVE_CLIENT_SECRET"],
            "redirect_uris": [redirect_uri],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }


def build_auth_url(state: str) -> str:
    """Build the Google OAuth authorization URL."""
    flow = Flow.from_client_config(_get_client_config(), scopes=SCOPES)
    flow.redirect_uri = os.environ.get(
        "GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback"
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=state,
        prompt="consent",
    )
    return auth_url


async def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    """Exchange OAuth authorization code for tokens and persist to DB."""
    flow = Flow.from_client_config(_get_client_config(), scopes=SCOPES)
    flow.redirect_uri = os.environ.get(
        "GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback"
    )
    flow.fetch_token(code=code)

    creds = flow.credentials
    service = build("oauth2", "v2", credentials=creds)
    user_info = service.userinfo().get().execute()
    user_email = user_info["email"]

    token_data = {
        "user_email": user_email,
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "expires_at": creds.expiry.isoformat() if creds.expiry else None,
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }

    existing = await repo_query(
        "SELECT * FROM drive_credential WHERE user_email = $email LIMIT 1",
        {"email": user_email},
    )
    if existing:
        await repo_upsert("drive_credential", existing[0]["id"], token_data)
    else:
        await repo_create("drive_credential", token_data)

    return {"user_email": user_email}


async def get_credential() -> Optional[Dict[str, Any]]:
    """Return the stored Drive credential record, or None if not connected."""
    results = await repo_query("SELECT * FROM drive_credential LIMIT 1")
    return results[0] if results else None


async def disconnect() -> None:
    """Remove stored credential and disable all active syncs."""
    await repo_query("DELETE drive_credential")
    await repo_query("UPDATE drive_sync SET enabled = false")


def _build_drive_service(cred_data: Dict[str, Any]):
    """Build an authenticated Drive API service, refreshing the token if expired."""
    creds = Credentials(
        token=cred_data["access_token"],
        refresh_token=cred_data.get("refresh_token"),
        client_id=os.environ["GOOGLE_DRIVE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_DRIVE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Persist refreshed token asynchronously (fire-and-forget)
        asyncio.create_task(
            repo_upsert(
                "drive_credential",
                cred_data["id"],
                {
                    "access_token": creds.token,
                    "expires_at": creds.expiry.isoformat() if creds.expiry else None,
                },
            )
        )
    return build("drive", "v3", credentials=creds)


async def list_folder_contents(folder_id: str) -> List[Dict[str, Any]]:
    """List supported files in a Drive folder (non-recursive)."""
    cred_data = await get_credential()
    if not cred_data:
        raise ValueError("No Google Drive credential found")

    service = _build_drive_service(cred_data)
    mime_filter = " or ".join(f"mimeType='{m}'" for m in SUPPORTED_MIME_TYPES)
    query = f"'{folder_id}' in parents and trashed=false and ({mime_filter})"

    result = (
        service.files()
        .list(
            q=query,
            fields="files(id,name,mimeType,modifiedTime,size)",
            pageSize=100,
        )
        .execute()
    )
    return result.get("files", [])


async def list_user_folders() -> List[Dict[str, Any]]:
    """List top-level Drive folders accessible to the connected user."""
    cred_data = await get_credential()
    if not cred_data:
        raise ValueError("No Google Drive credential found")

    service = _build_drive_service(cred_data)
    result = (
        service.files()
        .list(
            q="mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields="files(id,name,modifiedTime)",
            pageSize=50,
            orderBy="name",
        )
        .execute()
    )
    return result.get("files", [])


async def download_file(file_id: str, file_name: str, mime_type: str) -> str:
    """
    Download a Drive file to the uploads folder and return the local path.
    Caller is responsible for cleanup if needed (the source pipeline handles this).
    Google Workspace files are exported to their Office equivalent.
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
        delete=False,
        suffix=suffix,
        dir=uploads_dir,
        prefix=f"drive_{file_id}_",
    )
    downloader = MediaIoBaseDownload(tmp, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    tmp.close()

    logger.debug(f"Downloaded Drive file {file_id} → {tmp.name}")
    return tmp.name
