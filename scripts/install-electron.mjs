#!/usr/bin/env node
/**
 * Runs Electron's binary download with the repository `.npmrc` settings applied
 * (see electron-env.mjs) so dependency installs fetch from the configured
 * mirror instead of GitHub.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronEnv } from './electron-env.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const installer = join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron', 'install.js')
const result = spawnSync(process.execPath, [installer], { stdio: 'inherit', env: electronEnv() })
process.exit(result.status ?? 1)
