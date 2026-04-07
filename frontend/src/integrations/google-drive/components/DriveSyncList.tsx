'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  Search,
  Trash2,
  X,
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
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

import { DriveItem, FOLDER_MIME, driveApi } from '../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────

interface DriveSyncListProps {
  notebookId: string
}

interface BreadcrumbEntry {
  id: string
  name: string
}

// ─── Shared hook: sync a folder ──────────────────────────────────────────

function useSyncFolder(notebookId: string, onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (folder: { id: string; name: string }) =>
      driveApi.createSync({
        notebook_id: notebookId,
        folder_id: folder.id,
        folder_name: folder.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-syncs', notebookId] })
      toast.success('Folder sync added — first sync will run within 15 minutes.')
      onDone()
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.detail || 'Failed to add folder sync'),
  })
}

// ─── Shared hook: infinite scroll ────────────────────────────────────────

function useInfiniteScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  nextPageToken: string | null,
  loadingMore: boolean,
  loadMore: () => void,
) {
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !nextPageToken || loadingMore) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      loadMore()
    }
  }, [scrollRef, nextPageToken, loadingMore, loadMore])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollRef, handleScroll])
}

// ─── Drive item row ──────────────────────────────────────────────────────

function DriveRow({
  item,
  onNavigate,
  onSync,
  isSyncing,
}: {
  item: DriveItem
  onNavigate: (item: DriveItem) => void
  onSync: (item: DriveItem) => void
  isSyncing: boolean
}) {
  const isFolder = item.mimeType === FOLDER_MIME

  if (!isFolder) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <File className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.name}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center w-full hover:bg-muted transition-colors">
      <button
        onClick={() => onNavigate(item)}
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
        onClick={(e) => {
          e.stopPropagation()
          onSync(item)
        }}
        disabled={isSyncing}
        title={`Sync "${item.name}"`}
      >
        <Plus className="h-3 w-3 mr-1" />
        Sync
      </Button>
    </div>
  )
}

// ─── Breadcrumbs ─────────────────────────────────────────────────────────

