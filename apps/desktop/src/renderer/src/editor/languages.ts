import { loadLanguageModule } from './monaco'
import type { Monaco } from './monaco'

interface LanguageSpec {
  id: string
  extensions: readonly string[]
}

const LANGUAGE_SPECS: readonly LanguageSpec[] = [
  { id: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  { id: 'typescript', extensions: ['.ts', '.tsx', '.cts', '.mts'] },
  { id: 'markdown', extensions: ['.md', '.markdown', '.mdown', '.mkdn', '.mdx'] },
  { id: 'html', extensions: ['.html', '.htm', '.xhtml'] },
  { id: 'css', extensions: ['.css'] },
  { id: 'scss', extensions: ['.scss'] },
  { id: 'less', extensions: ['.less'] },
  { id: 'yaml', extensions: ['.yaml', '.yml'] },
  { id: 'xml', extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg', '.plist'] },
  { id: 'shell', extensions: ['.sh', '.bash', '.zsh', '.ksh'] },
  { id: 'powershell', extensions: ['.ps1', '.psm1', '.psd1'] },
  { id: 'bat', extensions: ['.bat', '.cmd'] },
  { id: 'python', extensions: ['.py', '.pyw'] },
  { id: 'ruby', extensions: ['.rb', '.gemspec', '.rake'] },
  { id: 'php', extensions: ['.php'] },
  { id: 'perl', extensions: ['.pl', '.pm'] },
  { id: 'lua', extensions: ['.lua'] },
  { id: 'r', extensions: ['.r'] },
  { id: 'go', extensions: ['.go'] },
  { id: 'rust', extensions: ['.rs'] },
  { id: 'java', extensions: ['.java'] },
  { id: 'kotlin', extensions: ['.kt', '.kts'] },
  { id: 'scala', extensions: ['.scala', '.sc'] },
  { id: 'csharp', extensions: ['.cs'] },
  { id: 'vb', extensions: ['.vb'] },
  { id: 'fsharp', extensions: ['.fs', '.fsi', '.fsx'] },
  { id: 'cpp', extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'] },
  { id: 'objective-c', extensions: ['.m'] },
  { id: 'swift', extensions: ['.swift'] },
  { id: 'dart', extensions: ['.dart'] },
  { id: 'sql', extensions: ['.sql'] },
  { id: 'graphql', extensions: ['.graphql', '.gql'] },
  { id: 'protobuf', extensions: ['.proto'] },
  { id: 'ini', extensions: ['.ini', '.cfg', '.properties'] },
  { id: 'dockerfile', extensions: ['.dockerfile'] },
  { id: 'clojure', extensions: ['.clj', '.cljs', '.cljc', '.edn'] },
  { id: 'coffee', extensions: ['.coffee'] },
  { id: 'elixir', extensions: ['.ex', '.exs'] },
  { id: 'handlebars', extensions: ['.hbs', '.handlebars'] },
  { id: 'pug', extensions: ['.pug', '.jade'] },
  { id: 'twig', extensions: ['.twig'] },
  { id: 'liquid', extensions: ['.liquid'] },
  { id: 'razor', extensions: ['.cshtml', '.razor'] },
  { id: 'restructuredtext', extensions: ['.rst'] },
  { id: 'solidity', extensions: ['.sol'] },
  { id: 'wgsl', extensions: ['.wgsl'] },
  { id: 'redis', extensions: ['.redis'] },
  { id: 'pascaligo', extensions: ['.ligo'] },
  { id: 'mips', extensions: ['.s'] },
  { id: 'abap', extensions: ['.abap'] }
]

/** Languages registered by the JSON feature module instead of a definitions folder. */
const JSON_LANGUAGE = 'json'

const LOADERS: Record<string, () => Promise<unknown>> = {
  javascript: () => import('monaco-editor/languages/definitions/javascript/register.js'),
  typescript: () => import('monaco-editor/languages/features/typescript/register.js'),
  markdown: () => import('monaco-editor/languages/definitions/markdown/register.js'),
  html: () => import('monaco-editor/languages/definitions/html/register.js'),
  css: () => import('monaco-editor/languages/definitions/css/register.js'),
  scss: () => import('monaco-editor/languages/definitions/scss/register.js'),
  less: () => import('monaco-editor/languages/definitions/less/register.js'),
  yaml: () => import('monaco-editor/languages/definitions/yaml/register.js'),
  xml: () => import('monaco-editor/languages/definitions/xml/register.js'),
  shell: () => import('monaco-editor/languages/definitions/shell/register.js'),
  powershell: () => import('monaco-editor/languages/definitions/powershell/register.js'),
  bat: () => import('monaco-editor/languages/definitions/bat/register.js'),
  python: () => import('monaco-editor/languages/definitions/python/register.js'),
  ruby: () => import('monaco-editor/languages/definitions/ruby/register.js'),
  php: () => import('monaco-editor/languages/definitions/php/register.js'),
  perl: () => import('monaco-editor/languages/definitions/perl/register.js'),
  lua: () => import('monaco-editor/languages/definitions/lua/register.js'),
  r: () => import('monaco-editor/languages/definitions/r/register.js'),
  go: () => import('monaco-editor/languages/definitions/go/register.js'),
  rust: () => import('monaco-editor/languages/definitions/rust/register.js'),
  java: () => import('monaco-editor/languages/definitions/java/register.js'),
  kotlin: () => import('monaco-editor/languages/definitions/kotlin/register.js'),
  scala: () => import('monaco-editor/languages/definitions/scala/register.js'),
  csharp: () => import('monaco-editor/languages/definitions/csharp/register.js'),
  vb: () => import('monaco-editor/languages/definitions/vb/register.js'),
  fsharp: () => import('monaco-editor/languages/definitions/fsharp/register.js'),
  cpp: () => import('monaco-editor/languages/definitions/cpp/register.js'),
  'objective-c': () => import('monaco-editor/languages/definitions/objective-c/register.js'),
  swift: () => import('monaco-editor/languages/definitions/swift/register.js'),
  dart: () => import('monaco-editor/languages/definitions/dart/register.js'),
  sql: () => import('monaco-editor/languages/definitions/sql/register.js'),
  graphql: () => import('monaco-editor/languages/definitions/graphql/register.js'),
  protobuf: () => import('monaco-editor/languages/definitions/protobuf/register.js'),
  ini: () => import('monaco-editor/languages/definitions/ini/register.js'),
  dockerfile: () => import('monaco-editor/languages/definitions/dockerfile/register.js'),
  clojure: () => import('monaco-editor/languages/definitions/clojure/register.js'),
  coffee: () => import('monaco-editor/languages/definitions/coffee/register.js'),
  elixir: () => import('monaco-editor/languages/definitions/elixir/register.js'),
  handlebars: () => import('monaco-editor/languages/definitions/handlebars/register.js'),
  pug: () => import('monaco-editor/languages/definitions/pug/register.js'),
  twig: () => import('monaco-editor/languages/definitions/twig/register.js'),
  liquid: () => import('monaco-editor/languages/definitions/liquid/register.js'),
  razor: () => import('monaco-editor/languages/definitions/razor/register.js'),
  restructuredtext: () =>
    import('monaco-editor/languages/definitions/restructuredtext/register.js'),
  solidity: () => import('monaco-editor/languages/definitions/solidity/register.js'),
  wgsl: () => import('monaco-editor/languages/definitions/wgsl/register.js'),
  redis: () => import('monaco-editor/languages/definitions/redis/register.js'),
  pascaligo: () => import('monaco-editor/languages/definitions/pascaligo/register.js'),
  mips: () => import('monaco-editor/languages/definitions/mips/register.js'),
  abap: () => import('monaco-editor/languages/definitions/abap/register.js')
}

const EXTENSION_BY_LANGUAGE = new Map<string, string>()
for (const spec of LANGUAGE_SPECS) {
  for (const extension of spec.extensions) EXTENSION_BY_LANGUAGE.set(extension, spec.id)
}

const TS_MODES = new Set(['typescript', 'javascript'])

/** Language id for a file path; `plaintext` when no tokenizer is bundled. */
export function languageIdForPath(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'plaintext'
  return EXTENSION_BY_LANGUAGE.get(name.slice(dot)) ?? 'plaintext'
}

export function isTsMode(id: string): boolean {
  return TS_MODES.has(id)
}

async function registerJson(monaco: Monaco): Promise<void> {
  const { languages } = monaco
  languages.register({
    id: JSON_LANGUAGE,
    extensions: ['.json', '.jsonc'],
    aliases: ['JSON', 'json'],
    mimetypes: ['application/json']
  })
  const { createTokenizationSupport } = await import(
    'monaco-editor/languages/features/json/tokenization.js'
  )
  languages.setTokensProvider(JSON_LANGUAGE, createTokenizationSupport(true))
  languages.setLanguageConfiguration(JSON_LANGUAGE, {
    brackets: [
      ['{', '}'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' }
    ]
  })
}

/**
 * Registers the tokenizer for a language on demand; unknown ids fall back to
 * the built-in plaintext mode without a load.
 */
export function ensureLanguage(monaco: Monaco, id: string): Promise<void> {
  if (id === JSON_LANGUAGE) {
    return loadLanguageModule(JSON_LANGUAGE, () => registerJson(monaco))
  }
  const loader = LOADERS[id]
  if (loader === undefined) return Promise.resolve()
  return loadLanguageModule(id, loader).then(() => undefined)
}

export function isJsonPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.json') || lower.endsWith('.jsonc')
}

type TsModule = typeof import('monaco-editor/languages/features/typescript/register.js')

export const TS_MODULE_ID = 'typescript'

/** The TypeScript language service defaults, loaded together with the module. */
export function tsDefaults(): Promise<TsModule> {
  const loader = LOADERS[TS_MODULE_ID]
  if (loader === undefined) throw new Error('The TypeScript language module is not registered')
  return loadLanguageModule(TS_MODULE_ID, loader) as Promise<TsModule>
}
