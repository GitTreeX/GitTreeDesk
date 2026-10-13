import { parse } from 'jsonc-parser'
import { api } from '../api'
import { tsDefaults } from './languages'

const BOOLEAN_OPTIONS = [
  'allowJs',
  'checkJs',
  'allowSyntheticDefaultImports',
  'esModuleInterop',
  'experimentalDecorators',
  'emitDecoratorMetadata',
  'forceConsistentCasingInFileNames',
  'isolatedModules',
  'noFallthroughCasesInSwitch',
  'noImplicitAny',
  'noImplicitReturns',
  'noImplicitThis',
  'noUnusedLocals',
  'noUnusedParameters',
  'resolveJsonModule',
  'skipLibCheck',
  'strict',
  'strictNullChecks',
  'useDefineForClassFields'
] as const

const TARGET_NAMES: Record<string, string> = {
  es3: 'ES3',
  es5: 'ES5',
  es6: 'ES2015',
  es2015: 'ES2015',
  es2016: 'ES2016',
  es2017: 'ES2017',
  es2018: 'ES2018',
  es2019: 'ES2019',
  es2020: 'ES2020',
  es2021: 'ES2021',
  es2022: 'ES2022',
  es2023: 'ES2023',
  es2024: 'ES2024',
  esnext: 'ESNext',
  latest: 'ESNext'
}

const MODULE_NAMES: Record<string, string> = {
  none: 'None',
  commonjs: 'CommonJS',
  amd: 'AMD',
  umd: 'UMD',
  system: 'System',
  es6: 'ES2015',
  es2015: 'ES2015',
  es2020: 'ES2020',
  es2022: 'ES2022',
  esnext: 'ESNext',
  node16: 'Node16',
  node18: 'Node18',
  nodenext: 'NodeNext',
  preserve: 'Preserve'
}

const RESOLUTION_NAMES: Record<string, string> = {
  classic: 'Classic',
  node: 'NodeJs',
  node10: 'Node10',
  node16: 'Node16',
  nodenext: 'NodeNext',
  bundler: 'Bundler'
}

const JSX_NAMES: Record<string, string> = {
  preserve: 'Preserve',
  react: 'React',
  'react-native': 'ReactNative',
  'react-jsx': 'ReactJSX',
  'react-jsxdev': 'ReactJSXDev'
}

const LIB_NAMES = /^(es(5|6|20[0-9][0-9]|next)|dom(\.iterable|\.asynciterable)?|webworker(\.importscripts)?|scripthost)$/

function enumValue(enumObject: unknown, name: string | undefined): number | undefined {
  if (name === undefined) return undefined
  const value = (enumObject as Record<string, unknown>)[name]
  return typeof value === 'number' ? value : undefined
}

function cleanLib(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const libs: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.toLowerCase().replace(/^lib\./, '').replace(/\.d\.ts$/, '')
    if (LIB_NAMES.test(name)) libs.push(name)
  }
  return libs.length === 0 ? undefined : libs
}

interface TsconfigCacheEntry {
  mtimeMs: number
  options: Record<string, unknown> | null
}

const cache = new Map<string, TsconfigCacheEntry>()

function dirOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? path.slice(0, Math.max(0, index)) : path.slice(0, index)
}

interface TsEnums {
  ScriptTarget?: unknown
  ModuleKind?: unknown
  ModuleResolutionKind?: unknown
  JsxEmit?: unknown
}

function parsedTsconfig(source: Record<string, unknown>, enums: TsEnums): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  for (const key of BOOLEAN_OPTIONS) {
    const value = source[key]
    if (typeof value === 'boolean') result[key] = value
  }
  const target = typeof source.target === 'string' ? TARGET_NAMES[source.target.toLowerCase()] : undefined
  const targetValue = enumValue(enums.ScriptTarget, target)
  if (targetValue !== undefined) result.target = targetValue
  const module = typeof source.module === 'string' ? MODULE_NAMES[source.module.toLowerCase()] : undefined
  const moduleValue = enumValue(enums.ModuleKind, module)
  if (moduleValue !== undefined) result.module = moduleValue
  const resolution =
    typeof source.moduleResolution === 'string'
      ? RESOLUTION_NAMES[source.moduleResolution.toLowerCase()]
      : undefined
  const resolutionValue = enumValue(enums.ModuleResolutionKind, resolution)
  if (resolutionValue !== undefined) result.moduleResolution = resolutionValue
  const jsx = typeof source.jsx === 'string' ? JSX_NAMES[source.jsx.toLowerCase()] : undefined
  const jsxValue = enumValue(enums.JsxEmit, jsx)
  if (jsxValue !== undefined) result.jsx = jsxValue
  const lib = cleanLib(source.lib)
  if (lib !== undefined) result.lib = lib
  return Object.keys(result).length === 0 ? null : result
}

async function optionsForDir(
  dir: string,
  enums: Awaited<ReturnType<typeof tsDefaults>>
): Promise<Record<string, unknown> | null> {
  let stat
  try {
    stat = await api.invoke('fs:stat', { path: `${dir}/tsconfig.json` })
  } catch {
    return null
  }
  if (!stat.exists) return null
  const cached = cache.get(dir)
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs) return cached.options
  let options: Record<string, unknown> | null = null
  try {
    const file = await api.invoke('fs:readFile', { path: `${dir}/tsconfig.json` })
    if (file.exists && file.text !== null) {
      const document = parse(file.text, [], { allowTrailingComma: true, disallowComments: false }) as
        | { compilerOptions?: Record<string, unknown> }
        | undefined
      const compilerOptions = document?.compilerOptions
      options =
        compilerOptions === undefined || compilerOptions === null
          ? null
          : parsedTsconfig(compilerOptions, enums)
    }
  } catch {
    options = null
  }
  cache.set(dir, { mtimeMs: stat.mtimeMs, options })
  return options
}

/**
 * Best-effort: feeds the nearest `tsconfig.json` compiler options to the
 * TypeScript language service. Cross-file resolution stays out of scope, so
 * only the directly mappable options travel through.
 */
export async function applyNearestTsconfig(
  root: string,
  filePath: string,
  kind: 'typescript' | 'javascript'
): Promise<void> {
  if (root === '') return
  const enums = await tsDefaults()
  let dir = dirOf(filePath)
  while (dir.length >= root.length && dir.startsWith(root)) {
    const options = await optionsForDir(dir, enums)
    if (options !== null) {
      const defaults = kind === 'typescript' ? enums.typescriptDefaults : enums.javascriptDefaults
      defaults.setCompilerOptions(options as Parameters<typeof defaults.setCompilerOptions>[0])
      return
    }
    const parent = dirOf(dir)
    if (parent === dir || parent.length < root.length) return
    dir = parent
  }
}
