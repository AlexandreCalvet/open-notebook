'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

import { driveApi, ImportFileEntry } from '../lib/api'
import { useGooglePicker } from '../lib/use-google-picker'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface DriveSyncListProps {
  notebookId: string
}

export function DriveSyncList({ notebookId }: DriveSyncListProps) {
  const queryClient = useQueryClient()
  const { openPicker } = useGooglePicker()
  const [pickerLoading, setPickerLoading] = useState(false)

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

  const deleteSyncMutation = useMutation({
    mutationFn: driveApi.deleteSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-syncs', notebookId] })
      toast.success('Folder sync removed')
    },
    onError: () => toast.error('Failed to remove folder sync'),
  })

  const triggerSyncMutation = useMutation({
    mutationFn: driveApi.triggerSync,
    onSuccess: () => toast.success('Sync completed'),
    onError: () => toast.error('Sync failed — check API logs for details'),
  })

  const importFilesMutation = useMutation({
    mutationFn: (files: ImportFileEntry[]) => driveApi.importFiles(notebookId, files),
    onSuccess: (data) => {
      const count = data.imported?.filter((f: any) => !f.error).length ?? 0
      toast.success(`${count} file(s) imported — processing in background.`)
      queryClient.invalidateQueries({ queryKey: ['notebook-sources', notebookId] })
    },
    onError: () => toast.error('Failed to import files'),
  })

  const createSyncMutation = useMutation({
    mutationFn: (folder: { id: string; name: string }) =>
      driveApi.createSync({
        notebook_id: notebookId,
        folder_id: folder.id,
        folder_name: folder.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-syncs', notebookId] })
      toast.success('Folder sync added — first sync runs within 15 minutes.')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || 'Failed to add folder sync'),
  })

  const handleOpenPicker = async () => {
    setPickerLoading(true)
    try {
      await openPicker((items) => {
        const folders = items.filter((i) => i.mimeType === FOLDER_MIME)
        const files = items.filter((i) => i.mimeType !== FOLDER_MIME)

        // Sync folders
        for (const folder of folders) {
          createSyncMutation.mutate({ id: folder.id, name: folder.name })
        }

        // Import individual files
        if (files.length > 0) {
          importFilesMutation.mutate(
            files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))
          )
        }
      })
    } catch (err) {
      toast.error('Failed to open Google Drive picker')
    } finally {
      setPickerLoading(false)
    }
  }

  if (!status?.configured || !status?.connected) return null

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium flex items-center gap-1 text-muted-foreground">
          <HardDrive className="h-4 w-4" />
          Google Drive
        </h3>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleOpenPicker}
          disabled={pickerLoading || importFilesMutation.isPending}
          title="Add from Google Drive"
        >
          {pickerLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>

      {syncsLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-2">
          {syncs?.map((sync) => (
            <Card key={sync.id} className="p-0">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{sync.folder_name}</p>
                    {sync.last_sync_at ? (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {new Date(sync.last_sync_at).toLocaleString()}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Pending first sync…</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => triggerSyncMutation.mutate(sync.id)}
                      disabled={triggerSyncMutation.isPending}
                      title="Force sync now"
                    >
                      {triggerSyncMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteSyncMutation.mutate(sync.id)}
                      disabled={deleteSyncMutation.isPending}
                      title="Remove sync"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {importFilesMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing files…
            </div>
          )}

          {(!syncs || syncs.length === 0) && !importFilesMutation.isPending && (
            <p className="text-xs text-muted-foreground">
              Click + to add files or folders from Google Drive.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
