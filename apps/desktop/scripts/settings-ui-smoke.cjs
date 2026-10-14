/**
 * End-to-end UI check for the Settings view: launches the real app on an
 * isolated user-data dir and a temp workspace, then drives it over the Chrome
 * DevTools Protocol — open from the activity bar gear, verify the grouped
 * surface, search filtering, a live density change (Explorer rows shrink),
 * a live accent change, copy-to-workspace / reset-to-user scope transitions,
 * and a numeric commit through the Git group. A screenshot is saved for
 * visual review. Run after `pnpm build`:
 *
 *   node scripts/settings-ui-smoke.cjs
 */
const { spawn, spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const PORT = 9334
const electronPath = require('electron')

const baseDir = mkdtempSync(join(tmpdir(), 'gtd-settings-smoke-'))
const workspaceDir = join(baseDir, 'smoke-workspace')
const userDataDir = join(baseDir, 'user-data')
const logPath = join(baseDir, 'app.log')
const shotPath = join(baseDir, 'settings-view.png')

let child = null
let ws = null
let log = ''
let nextId = 1
let exiting = false
const pending = new Map()

function fail(message) {
  process.stdout.write(`SMOKE FAIL: ${message}\n`)
  if (log.length > 0) process.stdout.write(`--- app log ---\n${log.slice(-4000)}\n`)
  shutdown(1)
}

function shutdown(code) {
  exiting = true
  try {
    ws?.close()
  } catch {
    // already closed
  }
  if (child !== null && child.pid !== undefined) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('uncaughtException', (error) => fail(error.stack ?? String(error)))
process.on('unhandledRejection', (error) => fail(String(error)))

const failsafe = setTimeout(() => fail('failsafe timeout'), 180_000)

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params: params ?? {} }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails !== undefined) {
    throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result?.value
}

