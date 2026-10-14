/**
 * Relays the repository `.npmrc` electron settings into the environment.
 *
 * Lifecycle scripts and packaged builds do not inherit npm config from
 * `.npmrc`, so without this relay `@electron/get` and electron-builder fall
 * back to GitHub and stall on networks that only reach a mirror. Each
 * `electron_*` key is written in the npm-config and plain-env spellings so
 * every reader resolves it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function electronEnv(baseEnv = process.env) {
  const env = { ...baseEnv }
  try {
    const npmrc = readFileSync(join(repoRoot, '.npmrc'), 'utf8')
    for (const line of npmrc.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/.exec(line)
      if (match === null) continue
      const [, key, value] = match
      if (!key.startsWith('electron')) continue
      env[`npm_config_${key}`] ??= value
      env[`NPM_CONFIG_${key.toUpperCase()}`] ??= value
      env[key.toUpperCase()] ??= value
    }
  } catch {
    // No .npmrc — the download tools fall back to their defaults.
  }
  return env
}
