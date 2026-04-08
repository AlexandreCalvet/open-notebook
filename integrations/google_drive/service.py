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
    ensure_record_id,
    repo_create,
    repo_query,
    repo_upsert,
)

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

# In-memory store for PKCE code_verifier keyed by OAuth state.
# Needed because the auth URL and the token exchange use separate Flow instances.
# Single-instance only — for multi-instance deployments, use Redis instead.
_pkce_store: Dict[str, str] = {}
PRIMARY_CREDENTIAL_ID = "drive_credential:google_drive_primary"

# Supported MIME types for indexing
SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/html",
    "text/markdown",
    "text/x-markdown",
    "application/markdown",
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
    # Store PKCE code_verifier so the callback can use it with the same state
    if hasattr(flow, "code_verifier") and flow.code_verifier:
        _pkce_store[state] = flow.code_verifier
        logger.debug(f"Stored PKCE code_verifier for state {state}")
    return auth_url


async def exchange_code_for_tokens(code: str, state: Optional[str] = None) -> Dict[str, Any]:
    """Exchange OAuth authorization code for tokens and persist to DB."""
    flow = Flow.from_client_config(_get_client_config(), scopes=SCOPES)
    flow.redirect_uri = os.environ.get(
        "GOOGLE_DRIVE_REDIRECT_URI", "http://localhost:5055/api/drive/callback"
    )
    # Restore PKCE code_verifier if one was stored for this state
    if state and state in _pkce_store:
        flow.code_verifier = _pkce_store.pop(state)
        logger.debug(f"Restored PKCE code_verifier for state {state}")
    flow.fetch_token(code=code)

    creds = flow.credentials
    service = build("oauth2", "v2", credentials=creds)
    user_info = service.userinfo().get().execute()
    user_email = user_info["email"]

    existing = await repo_query(
        "SELECT * FROM drive_credential WHERE user_email = $email LIMIT 1",
        {"email": user_email},
    )
    existing_cred = existing[0] if existing else None

    # Google may omit refresh_token on subsequent grants. Never overwrite a
    # valid stored refresh_token with None, otherwise automatic refresh breaks.
    refresh_token = creds.refresh_token or (
        existing_cred.get("refresh_token") if existing_cred else None
    )

    token_data = {
        "user_email": user_email,
        "access_token": creds.token,
        "refresh_token": refresh_token,
        "expires_at": creds.expiry.isoformat() if creds.expiry else None,
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }

    # Keep one stable credential record to avoid non-deterministic LIMIT 1 reads.
    await repo_upsert("drive_credential", PRIMARY_CREDENTIAL_ID, token_data)
    # Cleanup legacy duplicates from previous implementations.
    await repo_query(
        "DELETE drive_credential WHERE id != $id",
        {"id": ensure_record_id(PRIMARY_CREDENTIAL_ID)},
    )

    return {"user_email": user_email}


async def get_credential() -> Optional[Dict[str, Any]]:
    """Return the stored Drive credential record, or None if not connected."""
    primary = await repo_query(
        "SELECT * FROM $id LIMIT 1",
        {"id": ensure_record_id(PRIMARY_CREDENTIAL_ID)},
    )
    if primary:
        return primary[0]

    # Backward-compatible fallback for environments with legacy rows.
    results = await repo_query(
        "SELECT * FROM drive_credential ORDER BY connected_at DESC, updated DESC LIMIT 1"
    )
    return results[0] if results else None


async def disconnect() -> None:
    """Remove stored credential and disable all active syncs."""
    await repo_query("DELETE drive_credential")
    await repo_query("UPDATE drive_sync SET enabled = false")


def _refresh_credentials(cred_data: Dict[str, Any]) -> Credentials:
    """Build google Credentials and refresh if expired. Persists new token."""
    creds = Credentials(
        token=cred_data["access_token"],
        refresh_token=cred_data.get("refresh_token"),
        client_id=os.environ["GOOGLE_DRIVE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_DRIVE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
    )
    if creds.expired:
        if not creds.refresh_token:
            raise ValueError("Google Drive session expired and cannot be refreshed. Reconnect required.")
        try:
            creds.refresh(Request())
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
        except Exception as e:
            logger.warning(f"Google Drive token refresh failed: {e}")
            raise ValueError("Google Drive refresh token is invalid or revoked. Reconnect required.")
    return creds


def _build_drive_service(cred_data: Dict[str, Any]):
    """Build an authenticated Drive API service, refreshing the token if expired."""
    return build("drive", "v3", credentials=_refresh_credentials(cred_data))


async def get_fresh_access_token() -> Optional[str]:
    """Return a valid (refreshed if needed) access token for the Picker API."""
    cred_data = await get_credential()
    if not cred_data:
        return None
    creds = _refresh_credentials(cred_data)
    return creds.token


async def list_folder_contents(folder_id: str) -> List[Dict[str, Any]]:
    """List supported files in a Drive folder (non-recursive). Works with shared drives."""
    cred_data = await get_credential()
    if not cred_data:
        raise ValueError("No Google Drive credential found")

    service = _build_drive_service(cred_data)
    query = f"'{folder_id}' in parents and trashed=false"

    def _is_supported(file_name: str, mime_type: str) -> bool:
        mt = (mime_type or "").lower()
        name = (file_name or "").lower()
        if mt in SUPPORTED_MIME_TYPES:
            return True
        # Some providers/upload paths return markdown as text/* variants.
        if mt.startswith("text/"):
            return True
        # Last-resort extension guard for markdown-like files.
        if name.endswith((".md", ".markdown", ".txt", ".html", ".htm")):
            return True
        return False

    all_files: List[Dict[str, Any]] = []
    page_token: Optional[str] = None

    while True:
        result = (
            service.files()
            .list(
                q=query,
                fields="nextPageToken,files(id,name,mimeType,modifiedTime,size)",
                pageSize=100,
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        files = result.get("files", [])
        all_files.extend(files)
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    supported_files = [
        f for f in all_files if _is_supported(f.get("name", ""), f.get("mimeType", ""))
    ]
    skipped_count = len(all_files) - len(supported_files)
    logger.debug(
        f"Drive folder {folder_id}: total={len(all_files)} supported={len(supported_files)} skipped={skipped_count}"
    )
    return supported_files



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