async function until(label, fn, timeoutMs = 15_000) {
  const started = Date.now()
  for (;;) {
    let value
    try {
      value = await fn()
    } catch {
      value = false
    }
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Row scope badge/button helpers, scoped to the row owning a settings key. */
const rowExpr = (key) => `document.querySelector('[title=${JSON.stringify(key)}]')?.closest('div[class*="items-start"]')`
/** Counts visible setting rows by their mono key divs, scoped to the settings view. */
const keyCountExpr = (n) =>
  `[...document.querySelectorAll('div.font-mono[title]')].filter((el) => el.closest('div.mx-auto') !== null).length === ${n}`
const badgeExpr = (key) => `(() => {
  const row = ${rowExpr(key)}
  if (row === undefined || row === null) return null
  const spans = [...row.querySelectorAll('span')].map((el) => el.textContent.trim())
  return spans.includes('Workspace') ? 'workspace' : spans.includes('User') ? 'user' : null
})()`
const buttonExpr = (key, label) => `(() => {
  const row = ${rowExpr(key)}
  if (row === undefined || row === null) return false
  const button = [...row.querySelectorAll('button')].find((el) => el.textContent.trim() === ${JSON.stringify(label)})
  if (button === undefined) return false
  button.click()
  return true
})()`

/** Sets a select/input value through the native setter so React sees the change. */
const selectExpr = (key, selector, value) => `(() => {
  const row = ${rowExpr(key)}
  const el = row?.querySelector(${JSON.stringify(selector)})
  if (el === undefined || el === null) return false
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  return true
})()`

async function fetchTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await response.json()
  return targets.find((target) => target.type === 'page' && target.url.includes('index.html'))
}

async function main() {
  mkdirSync(join(workspaceDir, '.gitreedesk'), { recursive: true })
  const repoDir = join(workspaceDir, 'repo-one')
  mkdirSync(repoDir, { recursive: true })
  const filePath = join(repoDir, 'file.txt')
  writeFileSync(filePath, 'first\n', 'utf8')
  const git = (...args) => spawnSync('git', args, { cwd: repoDir, stdio: 'ignore' })
  if (git('init', '-q').status !== 0) throw new Error('git init failed for the smoke workspace')
  git('-c', 'user.email=smoke@example.com', '-c', 'user.name=Smoke', 'add', '.')
  const committed = git(
    '-c', 'user.email=smoke@example.com', '-c', 'user.name=Smoke', 'commit', '-q', '-m', 'init'
  )
  if (committed.status !== 0) throw new Error('git commit failed for the smoke workspace')
  writeFileSync(filePath, 'changed\n', 'utf8')

  process.stdout.write(`SMOKE: workspace=${workspaceDir}\nSMOKE: base=${baseDir}\n`)
  const logStream = require('node:fs').createWriteStream(logPath)
  child = spawn(
    electronPath,
    ['out/main/index.js', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${PORT}`],
    { cwd: join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } }
  )
  child.stdout.on('data', (chunk) => {
    log += chunk
    logStream.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    log += chunk
    logStream.write(chunk)
  })
  child.on('exit', (code) => {
    if (!exiting && code !== 0) fail(`app exited early with code ${String(code)}`)
  })

  const target = await until('debug target', fetchTarget, 20_000)
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('debugger websocket failed'))
  })
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }

  await send('Runtime.enable')
  await send('Page.enable')
  process.stdout.write('SMOKE: debugger attached\n')

  await until('renderer boot', () => evaluate('typeof window.gtd === "object"'), 15_000)

  const opened = await evaluate(
    `window.gtd.invokeRaw('workspace:open', { root: ${JSON.stringify(workspaceDir.replace(/\\/g, '/'))} })`
  )
  if (opened.ok !== true) throw new Error(`workspace:open failed: ${JSON.stringify(opened)}`)
  await evaluate(`window.gtd.invokeRaw('workspace:close')`)
  await send('Page.reload')
  await sleep(1200)

  await until(
    'recent workspace entry',
    () =>
      evaluate(
        `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('smoke-workspace'))`
      ),
    15_000
  )
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('smoke-workspace')).click(), true`
  )
  await until(
    'trust dialog',
    () =>
      evaluate(
        `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Trust this workspace')`
      )
  )
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Trust this workspace').click(), true`
  )
  process.stdout.write('SMOKE: workspace opened and trusted\n')
  await sleep(600)

  // Baseline: comfortable density gives 28px Explorer rows.
  await until(
    'explorer rows',
    () =>
      evaluate(
        `[...document.querySelectorAll('[role="treeitem"]')].some((el) => el.style.position === 'absolute' && el.style.height === '28px')`
      ),
    20_000
  )
  process.stdout.write('SMOKE: comfortable rows at 28px\n')

  // Open via the activity-bar gear.
  await evaluate(`document.querySelector('button[aria-label="Settings"]').click(), true`)
  await until(
    'settings tab',
    () => evaluate(`document.querySelector('h1')?.textContent === 'Settings'`),
    15_000
  )
  const pressed = await evaluate(
    `document.querySelector('button[aria-label="Settings"]').getAttribute('aria-pressed')`
  )
  if (pressed !== 'true') throw new Error(`gear aria-pressed=${String(pressed)}`)
  const tabPresent = await evaluate(
    `[...document.querySelectorAll('[role="tab"]')].some((el) => el.title === 'Settings')`
  )
  if (tabPresent !== true) throw new Error('settings tab missing from the tab strip')
  process.stdout.write('SMOKE: settings tab open\n')

  // The grouped surface renders all 22 keys across the six groups.
  await until('setting rows', () => evaluate(keyCountExpr(22)), 15_000)
  for (const key of ['appearance.density', 'git.concurrency', 'advanced.logLevel', 'commitMessage.provider']) {
    const found = await evaluate(`${rowExpr(key)} !== null && ${rowExpr(key)} !== undefined`)
    if (found !== true) throw new Error(`row missing: ${key}`)
  }
  const groups = await evaluate(`[...document.querySelectorAll('h2')].map((el) => el.textContent.trim())`)
  for (const group of ['Appearance', 'Editor', 'Git', 'Terminal', 'Commit message', 'Advanced']) {
    if (!groups.includes(group)) throw new Error(`group heading missing: ${group}`)
  }
  process.stdout.write('SMOKE: grouped surface complete\n')

  // Search filters down to the density row and clears back.
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('input[type="text"]')].find((el) => el.placeholder === 'Search settings…')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'density')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await until(
    'filtered rows',
    () =>
      evaluate(
        `${keyCountExpr(1)} && document.querySelector('[title="appearance.density"]') !== null`
      )
  )
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('input[type="text"]')].find((el) => el.placeholder === 'Search settings…')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await until('unfiltered rows', () => evaluate(keyCountExpr(22)))
  process.stdout.write('SMOKE: search filter works\n')

  // Density: comfortable → compact applies live to the Explorer tree.
  const setDensity = await evaluate(selectExpr('appearance.density', 'select', 'compact'))
  if (setDensity !== true) throw new Error('density select not found')
  await until(
    'compact select value',
    () => evaluate(`(${rowExpr('appearance.density')})?.querySelector('select')?.value === 'compact'`)
  )
  await until(
    'compact rows',
    () =>
      evaluate(
        `[...document.querySelectorAll('[role="treeitem"]')].filter((el) => el.style.position === 'absolute').every((el) => el.style.height === '22px')`
      ),
    15_000
  )
  const userDoc = await evaluate(`window.gtd.invokeRaw('settings:getAll', { scope: 'user' })`)
  if (userDoc?.value?.value?.appearance?.density !== 'compact') {
    throw new Error(`user settings missing density: ${JSON.stringify(userDoc)}`)
  }
  process.stdout.write('SMOKE: density applied live (rows 22px, user scope)\n')

  // Scope transitions: copy to workspace, then reset to user.
  await until('user badge', () => evaluate(`${badgeExpr('appearance.density')} === 'user'`))
  const copied = await evaluate(buttonExpr('appearance.density', 'Copy to Workspace'))
  if (copied !== true) throw new Error('copy-to-workspace button not found')
  await until('workspace badge', () => evaluate(`${badgeExpr('appearance.density')} === 'workspace'`))
  const wsDoc = await evaluate(`window.gtd.invokeRaw('settings:getAll', { scope: 'workspace' })`)
  if (wsDoc?.value?.value?.appearance?.density !== 'compact') {
    throw new Error(`workspace settings missing density: ${JSON.stringify(wsDoc)}`)
  }
  const reset = await evaluate(buttonExpr('appearance.density', 'Reset to User'))
  if (reset !== true) throw new Error('reset-to-user button not found')
  await until('user badge after reset', () => evaluate(`${badgeExpr('appearance.density')} === 'user'`))
  const wsDocAfter = await evaluate(`window.gtd.invokeRaw('settings:getAll', { scope: 'workspace' })`)
  if (wsDocAfter?.value?.value?.appearance?.density !== undefined) {
    throw new Error(`workspace settings still has density: ${JSON.stringify(wsDocAfter)}`)
  }
  process.stdout.write('SMOKE: scope copy/reset works\n')

  // Numeric commit: git.concurrency 6 → 3 through the number input.
  const setNumber = await evaluate(selectExpr('git.concurrency', 'input[type="number"]', '3'))
  if (setNumber !== true) throw new Error('concurrency input not found')
  await evaluate(`(() => {
    const input = (${rowExpr('git.concurrency')}).querySelector('input[type="number"]')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
  await until(
    'concurrency committed',
    () => evaluate(`(${rowExpr('git.concurrency')})?.querySelector('input[type="number"]')?.value === '3'`)
  )
  const userDocAfter = await evaluate(`window.gtd.invokeRaw('settings:getAll', { scope: 'user' })`)
  if (userDocAfter?.value?.value?.git?.concurrency !== 3) {
    throw new Error(`user settings missing concurrency: ${JSON.stringify(userDocAfter)}`)
  }
  process.stdout.write('SMOKE: numeric commit works\n')

  // Accent preset applies to the document root and its CSS variable.
  const setAccent = await evaluate(selectExpr('appearance.accent', 'select', 'rose'))
  if (setAccent !== true) throw new Error('accent select not found')
  await until(
    'accent applied',
    () => evaluate(`document.documentElement.dataset.accent === 'rose'`)
  )
  const accentVar = await evaluate(
    `getComputedStyle(document.documentElement).getPropertyValue('--gtd-accent').trim().toLowerCase()`
  )
  if (!['#e11d48', '#f43f5e'].includes(accentVar)) {
    throw new Error(`unexpected --gtd-accent for rose: ${accentVar}`)
  }
  process.stdout.write('SMOKE: accent applied\n')

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  process.stdout.write(`SMOKE: screenshot=${shotPath}\n`)

  clearTimeout(failsafe)
  process.stdout.write('SMOKE PASS\n')
  shutdown(0)
}

main().catch((error) => fail(error.stack ?? String(error)))
