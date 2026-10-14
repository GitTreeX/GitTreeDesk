#!/usr/bin/env node
// Measures the release performance budgets against the generated acme fixture:
// tree first frame, status warm-up, per-read latency, fingerprint skip cost, and RSS.
// Drives a built app through an isolated profile and the Chrome DevTools protocol.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const desktopDir = join(repoRoot, 'apps', 'desktop')
const fixtureRoot = join(repoRoot, '.fixtures', 'acme')
const profileDir = join(repoRoot, '.fixtures', 'perf-profile')
const entry = join(desktopDir, 'out', 'main', 'index.js')
const port = 9333

const BUDGETS = {
  treeMs: 3000,
  warmMs: 15000,
  p50Ms: 300,
  p95Ms: 800,
  skipMs: 5,
  rssMb: 600
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function fail(message) {
  console.error(`perf-budget: ${message}`)
  process.exit(1)
}

if (!existsSync(fixtureRoot)) fail('fixture missing — run `pnpm fixture` first')
if (!existsSync(entry)) fail('build missing — run `pnpm build` first')

const electronPath = createRequire(join(desktopDir, 'package.json'))('electron')

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

async function main() {
  const wsRoot = seedProfile()
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: wsRoot,
    budgets: BUDGETS,
    runs: {},
    fingerprint: {},
    checks: {}
  }

  const cold = await runOnce('cold', wsRoot, report)
  const warm = await runOnce('warm', wsRoot, report)
  report.fingerprint['app/mobile-app'] = await fingerprintBench(join(wsRoot, 'app', 'mobile-app'))
  report.fingerprint['labs/history-lab'] = await fingerprintBench(join(wsRoot, 'labs', 'history-lab'))

  report.checks = {
    'tree ≤3.0s': Math.max(cold.treeMs, warm.treeMs) <= BUDGETS.treeMs,
    'warm ≤15s': cold.warmMs !== null && cold.warmMs <= BUDGETS.warmMs,
    'p50 ≤300ms': cold.p50Ms !== null && cold.p50Ms <= BUDGETS.p50Ms,
    'p95 ≤800ms': cold.p95Ms !== null && cold.p95Ms <= BUDGETS.p95Ms,
    'skip ≤5ms': Math.max(...Object.values(report.fingerprint).map((entry) => entry.p95Ms)) <= BUDGETS.skipMs,
    'rss ≤600MB': cold.rssMb <= BUDGETS.rssMb
  }

  writeFileSync(join(profileDir, 'perf-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  const failed = Object.entries(report.checks).filter(([, ok]) => !ok)
  if (failed.length > 0) {
    console.error(`budget misses: ${failed.map(([name]) => name).join(', ')}`)
    process.exitCode = 1
  }
}

async function runOnce(label, wsRoot, report) {
  const child = spawn(
    electronPath,
    [entry, `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`],
    { cwd: desktopDir, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  let stderrTail = ''
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-2000)
  })

  const result = { label }
  try {
    const wsUrl = await waitForTarget(30000)
    const cdp = await connect(wsUrl)
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

    const recentSelector = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('.fixtures/acme'))`
    const recentDeadline = Date.now() + 30000
    while (Date.now() < recentDeadline) {
      if (await evaluate(`${recentSelector} !== undefined`)) break
      await sleep(100)
    }
    if (!(await evaluate(`${recentSelector} !== undefined`))) throw new Error('recent workspace not listed')

    const clicked = await evaluate(`(() => { const b = ${recentSelector}; b.click(); return true })()`)
    if (clicked !== true) throw new Error('recent click failed')
    const started = performance.now()

    let titleMs = null
    let treeMs = null
    const treeDeadline = Date.now() + 30000
    while (Date.now() < treeDeadline && treeMs === null) {
      const state = await evaluate(
        `({ title: document.title, items: document.querySelectorAll('[role="treeitem"]').length })`
      )
      const elapsed = performance.now() - started
      if (titleMs === null && state.title.includes('acme')) titleMs = round(elapsed)
      if (state.items > 0) treeMs = round(elapsed)
      if (treeMs === null) await sleep(25)
    }
    if (treeMs === null) throw new Error('tree never rendered')
    result.titleMs = titleMs
    result.treeMs = treeMs

    const stats = await waitForWarm(evaluate)
    // A cache-first open defers the fresh discovery to the background: give its scan
    // stat a bounded window to land before recording the snapshot.
    const settled = (await waitForScan(evaluate, 60000)) ?? stats
    result.warmMs = settled.warm?.ms ?? null
    result.scanMs = settled.scan.lastMs
    result.scanRepos = settled.scan.lastRepos
    result.p50Ms = settled.status.p50
    result.p95Ms = settled.status.p95
    result.samples = settled.status.samples
    result.skips = settled.status.skips
    result.watchers = settled.watchers
    result.ops = settled.ops

    await sleep(5000)
    const rss = rssOf(child.pid)
    result.rssMb = round(rss.totalBytes / (1024 * 1024))
    result.rssBreakdown = rss.breakdown
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(profileDir, `${label}-open.png`), Buffer.from(shot.data, 'base64'))
    cdp.close()
  } catch (error) {
    console.error(`[${label}] ${String(error)}`)
    console.error(stderrTail)
    throw error
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done()
      child.once('exit', done)
      setTimeout(done, 5000)
    })
    await sleep(500)
  }

  report.runs[label] = result
  return result
}

async function waitForWarm(evaluate) {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const envelope = await evaluate(`window.gtd.invokeRaw('app:perfStats', undefined)`)
    if (envelope?.ok === true && envelope.value.warm !== null) return envelope.value
    await sleep(500)
  }
  throw new Error('status warm-up did not complete')
}

/** Latest snapshot once a full scan has been recorded; null when none lands in time. */
async function waitForScan(evaluate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const envelope = await evaluate(`window.gtd.invokeRaw('app:perfStats', undefined)`)
    if (envelope?.ok === true && envelope.value.scan.lastMs !== null) return envelope.value
    await sleep(500)
  }
  return null
}

/** Cost of the scheduler's fingerprint probe: the work a skipped poll performs. */
async function fingerprintBench(repoPath) {
  const gitDir = join(repoPath, '.git')
  const worktreeStamps = [
    'index',
    'HEAD',
    'ORIG_HEAD',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
    'rebase-merge',
    'rebase-apply'
  ]
  const commonStamps = ['refs', 'packed-refs', join('logs', 'refs', 'stash')]
  const stamp = async (path) => {
    try {
      const info = await stat(path)
      return `${String(info.mtimeMs)}:${String(info.size)}`
    } catch {
      return '-'
    }
  }
  const once = async () => {
    const stamps = []
    for (const name of worktreeStamps) stamps.push(await stamp(join(gitDir, name)))
    for (const name of commonStamps) stamps.push(await stamp(join(gitDir, name)))
    return stamps.join('|')
  }

  await once()
  const samples = []
  for (let i = 0; i < 100; i += 1) {
    const started = performance.now()
    await once()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return {
    p50Ms: round(samples[49] ?? 0),
    p95Ms: round(samples[94] ?? 0)
  }
}

function rssOf(pid) {
  const script = [
    '$all = Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ParentProcessId, WorkingSetSize',
    "$ids = New-Object 'System.Collections.Generic.HashSet[int]'",
    "$queue = New-Object 'System.Collections.Generic.Queue[int]'",
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
  const breakdown = lines.slice(1).map((line) => {
    const [name, processId, bytes] = line.split('|')
    return { name, pid: Number(processId), mb: round(Number(bytes) / (1024 * 1024)) }
  })
  return { totalBytes: Number.isFinite(total) ? total : 0, breakdown }
}

function round(value) {
  return Math.round(value * 10) / 10
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