function Breadcrumbs({
  path,
  onNavigateTo,
}: {
  path: BreadcrumbEntry[]
  onNavigateTo: (index: number) => void
}) {
  return (
    <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap min-h-[24px]">
      {path.map((entry, idx) => (
        <span key={`${entry.id}-${idx}`} className="flex items-center gap-1">
          {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
          <button
            className="hover:underline hover:text-foreground transition-colors"
            onClick={() => onNavigateTo(idx)}
          >
            {entry.name}
          </button>
        </span>
      ))}
    </div>
  )
}

// ─── Scrollable item list ────────────────────────────────────────────────

function ItemList({
  scrollRef,
  items,
  isLoading,
  loadingMore,
  emptyMessage,
  onNavigate,
  onSync,
  isSyncing,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  items: DriveItem[]
  isLoading: boolean
  loadingMore: boolean
  emptyMessage: string
  onNavigate: (item: DriveItem) => void
  onSync: (item: DriveItem) => void
  isSyncing: boolean
}) {
  return (
    <div ref={scrollRef} className="max-h-96 overflow-y-auto border rounded-md divide-y">
      {isLoading && items.length === 0 ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{emptyMessage}</p>
      ) : (
        <>
          {items.map((item) => (
            <DriveRow
              key={item.id}
              item={item}
              onNavigate={onNavigate}
              onSync={onSync}
              isSyncing={isSyncing}
            />
          ))}
          {loadingMore && (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── My Drive browser tab ────────────────────────────────────────────────

function MyDriveTab({
  notebookId,
  onSyncAdded,
}: {
  notebookId: string
  onSyncAdded: () => void
}) {
  const [path, setPath] = useState<BreadcrumbEntry[]>([{ id: 'root', name: 'My Drive' }])
  const currentFolder = path[path.length - 1]

  const [allItems, setAllItems] = useState<DriveItem[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['drive-browse', currentFolder.id],
    queryFn: () => driveApi.browse(currentFolder.id),
  })

  useEffect(() => {
    if (data) {
      setAllItems(data.items)
      setNextPageToken(data.nextPageToken ?? null)
    }
  }, [data])

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return
    setLoadingMore(true)
    try {
      const resp = await driveApi.browse(currentFolder.id, nextPageToken)
      setAllItems((prev) => [...prev, ...resp.items])
      setNextPageToken(resp.nextPageToken ?? null)
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageToken, loadingMore, currentFolder.id])

  useInfiniteScroll(scrollRef, nextPageToken, loadingMore, loadMore)

  const syncMutation = useSyncFolder(notebookId, onSyncAdded)

  const navigateInto = (item: DriveItem) => {
    setAllItems([])
    setNextPageToken(null)
    setPath((prev) => [...prev, { id: item.id, name: item.name }])
  }

  const navigateTo = (index: number) => {
    setAllItems([])
    setNextPageToken(null)
    setPath((prev) => prev.slice(0, index + 1))
  }

  return (
    <div className="flex flex-col gap-2">
      <Breadcrumbs path={path} onNavigateTo={navigateTo} />
      <ItemList
        scrollRef={scrollRef}
        items={allItems}
        isLoading={isLoading}
        loadingMore={loadingMore}
        emptyMessage="This folder is empty or has no supported files."
        onNavigate={navigateInto}
        onSync={(f) => syncMutation.mutate({ id: f.id, name: f.name })}
        isSyncing={syncMutation.isPending}
      />
    </div>
  )
}

// ─── Shared Drives tab ───────────────────────────────────────────────────

function SharedDrivesTab({
  notebookId,
  onSyncAdded,
}: {
  notebookId: string
  onSyncAdded: () => void
}) {
  const [path, setPath] = useState<BreadcrumbEntry[] | null>(null)
  const currentFolder = path ? path[path.length - 1] : null

  const [allItems, setAllItems] = useState<DriveItem[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: sharedDrives, isLoading: drivesLoading } = useQuery({
    queryKey: ['drive-shared-drives'],
    queryFn: driveApi.listSharedDrives,
    enabled: !path,
  })

  const { data: browseData, isLoading: browseLoading } = useQuery({
    queryKey: ['drive-browse', currentFolder?.id],
    queryFn: () => driveApi.browse(currentFolder!.id),
    enabled: !!currentFolder,
  })

  useEffect(() => {
    if (browseData) {
      setAllItems(browseData.items)
      setNextPageToken(browseData.nextPageToken ?? null)
    }
  }, [browseData])

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore || !currentFolder) return
    setLoadingMore(true)
    try {
      const resp = await driveApi.browse(currentFolder.id, nextPageToken)
      setAllItems((prev) => [...prev, ...resp.items])
      setNextPageToken(resp.nextPageToken ?? null)
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageToken, loadingMore, currentFolder])

  useInfiniteScroll(scrollRef, nextPageToken, loadingMore, loadMore)

  const syncMutation = useSyncFolder(notebookId, onSyncAdded)

  const enterDrive = (drive: DriveItem) => {
    setAllItems([])
    setNextPageToken(null)
    setPath([{ id: drive.id, name: drive.name }])
  }

  const navigateInto = (item: DriveItem) => {
    setAllItems([])
    setNextPageToken(null)
    setPath((prev) => (prev ? [...prev, { id: item.id, name: item.name }] : null))
  }

  const navigateTo = (index: number) => {
    if (index < 0) {
      setPath(null)
      setAllItems([])
      setNextPageToken(null)
      return
    }
    setAllItems([])
    setNextPageToken(null)
    setPath((prev) => (prev ? prev.slice(0, index + 1) : null))
  }

  // Show shared-drive list
  if (!path) {
    return (
      <div className="max-h-96 overflow-y-auto border rounded-md divide-y">
        {drivesLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : !sharedDrives?.drives?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No shared drives found.
          </p>
        ) : (
          sharedDrives.drives.map((d) => (
            <button
              key={d.id}
              onClick={() => enterDrive(d)}
              className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted transition-colors text-sm"
            >
              <HardDrive className="h-4 w-4 shrink-0 text-blue-500" />
              <span className="truncate font-medium">{d.name}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground ml-auto" />
            </button>
          ))
        )}
      </div>
    )
  }

  // Inside a shared drive
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap min-h-[24px]">
        <button
          className="hover:underline hover:text-foreground transition-colors"
          onClick={() => navigateTo(-1)}
        >
          Shared Drives
        </button>
        {path.map((entry, idx) => (
          <span key={`${entry.id}-${idx}`} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button
              className="hover:underline hover:text-foreground transition-colors"
              onClick={() => navigateTo(idx)}
            >
              {entry.name}
            </button>
          </span>
        ))}
      </div>
      <ItemList
        scrollRef={scrollRef}
        items={allItems}
        isLoading={browseLoading}
        loadingMore={loadingMore}
        emptyMessage="This folder is empty or has no supported files."
        onNavigate={navigateInto}
        onSync={(f) => syncMutation.mutate({ id: f.id, name: f.name })}
        isSyncing={syncMutation.isPending}
      />
    </div>
  )
}

