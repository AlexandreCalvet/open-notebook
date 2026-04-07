'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FolderSync, HardDrive, Plus, RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

import { DriveFolder, driveApi } from '../lib/api'

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
    onError: () => toast.error('Failed to remove folder sync'),
  })

  const triggerSyncMutation = useMutation({
    mutationFn: driveApi.triggerSync,
    onSuccess: () => toast.success('Sync completed'),
    onError: () => toast.error('Sync failed — check the API logs for details'),
  })

  // Only render when Drive is configured and connected
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
            <Button variant="ghost" size="sm" title="Add Drive folder sync">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Drive Folder Sync</DialogTitle>
            </DialogHeader>
            {foldersLoading ? (
              <div className="py-6 flex justify-center">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {foldersData?.folders.map((folder) => (
                  <Button
                    key={folder.id}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => addSyncMutation.mutate(folder)}
                    disabled={addSyncMutation.isPending}
                  >
                    <FolderSync className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </Button>
                ))}
                {!foldersData?.folders.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No folders found in your Drive.
                  </p>
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{sync.folder_name}</p>
                    {sync.last_sync_at ? (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {new Date(sync.last_sync_at).toLocaleString()}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Pending first sync…
                      </p>
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
                      <RefreshCw className="h-3 w-3" />
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
          {syncs?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No Drive folders synced to this notebook yet.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
