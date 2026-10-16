#!/usr/bin/env node
// Measures the commit-graph release budgets against a single-repo scale fixture: first page paint,
// streamed page cost, frame pacing with thousands of loaded rows, the huge-repo window, and RSS.
// The fixture is a local clone of the generated acme repository with ~10 000 commits, so graph
// cost is measured without 55 concurrent status polls competing for the same machine.
// Drives a built app through an isolated profile and the Chrome DevTools protocol.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const desktopDir = join(repoRoot, 'apps', 'desktop')
const sourceRepo = join(repoRoot, '.fixtures', 'acme', 'labs', 'history-lab')
const scaleRoot = join(repoRoot, '.fixtures', 'scale-ws')
const profileDir = join(repoRoot, '.fixtures', 'graph-profile')
const entry = join(desktopDir, 'out', 'main', 'index.js')
const port = 9334

/** Loaded history stays windowed; the graph stops at the newest commits and says so. */
const WINDOW = 10_000
const SMOOTH_AT = 5_000
const BUDGETS = {
  firstPaintMs: 1500,
  chunkMs: 500,
  /** 60 fps pacing allows a little slack over the 16.7 ms frame. */
  pacingP95Ms: 20,
  windowLoaded: WINDOW,
  rssMb: 600
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const round = (value) => Math.round(value * 10) / 10

function fail(message) {
  console.error(`perf-graph: ${message}`)
  process.exit(1)
}

if (!existsSync(entry)) fail('build missing — run `pnpm build` first')

const electronPath = createRequire(join(desktopDir, 'package.json'))('electron')
const Database = createRequire(join(repoRoot, 'packages', 'store', 'package.json'))('better-sqlite3')

/** Fresh single-repo workspace: a local clone of the fixture's long-history repository. */
function buildScaleWorkspace() {
  if (!existsSync(join(sourceRepo, '.git'))) {
    fail(`${sourceRepo} missing — run \`pnpm fixture\` first (it generates acme with a long-history lab)`)
  }
  rmSync(scaleRoot, { recursive: true, force: true })
  mkdirSync(scaleRoot, { recursive: true })
  const clone = spawnSync('git', ['clone', '--quiet', sourceRepo, join(scaleRoot, 'history-lab')], {
    encoding: 'utf8'
  })
  if (clone.status !== 0) fail(`clone failed: ${clone.stderr}`)
  const count = Number(
    spawnSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: join(scaleRoot, 'history-lab'),
      encoding: 'utf8'
    }).stdout.trim()
  )
  if (!(count >= WINDOW)) fail(`scale fixture has ${String(count)} commits, expected at least ${String(WINDOW)}`)
  return count
}

/** Isolated profile with the scale workspace pre-seeded as a trusted recent. */
function seedProfile(root) {
  rmSync(profileDir, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })
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
    `INSERT INTO workspaces (root, name, last_opened_at, trusted) VALUES (?, ?, ?, 1)`
  ).run(realpathSync(scaleRoot).replace(/\\/g, '/'), 'scale-ws', Date.now())
  db.close()
}

let cdp = null
let child = null
let stderrTail = ''

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
      const entry2 = pending.get(message.id)
      if (entry2 === undefined) return
      pending.delete(message.id)
      if (message.error) entry2.rejectSend(new Error(message.error.message))
      else entry2.resolveSend(message.result)
    }
  })
}

async function launch() {
  child = spawn(
    electronPath,
    [entry, `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`],
    { cwd: desktopDir, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-4000)
  })
  const deadline = Date.now() + 60_000
  while (true) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page !== undefined) {
        cdp = await connect(page.webSocketDebuggerUrl)
        await cdp.send('Runtime.enable')
        return
      }
    } catch {
      // devtools endpoint not up yet
    }
    if (Date.now() > deadline) fail(`CDP target not found\n${stderrTail}`)
    await sleep(200)
  }
}

async function evaluate(expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails !== undefined) throw new Error(`page error: ${response.exceptionDetails.text}`)
  return response.result.value
}

