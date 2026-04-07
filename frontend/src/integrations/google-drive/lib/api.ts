import apiClient from '@/lib/api/client'

export interface DriveStatus {
  configured: boolean
  connected: boolean
  user_email: string | null
}

export interface PickerConfig {
  access_token: string
  api_key: string
  client_id: string
  app_id: string
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

export interface ImportFileEntry {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
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

  getPickerConfig: async (): Promise<PickerConfig> => {
    const res = await apiClient.get('/drive/picker-config')
    return res.data
  },

  importFiles: async (notebookId: string, files: ImportFileEntry[]): Promise<any> => {
    const res = await apiClient.post('/drive/import-files', {
      notebook_id: notebookId,
      files,
    })
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
