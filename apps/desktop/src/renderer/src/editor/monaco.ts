import type * as MonacoApi from 'monaco-editor/editor/editor.api'

/** The subset of the Monaco API the app imports; deep ESM entry, not the package root. */
export type Monaco = typeof MonacoApi
export type TextModel = MonacoApi.editor.ITextModel
export type StandaloneEditor = MonacoApi.editor.IStandaloneCodeEditor
export type DiffEditor = MonacoApi.editor.IStandaloneDiffEditor

type WorkerLike = {
  getWorker?: (moduleId: string, label: string) => Worker | Promise<Worker>
}

let loading: Promise<Monaco> | null = null
const languageLoads = new Map<string, Promise<unknown>>()

async function workerFor(label: string): Promise<Worker> {
  if (label === 'typescript' || label === 'javascript') {
    const { default: TsWorker } = await import(
      'monaco-editor/languages/features/typescript/ts.worker.js?worker&inline'
    )
    return new TsWorker()
  }
  const { default: EditorWorker } = await import(
    'monaco-editor/editor/editor.worker.js?worker&inline'
  )
  return new EditorWorker()
}

/**
 * Loads Monaco lazily. The editor API and its contributions arrive with this
 * call; a language only pays for its tokenizer the first time a model uses it.
 */
export function loadMonaco(): Promise<Monaco> {
  if (loading === null) {
    loading = (async () => {
      const [api] = await Promise.all([
        import('monaco-editor/editor/editor.api'),
        import('monaco-editor/internal/common/workers.js')
      ])
      // Inline (blob) workers are the only kind that works under the production
      // file:// origin; the CSP already allows worker-src blob:.
      const environment = (self as unknown as { MonacoEnvironment?: WorkerLike }).MonacoEnvironment
      ;(self as unknown as { MonacoEnvironment: WorkerLike }).MonacoEnvironment = {
        ...environment,
        getWorker: (_moduleId: string, label: string) => workerFor(label)
      }
      return api
    })()
  }
  return loading
}

/** Runs `load` once per language id and hands back the module either way. */
export function loadLanguageModule<T>(id: string, load: () => Promise<T>): Promise<T> {
  let pending = languageLoads.get(id)
  if (pending === undefined) {
    pending = load()
    languageLoads.set(id, pending)
  }
  return pending as Promise<T>
}
