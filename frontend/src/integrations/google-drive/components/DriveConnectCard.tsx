'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, HardDrive, Unplug } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

import { driveApi } from '../lib/api'

export function DriveConnectCard() {
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['drive-status'],
    queryFn: driveApi.getStatus,
    retry: false,
  })

  const disconnectMutation = useMutation({
    mutationFn: driveApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drive-status'] })
      queryClient.invalidateQueries({ queryKey: ['drive-syncs'] })
      toast.success('Disconnected from Google Drive')
    },
    onError: () => toast.error('Failed to disconnect from Google Drive'),
  })

  const handleConnect = async () => {
    try {
      const { url } = await driveApi.getAuthUrl()
      window.location.href = url
    } catch {
      toast.error('Failed to start Google Drive authorization')
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <LoadingSpinner />
        </CardContent>
      </Card>
    )
  }

  if (!status?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Google Drive
          </CardTitle>
          <CardDescription>
            Set <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_DRIVE_CLIENT_ID</code>{' '}
            and{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">GOOGLE_DRIVE_CLIENT_SECRET</code>{' '}
            environment variables to enable this integration.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Google Drive
          </CardTitle>
          <Badge variant={status.connected ? 'default' : 'secondary'}>
            {status.connected ? 'Connected' : 'Not connected'}
          </Badge>
        </div>
        <CardDescription>
          {status.connected
            ? `Connected as ${status.user_email}. Watched folders are automatically re-indexed when files change (every 15 minutes).`
            : 'Connect your Google Drive account to automatically sync folders as notebook sources.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status.connected ? (
          <Button
            variant="outline"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            <Unplug className="h-4 w-4 mr-2" />
            {disconnectMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        ) : (
          <Button onClick={handleConnect}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Connect Google Drive
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
