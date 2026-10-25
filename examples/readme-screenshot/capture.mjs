#!/usr/bin/env node
// Drives the built GitTreeDesk app over CDP to render the README screenshot.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const desktopDir = join(repoRoot, 'apps', 'desktop')
const fixtureRoot = join(repoRoot, '.fixtures', 'readme-screenshot', 'workspace')
const profileDir = join(repoRoot, '.fixtures', 'readme-screenshot', 'profile')
const outputPath = join(repoRoot, 'docs', 'images', 'gitreedesk-workspace.png')
const entry = join(desktopDir, 'out', 'main', 'index.js')
const port = 9411
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

if (!existsSync(entry)) {
  console.error('desktop build missing — run `pnpm build` first')
  process.exit(1)
}

console.log('generating demo workspace…')
execFileSync(process.execPath, [join(scriptDir, 'generate-workspace.mjs'), '--out', fixtureRoot], {
  cwd: repoRoot,
  stdio: 'inherit'
})

rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
const Database = createRequire(join(repoRoot, 'packages', 'store', 'package.json'))('better-sqlite3')
const db = new Database(join(profileDir, 'cache.db'))
db.exec(
  `CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root TEXT NOT NULL UNIQUE,
    name TEXT,
    last_opened_at INTEGER,
    trusted INTEGER NOT NULL DEFAULT 0
  )`
)
db.prepare(
  `INSERT INTO workspaces (root, name, last_opened_at, trusted) VALUES (?, ?, ?, 1)
   ON CONFLICT(root) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at, trusted = 1`
).run(realpathSync(fixtureRoot).replace(/\\/g, '/'), 'Northstar Platform', Date.now())
db.close()

const electronPath = createRequire(join(desktopDir, 'package.json'))('electron')
const electronEnv = { ...process.env }
delete electronEnv.ELECTRON_RUN_AS_NODE
const child = spawn(electronPath, [entry, `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], {
  cwd: desktopDir,
  stdio: ['ignore', 'ignore', 'pipe'],
  env: electronEnv
})
let tail = ''
child.stderr.on('data', (chunk) => {
  tail = (tail + String(chunk)).slice(-3000)
})

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await sleep(200)
  }
  throw new Error('CDP target not found')
}

function connect(wsUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    ws.onopen = () =>
      resolvePromise({
        send: (method, params = {}) =>
          new Promise((resolveSend, rejectSend) => {
            const id = nextId
            nextId += 1
            pending.set(id, { resolveSend, rejectSend })
            ws.send(JSON.stringify({ id, method, params }))
          }),
        close: () => ws.close()
      })
    ws.onerror = () => rejectPromise(new Error('CDP websocket failed'))
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error) entry.rejectSend(new Error(message.error.message))
      else entry.resolveSend(message.result)
    }
  })
}

async function main() {
  const wsUrl = await waitForTarget(60000)
  const cdp = await connect(wsUrl)
  const evaluate = async (expression) => {
    const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails !== undefined) throw new Error(`page error: ${response.exceptionDetails.text}`)
    return response.result.value
  }
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  // Use a roomier window than the 1440×900 default so the repository list and
  // both diff panes have space.
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width: 1590, height: 900, windowState: 'normal' }
    })
    await sleep(700)
  } catch {
    // Keep the default size if the platform refuses the resize.
  }

  const waitFor = async (expression, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return true
      await sleep(200)
    }
    throw new Error(`${label} never appeared`)
  }
  const click = (selector) => `(() => { const el = ${selector}; if (!el) return false; el.click(); return true })()`

  const recent = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('.fixtures/readme-screenshot'))`
  await waitFor(`${recent} !== undefined`, 60000, 'recent workspace row')
  await evaluate(click(recent))
  await waitFor(`document.querySelectorAll('[role="treeitem"]').length > 0`, 90000, 'workspace tree')

  await evaluate(click(`document.querySelector('button[aria-label="Source Control"]')`))
  await waitFor(`document.querySelectorAll('[role="treeitem"]').length > 0`, 30000, 'scm rows')

  // Widen the sidebar so repository sections and paths breathe.
  await evaluate(`(() => {
    const separator = document.querySelector('[role="separator"][aria-orientation="vertical"]')
    if (!separator) return false
    const rect = separator.getBoundingClientRect()
    const point = { clientX: rect.left + 2, clientY: rect.top + 240 }
    separator.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...point, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: point.clientX + 70, clientY: point.clientY, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: point.clientX + 70, clientY: point.clientY, pointerId: 1 }))
    return true
  })()`)
  await sleep(500)

  // Pin two diffs so the editor tab strip shows a real working session.
  const openRow = async (suffix) => {
    const row = `[...document.querySelectorAll('[role="treeitem"]')].find((el) => (el.title ?? '').endsWith(${JSON.stringify(suffix)}))`
    await waitFor(`${row} !== undefined`, 30000, `${suffix} row`)
    await evaluate(`(() => {
      const target = ${row}
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }))
      return true
    })()`)
    await waitFor(`document.querySelectorAll('.monaco-diff-editor .view-line').length > 0`, 30000, `${suffix} diff`)
    await sleep(900)
  }
  await openRow('internal/pricing/totals.ts')
  await openRow('internal/pricing/discounts.ts')
  await waitFor(`document.body.innerText.includes('discounts.ts')`, 10000, 'discounts tab')
  await sleep(1000)

  // Back to the tree panel, on the Repos tab: repository groups and branch badges
  // sit next to the diff that is already open.
  await evaluate(click(`document.querySelector('button[aria-label="Explorer"]')`))
  await sleep(400)
  const repoTab = `[...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent.trim() === 'Repos')`
  await waitFor(`${repoTab} !== undefined`, 15000, 'Repos tab')
  await evaluate(click(repoTab))
  await waitFor(`document.querySelectorAll('[role="treeitem"]').length >= 8`, 30000, 'repository rows')
  await sleep(1200)

  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, Buffer.from(result.data, 'base64'))
  console.log(`saved ${outputPath}`)
  cdp.close()
}

try {
  await main()
} catch (error) {
  console.error(`readme screenshot: ${error instanceof Error ? error.message : String(error)}`)
  if (tail.trim() !== '') console.error(tail)
  process.exitCode = 1
} finally {
  child.kill()
  await sleep(800)
  try {
    rmSync(profileDir, { recursive: true, force: true })
  } catch {
    // Windows may still hold Electron profile files; they live in .fixtures/ anyway.
  }
}