// ─── Search tab ──────────────────────────────────────────────────────────

function SearchTab({
  notebookId,
  onSyncAdded,
}: {
  notebookId: string
  onSyncAdded: () => void
}) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [allItems, setAllItems] = useState<DriveItem[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['drive-search', submitted],
    queryFn: () => driveApi.search(submitted),
    enabled: submitted.length >= 2,
  })

  useEffect(() => {
    if (data) {
      setAllItems(data.items)
      setNextPageToken(data.nextPageToken ?? null)
    }
  }, [data])

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore || !submitted) return
    setLoadingMore(true)
    try {
      const resp = await driveApi.search(submitted, nextPageToken)
      setAllItems((prev) => [...prev, ...resp.items])
      setNextPageToken(resp.nextPageToken ?? null)
    } finally {
      setLoadingMore(false)
    }
  }, [nextPageToken, loadingMore, submitted])

  useInfiniteScroll(scrollRef, nextPageToken, loadingMore, loadMore)

  const syncMutation = useSyncFolder(notebookId, onSyncAdded)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length >= 2) {
      setAllItems([])
      setNextPageToken(null)
      setSubmitted(query.trim())
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your Drive…"
            className="pl-9 pr-8"
          />
          {query && (
            <button
              type="button"
              className="absolute right-2.5 top-2.5"
              onClick={() => {
                setQuery('')
                setSubmitted('')
                setAllItems([])
              }}
            >
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={query.trim().length < 2}>
          Search
        </Button>
      </form>

      <ItemList
        scrollRef={scrollRef}
        items={allItems}
        isLoading={isLoading && allItems.length === 0}
        loadingMore={loadingMore}
        emptyMessage={
          !submitted
            ? 'Type a search query to find folders in your Drive.'
            : `No results found for "${submitted}".`
        }
        onNavigate={() => {}}
        onSync={(f) => syncMutation.mutate({ id: f.id, name: f.name })}
        isSyncing={syncMutation.isPending}
      />
    </div>
  )
}

// ─── Main dialog + sync list ─────────────────────────────────────────────

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
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Browse Google Drive</DialogTitle>
            </DialogHeader>
            {dialogOpen && (
              <Tabs defaultValue="my-drive" className="flex-1 overflow-hidden flex flex-col">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="my-drive">My Drive</TabsTrigger>
                  <TabsTrigger value="shared">Shared Drives</TabsTrigger>
                  <TabsTrigger value="search">Search</TabsTrigger>
                </TabsList>
                <TabsContent value="my-drive" className="flex-1 overflow-hidden mt-3">
                  <MyDriveTab notebookId={notebookId} onSyncAdded={() => setDialogOpen(false)} />
                </TabsContent>
                <TabsContent value="shared" className="flex-1 overflow-hidden mt-3">
                  <SharedDrivesTab
                    notebookId={notebookId}
                    onSyncAdded={() => setDialogOpen(false)}
                  />
                </TabsContent>
                <TabsContent value="search" className="flex-1 overflow-hidden mt-3">
                  <SearchTab notebookId={notebookId} onSyncAdded={() => setDialogOpen(false)} />
                </TabsContent>
              </Tabs>
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
