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

    const myDriveView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(true)

    const sharedDrivesView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true)

    const picker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.DOCS)
      .addView(myDriveView)
      .addView(sharedDrivesView)
      .setOAuthToken(config.access_token)
      .setDeveloperKey(config.api_key)
      .setAppId(config.app_id)
      .setCallback((data: any) => {
        if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
          const items: PickerResult[] = (data[google.picker.Response.DOCUMENTS] || []).map((d: any) => ({
            id: d[google.picker.Document.ID],
            name: d[google.picker.Document.NAME],
            mimeType: d[google.picker.Document.MIME_TYPE],
          }))
          onPicked(items)
        }
      })
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .build()

    picker.setVisible(true)
  }, [])

  return { openPicker }
}
