#!/usr/bin/env node
/**
 * Packages the Windows targets (NSIS installer + portable zip) with
 * electron-builder, relaying the repository `.npmrc` mirror settings into the
 * environment (see electron-env.mjs): without them the Electron zip and the
 * NSIS / winCodeSign tools download straight from GitHub and stall on networks
 * that only reach a mirror. Extra arguments are forwarded, e.g. `--dir`.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronEnv } from './electron-env.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(repoRoot, 'apps', 'desktop')
const require = createRequire(join(desktopDir, 'package.json'))
const cli = require.resolve('electron-builder/cli.js')

const result = spawnSync(process.execPath, [cli, '--win', ...process.argv.slice(2)], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: electronEnv()
})
process.exit(result.status ?? 1)
