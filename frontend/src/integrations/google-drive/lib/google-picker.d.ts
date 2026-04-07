declare namespace google.picker {
  enum ViewId {
    DOCS = 'all',
    DOCUMENTS = 'documents',
    PRESENTATIONS = 'presentations',
    SPREADSHEETS = 'spreadsheets',
    FORMS = 'forms',
    FOLDERS = 'folders',
    PDFS = 'pdfs',
    DOCS_IMAGES = 'docs-images',
    DOCS_VIDEOS = 'docs-videos',
  }

  const Action: {
    PICKED: string
    CANCEL: string
  }

  const Response: {
    ACTION: string
    DOCUMENTS: string
    PARENTS: string
    VIEW: string
  }

  const Document: {
    ID: string
    NAME: string
    MIME_TYPE: string
    URL: string
    DESCRIPTION: string
    PARENT_ID: string
    TYPE: string
  }

  const Feature: {
    MULTISELECT_ENABLED: string
    SUPPORT_DRIVES: string
    NAV_HIDDEN: string
    MINE_ONLY: string
  }

  enum DocsViewMode {
    LIST = 'list',
    GRID = 'grid',
  }

  class DocsView {
    constructor(viewId?: ViewId)
    setIncludeFolders(v: boolean): DocsView
    setSelectFolderEnabled(v: boolean): DocsView
    setEnableDrives(v: boolean): DocsView
    setMimeTypes(types: string): DocsView
    setMode(mode: DocsViewMode): DocsView
    setParent(parentId: string): DocsView
    setOwnedByMe(v: boolean): DocsView
  }

  class ViewGroup {
    constructor(viewOrId: DocsView | ViewId)
    addView(viewOrId: DocsView | ViewId): ViewGroup
    addLabel(label: string): ViewGroup
  }

  class PickerBuilder {
    setOAuthToken(token: string): PickerBuilder
    setDeveloperKey(key: string): PickerBuilder
    setAppId(id: string): PickerBuilder
    setOrigin(origin: string): PickerBuilder
    setTitle(title: string): PickerBuilder
    setLocale(locale: string): PickerBuilder
    setSize(width: number, height: number): PickerBuilder
    addView(view: DocsView | ViewId): PickerBuilder
    addViewGroup(group: ViewGroup): PickerBuilder
    enableFeature(feature: string): PickerBuilder
    disableFeature(feature: string): PickerBuilder
    setCallback(cb: (data: any) => void): PickerBuilder
    build(): Picker
  }

  interface Picker {
    setVisible(v: boolean): void
    dispose(): void
  }
}

declare global {
  interface Window {
    gapi: {
      load: (lib: string, opts: { callback: () => void; onerror: (e: any) => void }) => void
    }
  }
}

export {}
