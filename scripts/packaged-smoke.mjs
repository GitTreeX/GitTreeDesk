#!/usr/bin/env node
// Boots the packaged Windows build with an isolated profile, opens the acme
// fixture workspace through the recent list, and asserts over the Chrome
// DevTools protocol that the window, tree, and the native-module services come
// up. Also gates the installer size budget and checks that the unpacked native
// binaries shipped.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const releaseDir = join(repoRoot, 'release')
const unpackedDir = join(releaseDir, 'win-unpacked')
const appExe = join(unpackedDir, 'GitTreeDesk.exe')
const fixtureRoot = join(repoRoot, '.fixtures', 'acme')
const profileDir = join(repoRoot, '.fixtures', 'packaged-profile')
const port = 9336

const installerBudgetMb = 130
const expectedRepos = 57

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function fail(message) {
  console.error(`packaged-smoke: ${message}`)
  process.exit(1)
}

if (process.platform !== 'win32') fail('the packaged smoke targets the Windows build')
if (!existsSync(appExe)) fail('packaged build missing — run `pnpm package:win` first')
if (!existsSync(fixtureRoot)) fail('fixture missing — run `pnpm fixture` first')

function findArtifact(pattern) {
  const name = readdirSync(releaseDir).find((file) => pattern.test(file))
  return name === undefined ? null : join(releaseDir, name)
}

function mb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

/** Fresh isolated profile with the fixture pre-seeded as a trusted recent workspace. */
function seedProfile() {
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
  const root = realpathSync(fixtureRoot).replace(/\\/g, '/')
  db.prepare(
    `INSERT INTO workspaces (root, name, last_opened_at, trusted) VALUES (?, ?, ?, 1)
     ON CONFLICT(root) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at, trusted = 1`
  ).run(root, 'acme', Date.now())
  db.close()
  return root
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      // devtools endpoint not up yet
    }
    await sleep(150)
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

async function drive(child, bornAt) {
  const result = {
    recentReadyMs: null,
    titleMs: null,
    treeMs: null,
    treeItems: 0,
    scanMs: null,
    warmMs: null,
    statusP50Ms: null,
    statusP95Ms: null,
    platform: null,
    versions: null,
    scanRepos: null,
    watchers: null
  }
  const wsUrl = await waitForTarget(30000)
  const cdp = await connect(wsUrl)
  try {
    const evaluate = async (expression) => {
      const response = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      })
      if (response.exceptionDetails !== undefined) {
        throw new Error(`page error: ${response.exceptionDetails.text}`)
      }
      return response.result.value
    }
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    result.platform = await evaluate('window.gtd.platform')
    result.versions = await evaluate('window.gtd.versions')

    const recentSelector = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('.fixtures/acme'))`
    const recentDeadline = Date.now() + 30000
    while (Date.now() < recentDeadline) {
      if (await evaluate(`${recentSelector} !== undefined`)) break
      await sleep(100)
    }
    if (!(await evaluate(`${recentSelector} !== undefined`))) throw new Error('recent workspace not listed')
    result.recentReadyMs = Math.round(performance.now() - bornAt)
    await evaluate(`(() => { ${recentSelector}.click(); return true })()`)
    const started = performance.now()

    const treeDeadline = Date.now() + 30000
    while (Date.now() < treeDeadline && result.treeMs === null) {
      const state = await evaluate(
        `({ title: document.title, items: document.querySelectorAll('[role="treeitem"]').length })`
      )
      const elapsed = performance.now() - started
      if (result.titleMs === null && state.title.includes('acme')) result.titleMs = Math.round(elapsed)
      if (state.items > 0) {
        result.treeMs = Math.round(elapsed)
        result.treeItems = state.items
      }
      if (result.treeMs === null) await sleep(25)
    }
    if (result.treeMs === null) throw new Error('tree never rendered')

    const warmDeadline = Date.now() + 90000
    let snapshot = null
    while (Date.now() < warmDeadline) {
      const envelope = await evaluate(`window.gtd.invokeRaw('app:perfStats', undefined)`)
      if (envelope?.ok === true && envelope.value.warm !== null) {
        snapshot = envelope.value
        break
      }
      await sleep(500)
    }
    if (snapshot === null) throw new Error('status warm-up did not complete')
    result.scanRepos = snapshot.scan.lastRepos
    result.scanMs = snapshot.scan.lastMs
    result.warmMs = snapshot.warm?.ms ?? null
    result.statusP50Ms = snapshot.status.p50
    result.statusP95Ms = snapshot.status.p95
    result.watchers = snapshot.watchers

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(profileDir, 'packaged-open.png'), Buffer.from(shot.data, 'base64'))
  } finally {
    cdp.close()
  }
  return result
}

async function main() {
  const installer = findArtifact(/^GitTreeDesk-.*-setup\.exe$/)
  const zip = findArtifact(/^GitTreeDesk-.*-win\.zip$/)
  const artifactsMb = {
    installer: installer === null ? null : mb(statSync(installer).size),
    zip: zip === null ? null : mb(statSync(zip).size)
  }

  seedProfile()
  const bornAt = performance.now()
  const child = spawn(appExe, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`], {
    cwd: unpackedDir,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderrTail = ''
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-2000)
  })

  let runtime = null
  try {
    runtime = await drive(child, bornAt)
  } catch (error) {
    console.error(`[smoke] ${String(error)}`)
    console.error(stderrTail)
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done()
      child.once('exit', done)
      setTimeout(done, 5000)
    })
    await sleep(500)
  }

  const checks = {
    'window titled acme': runtime !== null && runtime.titleMs !== null,
    'tree rendered': runtime !== null && runtime.treeMs !== null && runtime.treeItems > 0,
    'platform win32': runtime !== null && runtime.platform === 'win32',
    [`discovered ${String(expectedRepos)} repos`]: runtime !== null && runtime.scanRepos === expectedRepos,
    'watchers subscribed': runtime !== null && runtime.watchers !== null && runtime.watchers.subscribed > 0,
    'node-pty prebuild unpacked': existsSync(
      join(unpackedDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'pty.node')
    ),
    [`installer ≤${String(installerBudgetMb)}MB`]:
      artifactsMb.installer !== null && artifactsMb.installer <= installerBudgetMb
  }

  const report = {
    generatedAt: new Date().toISOString(),
    artifactsMb,
    runtime,
    checks
  }
  writeFileSync(join(profileDir, 'smoke-report.json'), JSON.stringify(report, null, 2))

  for (const [name, ok] of Object.entries(checks)) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  }
  console.log(
    `installer ${String(artifactsMb.installer)} MB · zip ${String(artifactsMb.zip)} MB · ` +
      `repos ${String(runtime?.scanRepos)} · watchers ${String(runtime?.watchers?.subscribed)}`
  )
  console.log(
    `recent list ${String(runtime?.recentReadyMs)} ms · window ${String(runtime?.titleMs)} ms · ` +
      `tree ${String(runtime?.treeMs)} ms · scan ${String(runtime?.scanMs)} ms · ` +
      `warm ${String(runtime?.warmMs)} ms · p50 ${String(runtime?.statusP50Ms)} ms`
  )
  console.log(`screenshot: ${join(profileDir, 'packaged-open.png')}`)

  if (Object.values(checks).some((ok) => !ok)) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
