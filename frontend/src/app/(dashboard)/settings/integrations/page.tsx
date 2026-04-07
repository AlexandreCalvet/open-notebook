'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

import { AppShell } from '@/components/layout/AppShell'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { DriveConnectCard } from '@/integrations/google-drive/components/DriveConnectCard'

function IntegrationsContent() {
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get('drive_connected') === 'true') {
      const email = searchParams.get('email')
      toast.success(
        `Connected to Google Drive${email ? ` as ${email}` : ''}`
      )
    }
    if (searchParams.get('drive_error') === 'true') {
      toast.error('Failed to connect Google Drive. Please try again.')
    }
  }, [searchParams])

  return (
    <div className="space-y-4">
      <DriveConnectCard />
    </div>
  )
}

export default function IntegrationsPage() {
  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-6">Integrations</h1>
            <Suspense fallback={<LoadingSpinner />}>
              <IntegrationsContent />
            </Suspense>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
