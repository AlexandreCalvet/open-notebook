import apiClient from '@/lib/api/client'

export interface DriveStatus {
  configured: boolean
  connected: boolean
  user_email: string | null
}

export interface DriveItem {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
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

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

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

  browse: async (parentId: string = 'root'): Promise<{ items: DriveItem[]; parent_id: string }> => {
    const res = await apiClient.get('/drive/browse', { params: { parent_id: parentId } })
    return res.data
  },

  listSharedDrives: async (): Promise<{ drives: DriveItem[] }> => {
    const res = await apiClient.get('/drive/shared-drives')
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

  triggerSync: async (syncId: string): Promise<{ message: string }> => {
    const res = await apiClient.post(`/drive/sync/${syncId}/trigger`)
    return res.data
  },
}
