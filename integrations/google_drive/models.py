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
