#!/usr/bin/env node
/**
 * Packages the current platform's electron-builder targets, relaying the
 * repository `.npmrc` mirror settings into the environment (see
 * electron-env.mjs): without them the Electron zip and the builder tooling
 * download straight from GitHub and stall on networks that only reach a
 * mirror. Pass `win`, `mac`, or `linux` to pick the target explicitly, or omit
 * it to package for the current platform. Extra arguments are forwarded,
 * e.g. `--dir`.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronEnv } from './electron-env.mjs'

const TARGETS = { win32: 'win', darwin: 'mac', linux: 'linux' }
const requested = process.argv[2]
const target = requested ?? TARGETS[process.platform]
if (!Object.values(TARGETS).includes(target)) {
  console.error(`package: expected a target of win | mac | linux, got ${JSON.stringify(requested)}`)
  process.exit(1)
}
const rest = process.argv.slice(requested === undefined ? 2 : 3)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(repoRoot, 'apps', 'desktop')
const cli = createRequire(join(desktopDir, 'package.json')).resolve('electron-builder/cli.js')

const result = spawnSync(
  process.execPath,
  [cli, `--${target}`, '--config', 'electron-builder.mjs', '--publish', 'never', ...rest],
  {
    cwd: desktopDir,
    stdio: 'inherit',
    env: electronEnv()
  }
)
process.exit(result.status ?? 1)