function stop() {
  cdp?.close()
  cdp = null
  if (child !== null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  child = null
}

/**
 * The visible graph panel is found through its footer commit count; rows are absolutely
 * positioned children of the virtualizer's scroll container.
 */
const PANEL = `(() => {
  const footer = [...document.querySelectorAll('footer')].find((f) => /commits/.test(f.textContent) && f.offsetParent !== null)
  if (footer === undefined) return null
  const panel = footer.parentElement
  const scroller = panel.querySelector('div.overflow-auto')
  return { footer, panel, scroller }
})()`

const READ_STATE = `(() => {
  const found = ${PANEL}
  if (found === null) return null
  const text = found.footer.lastElementChild?.textContent ?? ''
  const count = Number((text.match(/[0-9]+/) ?? ['0'])[0].replace(/[^0-9]/g, ''))
  return {
    loaded: Number.isFinite(count) ? count : 0,
    rows: found.scroller.querySelectorAll('div[style*="translateY"]').length,
    height: found.scroller.scrollHeight,
    loadingMore: /Loading older/.test(found.footer.textContent)
  }
})()`

async function readState() {
  return await evaluate(READ_STATE)
}

async function openWorkspace() {
  const button = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('.fixtures/scale-ws'))`
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    if (await evaluate(`${button} !== undefined`)) break
    await sleep(200)
  }
  await evaluate(`(() => { const b = ${button}; b.click(); return true })()`)
  const treeDeadline = Date.now() + 60_000
  while (Date.now() < treeDeadline) {
    if ((await evaluate(`document.querySelectorAll('[role="treeitem"]').length`)) > 0) return
    await sleep(100)
  }
  throw new Error('tree never rendered')
}

/** Opens the repository's graph from its Explorer row menu and returns the click timestamp. */
async function openGraphOfRepo(name) {
  const row = `[...document.querySelectorAll('[role="treeitem"]')].filter((el) => el.textContent.includes(${JSON.stringify(name)})).pop()`
  const presentDeadline = Date.now() + 30_000
  while (Date.now() < presentDeadline) {
    if (await evaluate(`${row} !== undefined`)) break
    // Explorer rows expand through their chevron; a plain click only moves the cursor.
    await evaluate(`(() => {
      for (const el of [...document.querySelectorAll('[role="treeitem"][aria-expanded="false"]')].filter((r) => r.offsetParent !== null)) {
        const chevron = el.querySelector('button')
        if (chevron !== null) chevron.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      }
      return true
    })()`)
    await sleep(300)
  }
  if (!(await evaluate(`${row} !== undefined`))) throw new Error(`tree row not found: ${name}`)
  const box = await evaluate(
    `(() => { const r = ${row}.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 } })()`
  )
  await evaluate(
    `(() => { ${row}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ${String(box.x)}, clientY: ${String(box.y)} })); return true })()`
  )
  await sleep(200)
  await evaluate(
    `(() => { ${row}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${String(box.x)}, clientY: ${String(box.y)} })); return true })()`
  )
  const item = `[...document.querySelectorAll('button, [role="menuitem"]')].find((el) => el.textContent.includes('Open Commit Graph') && el.offsetParent !== null)`
  if (!(await evaluate(`${item} !== undefined`))) throw new Error('graph menu item missing')
  // Timed inside the same evaluate as the click, so the number marks when the app receives
  // the open-graph action rather than the end of a devtools round trip.
  return await evaluate(`(() => { const t = Date.now(); ${item}.click(); return t })()`)
}

/** Main-process op samples split first paint into the git read and everything around it. */
async function graphOpMs() {
  const summary = await evaluate(`(async () => {
    const result = await window.gtd.invokeRaw('app:perfStats', undefined)
    if (result.ok !== true) return []
    return result.value.ops.filter((o) => o.channel === 'git:graph').map((o) => ({ ms: o.ms, at: o.at, ok: o.ok }))
  })()`)
  return summary.at(-1) ?? null
}

async function scrollToEnd() {
  await evaluate(`(() => { const found = ${PANEL}; found.scroller.scrollTop = found.scroller.scrollHeight; return true })()`)
}

/** Scroll to the bottom until the loaded count stops growing, timing each streamed chunk. */
async function streamHistory(untilLoaded) {
  const chunks = []
  for (let guard = 0; guard < 60; guard += 1) {
    const before = await readState()
    if (before === null) throw new Error('graph panel disappeared')
    if (before.loaded >= untilLoaded) break
    await scrollToEnd()
    const started = Date.now()
    const deadline = Date.now() + 90_000
    let after = before
    while (Date.now() < deadline) {
      after = await readState()
      if (after.loaded > before.loaded && !after.loadingMore) break
      await sleep(120)
    }
    const delta = after.loaded - before.loaded
    if (delta <= 0) break
    chunks.push({ loaded: after.loaded, delta, ms: Date.now() - started, rows: after.rows })
    if (after.loaded >= untilLoaded) break
  }
  return chunks
}

/** Frame pacing while a wheel-length scroll runs through an already-loaded graph. */
async function measureScrollPacing() {
  return await evaluate(`(async () => {
    const found = ${PANEL}
    const scroller = found.scroller
    scroller.scrollTop = Math.floor(scroller.scrollHeight / 3)
    await new Promise((done) => requestAnimationFrame(done))
    const deltas = []
    let last = await new Promise((done) => requestAnimationFrame(done))
    for (let frame = 0; frame < 120; frame += 1) {
      const now = await new Promise((done) => requestAnimationFrame(done))
      deltas.push(now - last)
      last = now
      scroller.scrollTop += 90
    }
    const sorted = [...deltas].sort((a, b) => a - b)
    return {
      frames: deltas.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      worst: sorted[sorted.length - 1]
    }
  })()`)
}

function rssOf(pid) {
  const script = [
    '$all = Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ParentProcessId, WorkingSetSize',
    "$ids = New-Object 'System.Collections.Generic.HashSet[int]'",
    '$queue = New-Object "System.Collections.Generic.Queue[int]"',
    `$queue.Enqueue(${String(pid)})`,
    'while ($queue.Count -gt 0) {',
    '  $current = $queue.Dequeue()',
    '  [void]$ids.Add($current)',
    '  foreach ($child in $all) { if ($child.ParentProcessId -eq $current) { $queue.Enqueue($child.ProcessId) } }',
    '}',
    '($all | Where-Object { $ids.Contains($_.ProcessId) } | Measure-Object WorkingSetSize -Sum).Sum',
    '$all | Where-Object { $ids.Contains($_.ProcessId) } | Sort-Object WorkingSetSize -Descending |',
    '  ForEach-Object { "$($_.Name)|$($_.ProcessId)|$($_.WorkingSetSize)" }'
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const output = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8'
  })
  const lines = (output.stdout ?? '').trim().split(/\r?\n/)
  const total = Number(lines[0] ?? '')
  return {
    totalBytes: Number.isFinite(total) ? total : 0,
    breakdown: lines.slice(1).map((line) => {
      const [name, processId, bytes] = line.split('|')
      return { name, pid: Number(processId), mb: round(Number(bytes) / (1024 * 1024)) }
    })
  }
}

async function main() {
  const commits = buildScaleWorkspace()
  seedProfile()
  await launch()
  await openWorkspace()

  const baseline = rssOf(child.pid)
  const clickedAt = await openGraphOfRepo('history-lab')

  let first = null
  const paintDeadline = Date.now() + 60_000
  while (Date.now() < paintDeadline && first === null) {
    const state = await readState()
    if (state !== null && state.rows > 0 && state.loaded > 0) first = state
    else await sleep(25)
  }
  if (first === null) throw new Error('graph never painted')
  const paintedAt = Date.now()
  const op = await graphOpMs()

  const chunks = await streamHistory(SMOOTH_AT)
  const pacing = await measureScrollPacing()
  const rest = await streamHistory(commits)
  const finalState = await readState()
  await sleep(2_000)
  const rss = rssOf(child.pid)

  const firstPaintMs = paintedAt - clickedAt
  const worstChunkMs = Math.max(...[...chunks, ...rest].map((chunk) => chunk.ms))
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: realpathSync(scaleRoot).replace(/\\/g, '/'),
    commitsInHistory: commits,
    budgets: BUDGETS,
    firstPaintMs,
    gitGraphMs: op?.ms ?? null,
    streamedChunks: [...chunks, ...rest],
    worstChunkMs,
    pacingAtSmoothRows: {
      rows: SMOOTH_AT,
      p50: round(pacing.p50),
      p95: round(pacing.p95),
      worst: round(pacing.worst)
    },
    loaded: finalState.loaded,
    domRows: finalState.rows,
    contentHeightPx: finalState.height,
    rssMb: round(rss.totalBytes / (1024 * 1024)),
    idleRssMb: round(baseline.totalBytes / (1024 * 1024))
  }

  report.checks = {
    'graph first paint ≤1.5s': firstPaintMs <= BUDGETS.firstPaintMs,
    'streamed page ≤500ms': worstChunkMs <= BUDGETS.chunkMs,
    'scroll pacing p95 ≤20ms': pacing.p95 <= BUDGETS.pacingP95Ms,
    'window caps at 10 000': finalState.loaded === WINDOW,
    'rss ≤600MB': report.rssMb <= BUDGETS.rssMb
  }

  writeFileSync(join(profileDir, 'graph-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  const failed = Object.entries(report.checks).filter(([, ok]) => !ok)
  if (failed.length > 0) {
    console.error(`budget misses: ${failed.map(([name]) => name).join(', ')}`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(`perf-graph: ${String(error)}`)
    console.error(stderrTail)
    process.exitCode = 1
  })
  .finally(() => {
    stop()
  })
