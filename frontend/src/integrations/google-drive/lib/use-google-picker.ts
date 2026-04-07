import { useCallback } from 'react'
import { driveApi } from './api'

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
  const openPicker = useCallback(async (onPicked: OnPicked) => {
    const config = await driveApi.getPickerConfig()

    await loadScript(PICKER_SCRIPT)
    await loadPicker()

    const google = window.google

    const docsView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)

    const sharedDriveView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true)

    const builder = new google.picker.PickerBuilder()
      .setDeveloperKey(config.api_key)
      .setOAuthToken(config.access_token)
      .setAppId(config.app_id)
      .addView(docsView)
      .addView(sharedDriveView)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const items: PickerResult[] = (data.docs || []).map((d: any) => ({
            id: d.id,
            name: d.name,
            mimeType: d.mimeType,
          }))
          onPicked(items)
        }
      })

    builder.setOrigin(window.location.protocol + '//' + window.location.host)

    builder.build().setVisible(true)
  }, [])

  return { openPicker }
}
