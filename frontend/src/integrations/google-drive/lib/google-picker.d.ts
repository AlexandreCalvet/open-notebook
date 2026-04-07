declare global {
  interface Window {
    gapi: {
      load: (lib: string, opts: { callback: () => void; onerror: (e: any) => void }) => void
    }
    google: {
      picker: {
        DocsView: new () => GooglePickerDocsView
        PickerBuilder: new () => GooglePickerBuilder
        Action: { PICKED: string; CANCEL: string }
        Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string }
      }
    }
  }
}

interface GooglePickerDocsView {
  setIncludeFolders(v: boolean): GooglePickerDocsView
  setSelectFolderEnabled(v: boolean): GooglePickerDocsView
  setEnableDrives(v: boolean): GooglePickerDocsView
  setMimeTypes(types: string): GooglePickerDocsView
}

interface GooglePickerBuilder {
  setOAuthToken(token: string): GooglePickerBuilder
  setDeveloperKey(key: string): GooglePickerBuilder
  setAppId(id: string): GooglePickerBuilder
  addView(view: GooglePickerDocsView): GooglePickerBuilder
  enableFeature(feature: string): GooglePickerBuilder
  setCallback(cb: (data: any) => void): GooglePickerBuilder
  build(): { setVisible(v: boolean): void }
}

export {}
