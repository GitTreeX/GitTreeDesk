#!/usr/bin/env node
/**
 * Compiles the native dependencies that publish no prebuild for the current
 * platform. node-pty ships prebuilds for macOS and Windows only, so Linux has
 * to compile build/Release/pty.node from source. The build goes through npm's
 * lifecycle runner, which always supplies node-gyp, and exits non-zero when the
 * binary is still missing — a native module that never got built would
 * otherwise only surface as a failed packaged-build smoke check.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { arch, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const desktopDir = join(repoRoot, 'apps', 'desktop')

// Paths are probed in node-pty's own loader order.
const NATIVE_TARGETS = [
  {
    name: 'node-pty',
    binaries: [join('prebuilds', `${platform}-${arch}`, 'pty.node'), join('build', 'Release', 'pty.node')]
  }
]

const npm = platform === 'win32' ? 'npm.cmd' : 'npm'
let failed = false

for (const target of NATIVE_TARGETS) {
  let packageDir
  try {
    const manifest = createRequire(join(desktopDir, 'package.json')).resolve(`${target.name}/package.json`)
    packageDir = realpathSync(dirname(manifest))
  } catch {
    console.error(`build-native: ${target.name} not installed — run \`pnpm install\` first`)
    failed = true
    continue
  }

  const candidates = target.binaries.map((binary) => join(packageDir, binary))
  const built = () => candidates.find((candidate) => existsSync(candidate)) ?? null
  if (built() !== null) {
    console.log(`build-native ${target.name} already built for ${platform}-${arch}`)
    continue
  }

  console.log(`build-native building ${target.name} from source for ${platform}-${arch}`)
  const result = spawnSync(npm, ['run-script', 'install', '--foreground-scripts'], {
    cwd: packageDir,
    stdio: 'inherit'
  })
  const binary = built()
  if ((result.status ?? 1) !== 0 || binary === null) {
    console.error(
      `build-native ${target.name} has no ${platform}-${arch} prebuild and cannot be compiled here — ` +
        `checked: ${candidates.join(', ')}`
    )
    console.error('build-native Linux needs python3, make, and a C++ compiler (Debian/Ubuntu: build-essential)')
    failed = true
    continue
  }
  console.log(`build-native ${target.name} built ${binary}`)
}

process.exitCode = failed ? 1 : 0
