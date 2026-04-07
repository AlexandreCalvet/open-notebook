import { useCallback, useRef } from 'react'
import { driveApi, PickerConfig } from './api'

const PICKER_SCRIPT = 'https://apis.google.com/js/api.js'

interface PickerResult {
  id: string
  name: string
  mimeType: string
}

type OnPicked = (items: PickerResult[]) => void

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

function loadPicker(): Promise<void> {
  return new Promise((resolve, reject) => {
    window.gapi.load('picker', { callback: resolve, onerror: reject })
  })
}

export function useGooglePicker() {
  const configRef = useRef<PickerConfig | null>(null)

  const openPicker = useCallback(async (onPicked: OnPicked) => {
    // 1. Get fresh config from backend
    const config = await driveApi.getPickerConfig()
    configRef.current = config

    // 2. Load Google API script + Picker library
    await loadScript(PICKER_SCRIPT)
    await loadPicker()

    // 3. Build and show Picker
    const google = window.google

    const docsView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)

    const sharedDriveView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true)

    const builder = new google.picker.PickerBuilder()
      .setOAuthToken(config.access_token)
      .addView(docsView)
      .addView(sharedDriveView)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const docs = data.docs || []
          const items: PickerResult[] = docs.map((d: any) => ({
            id: d.id,
            name: d.name,
            mimeType: d.mimeType,
          }))
          onPicked(items)
        }
      })

    if (config.api_key) {
      builder.setDeveloperKey(config.api_key)
    }
    if (config.app_id) {
      builder.setAppId(config.app_id)
    }

    builder.build().setVisible(true)
  }, [])

  return { openPicker }
}
