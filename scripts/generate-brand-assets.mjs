#!/usr/bin/env node
/**
 * Rasterizes the brand SVGs into the packaging icon set:
 *
 *   apps/desktop/build/icon.png    1024px tile, the raster source
 *   apps/desktop/build/icon.ico    Windows icon (16–256, PNG-compressed entries)
 *   apps/desktop/build/icon.icns   macOS icon (16–1024)
 *
 * Rasterization runs in a hidden Electron window: the canvas keeps the tile's
 * transparent corners and scales the two optical sizes (full detail at 48px+,
 * the thickened small variant at 32px and below) as the brand rules require.
 * The ICO/ICNS containers are written with plain Buffers — no extra tooling.
 * Node re-executes itself under the workspace Electron, so a single command
 * (`pnpm brand`) works everywhere the workspace is installed.
 *
 * Usage:
 *   node scripts/generate-brand-assets.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP_DIR = join(REPO_ROOT, 'apps', 'desktop')
const BUILD_DIR = join(DESKTOP_DIR, 'build')
const SVG_FULL = join(REPO_ROOT, 'brand', 'svg', 'gitreedesk-icon.svg')
const SVG_SMALL = join(REPO_ROOT, 'brand', 'svg', 'gitreedesk-icon-small.svg')

function fail(message) {
  throw new Error(message)
}

if (process.versions.electron === undefined) {
  const require = createRequire(join(DESKTOP_DIR, 'package.json'))
  const electronPath = require('electron')
  const result = spawnSync(electronPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow, nativeImage } = await import('electron')

app.disableHardwareAcceleration()
app.setPath('userData', join(tmpdir(), 'gitreedesk-brand-assets'))

/**
 * Electron holds back its startup until the ESM entry finished evaluating, so a
 * top-level `await app.whenReady()` deadlocks — the ready event can never fire
 * while this module is still evaluating. All work therefore hangs off the ready
 * hook instead.
 */
app.whenReady().then(main).catch((error) => {
  console.error(`brand: ${error?.stack ?? error}`)
  app.exit(1)
})

/** Draws the SVG into a size×size canvas of `win` and returns the PNG bytes (alpha kept). */
async function rasterize(win, svg, size) {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(source)}
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = ${String(size)}
    canvas.height = ${String(size)}
    const context = canvas.getContext('2d')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, ${String(size)}, ${String(size)})
    return canvas.toDataURL('image/png')
  })()`)
  const png = Buffer.from(String(dataUrl).split(',')[1] ?? '', 'base64')
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`rasterize ${String(size)}px produced no PNG`)
  return png
}

/** Multi-size ICO with PNG-compressed entries (supported since Vista). */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = 6 + entries.length * 16
  const directory = []
  for (const entry of entries) {
    const record = Buffer.alloc(16)
    record.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0)
    record.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1)
    record.writeUInt8(0, 2)
    record.writeUInt8(0, 3)
    record.writeUInt16LE(1, 4)
    record.writeUInt16LE(32, 6)
    record.writeUInt32LE(entry.png.length, 8)
    record.writeUInt32LE(offset, 12)
    offset += entry.png.length
    directory.push(record)
  }
  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.png)])
}

/** ICNS container with PNG entries (icp4/icp5/icp6, ic07–ic10). */
function encodeIcns(entries) {
  const chunks = []
  let total = 8
  for (const entry of entries) {
    const record = Buffer.alloc(8)
    record.write(entry.type, 0, 4, 'ascii')
    record.writeUInt32BE(entry.png.length + 8, 4)
    chunks.push(record, entry.png)
    total += entry.png.length + 8
  }
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(total, 4)
  return Buffer.concat([header, ...chunks])
}

async function main() {
  const fullSvg = readFileSync(SVG_FULL, 'utf8')
  const smallSvg = readFileSync(SVG_SMALL, 'utf8')

  const rasterWindow = new BrowserWindow({ show: false, width: 512, height: 512 })
  // executeJavaScript only settles once the frame has a loaded document; without
  // this navigation every call below would pend forever.
  await rasterWindow.loadURL('data:text/html,<html><body></body></html>')

  const sources = (size) => (size <= 32 ? smallSvg : fullSvg)
  const rendered = new Map()
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    rendered.set(size, await rasterize(rasterWindow, sources(size), size))
  }
  rasterWindow.destroy()

  const png1024 = rendered.get(1024)
  const corner = nativeImage.createFromBuffer(png1024).toBitmap()
  if (corner[3] !== 0) fail('1024px raster lost the transparent corner (alpha != 0)')

  mkdirSync(BUILD_DIR, { recursive: true })
  const iconPng = join(BUILD_DIR, 'icon.png')
  const iconIco = join(BUILD_DIR, 'icon.ico')
  const iconIcns = join(BUILD_DIR, 'icon.icns')

  writeFileSync(iconPng, png1024)
  writeFileSync(
    iconIco,
    encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: rendered.get(size) })))
  )
  writeFileSync(
    iconIcns,
    encodeIcns(
      [
        ['icp4', 16],
        ['icp5', 32],
        ['icp6', 64],
        ['ic07', 128],
        ['ic08', 256],
        ['ic09', 512],
        ['ic10', 1024]
      ].map(([type, size]) => ({ type, png: rendered.get(size) }))
    )
  )

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
  console.log(`brand: icon.png  ${kb(png1024.length)} (1024px)`)
  console.log(`brand: icon.ico  ${kb(readFileSync(iconIco).length)} (7 sizes)`)
  console.log(`brand: icon.icns ${kb(readFileSync(iconIcns).length)} (7 sizes)`)
  console.log(`brand: written to ${BUILD_DIR}`)

  app.exit(0)
}
