# Google Drive Integration

Polls watched Google Drive folders and automatically indexes new or changed files as Sources in Open Notebook notebooks.

## Quick Start

### 1. Create a Google Cloud OAuth 2.0 App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **Google Drive API**
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `http://your-server:5055/api/drive/callback`
7. Copy the **Client ID** and **Client Secret**

### 2. Set Environment Variables

```env
GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=your-client-secret
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5055/api/drive/callback
FRONTEND_URL=http://localhost:3000
```

> **If `GOOGLE_DRIVE_CLIENT_ID` is not set, the integration is completely disabled** — zero impact on startup, zero code loaded.

### 3. Install Optional Dependencies

```bash
uv sync --extra google-drive
```

### 4. Connect Your Account

1. Go to **Settings → Integrations** in Open Notebook
2. Click **Connect Google Drive** and complete the OAuth flow

### 5. Add Folder Syncs

1. Open a Notebook
2. In the Sources panel, find **Drive Syncs**
3. Click **+** to browse and select a Drive folder
4. Files are polled every 15 minutes and re-indexed when changed

---

## Supported File Types

| Format | Notes |
|--------|-------|
| PDF | Direct download |
| DOCX, PPTX, XLSX | Direct download |
| TXT, MD, HTML | Direct download |
| Google Docs | Exported as DOCX |
| Google Slides | Exported as PPTX |
| Google Sheets | Exported as XLSX |

---

## Architecture — Minimal Coupling

This integration is fully isolated from the Open Notebook core:

| Layer | Location | Core impact |
|-------|----------|-------------|
| Backend | `integrations/google_drive/` | Zero changes to `open_notebook/` |
| Frontend | `frontend/src/integrations/google-drive/` | Zero changes to core components |
| Database | Own tables (`drive_credential`, `drive_sync`) via `DEFINE TABLE IF NOT EXISTS` | No change to `async_migrate.py` |
| API registration | `api/main.py` | 10 conditional lines only |

### Core files touched

- `api/main.py` — 10 lines (conditional import + router + scheduler)
- `pyproject.toml` — optional dependency group `google-drive`
- `frontend/src/components/layout/AppSidebar.tsx` — 1 nav item added
- `frontend/src/lib/locales/*/index.ts` — 1 translation key per locale

---

## How Polling Works

1. APScheduler runs `sync_all()` every 15 minutes
2. For each enabled `drive_sync` record, list files in the Drive folder
3. For each file, compare `modifiedTime` with the stored value in `source.asset.drive_modified_time`
4. If unchanged → skip
5. If changed or new → download file → trigger `process_source` command (existing pipeline)
6. Deleted files in Drive are NOT automatically removed from Open Notebook (by design — data safety)

---

## Merging Future Upstream Releases

```bash
git fetch upstream
git checkout feature/google-drive-integration
git merge upstream/main
# Expected conflicts: ONLY api/main.py (the 10-line Drive block)
# Resolution: keep both upstream changes AND the Drive conditional block
```

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| "Not connected to Google Drive" on API | Check `GOOGLE_DRIVE_CLIENT_ID` env var is set |
| OAuth redirect fails | Verify `GOOGLE_DRIVE_REDIRECT_URI` matches the URI registered in Google Cloud Console |
| Files not being indexed | Check API logs for Drive sync errors; verify the file type is supported |
| "google-auth not found" | Run `uv sync --extra google-drive` |
| Sync not running | Verify the API started without errors in the Drive integration block |
