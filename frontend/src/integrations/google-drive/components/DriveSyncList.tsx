'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronRight,
  File,
  Folder,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

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

import { DriveItem, FOLDER_MIME, driveApi } from '../lib/api'

interface DriveSyncListProps {
  notebookId: string
}

// ─── Drive folder browser (inside dialog) ────────────────────────────────

interface BreadcrumbEntry {
  id: string
  name: string
}

function DriveBrowser({
  notebookId,
  onSyncAdded,
}: {
  notebookId: string
  onSyncAdded: () => void
}) {
  const queryClient = useQueryClient()
  const [path, setPath] = useState<BreadcrumbEntry[]>([{ id: 'root', name: 'My Drive' }])
  const currentFolder = path[path.length - 1]

  const { data, isLoading } = useQuery({
    queryKey: ['drive-browse', currentFolder.id],
    queryFn: () => driveApi.browse(currentFolder.id),
  })

  const { data: sharedDrives } = useQuery({
    queryKey: ['drive-shared-drives'],
    queryFn: driveApi.listSharedDrives,
    enabled: currentFolder.id === 'root',
  })

  const addSyncMutation = useMutation({
    mutationFn: (folder: { id: string; name: string }) =>
      driveApi.createSync({
        notebook_id: notebookId,
        folder_id: folder.id,
        folder_name: folder.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-syncs', notebookId] })
      toast.success('Folder sync added — first sync will run within 15 minutes.')
      onSyncAdded()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Failed to add folder sync'
      toast.error(msg)
    },
  })

  const navigateInto = (item: DriveItem) => {
    setPath((prev) => [...prev, { id: item.id, name: item.name }])
  }

  const navigateTo = (index: number) => {
    setPath((prev) => prev.slice(0, index + 1))
  }

  const items = data?.items ?? []
  const folders = items.filter((i) => i.mimeType === FOLDER_MIME)
  const files = items.filter((i) => i.mimeType !== FOLDER_MIME)

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        {path.map((entry, idx) => (
          <span key={entry.id} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
            <button
              className="hover:underline hover:text-foreground transition-colors"
              onClick={() => navigateTo(idx)}
            >
              {entry.name}
            </button>
          </span>
        ))}
      </div>

      {/* Sync current folder button */}
      {currentFolder.id !== 'root' && (
        <Button
          size="sm"
          onClick={() =>
            addSyncMutation.mutate({ id: currentFolder.id, name: currentFolder.name })
          }
          disabled={addSyncMutation.isPending}
          className="self-start"
        >
          <Plus className="h-4 w-4 mr-1" />
          Sync "{currentFolder.name}"
        </Button>
      )}

      {/* Item list */}
      <div className="max-h-80 overflow-y-auto border rounded-md divide-y">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {/* Shared drives at root level */}
            {currentFolder.id === 'root' &&
              sharedDrives?.drives?.map((d) => (
                <button
                  key={d.id}
                  onClick={() => navigateInto(d)}
                  className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted transition-colors text-sm"
                >
                  <HardDrive className="h-4 w-4 shrink-0 text-blue-500" />
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Shared drive</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}

            {/* Folders */}
            {folders.map((item) => (
              <div key={item.id} className="flex items-center w-full hover:bg-muted transition-colors">
                <button
                  onClick={() => navigateInto(item)}
                  className="flex items-center gap-2 px-3 py-2 flex-1 text-left text-sm min-w-0"
                >
                  <Folder className="h-4 w-4 shrink-0 text-yellow-500" />
                  <span className="truncate">{item.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground ml-auto" />
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 mr-1 text-xs"
                  onClick={() => addSyncMutation.mutate({ id: item.id, name: item.name })}
                  disabled={addSyncMutation.isPending}
                  title={`Sync "${item.name}"`}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Sync
                </Button>
              </div>
            ))}

            {/* Files (informational — not selectable for sync) */}
            {files.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
              >
                <File className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.name}</span>
              </div>
            ))}

            {folders.length === 0 && files.length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground text-center py-6">
                This folder is empty or has no supported files.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────

export function DriveSyncList({ notebookId }: DriveSyncListProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)

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

  if (!status?.configured || !status?.connected) return null

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium flex items-center gap-1 text-muted-foreground">
          <HardDrive className="h-4 w-4" />
          Drive Syncs
        </h3>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" title="Add Drive folder sync">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Browse Google Drive</DialogTitle>
            </DialogHeader>
            {dialogOpen && (
              <DriveBrowser
                notebookId={notebookId}
                onSyncAdded={() => setDialogOpen(false)}
              />
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
