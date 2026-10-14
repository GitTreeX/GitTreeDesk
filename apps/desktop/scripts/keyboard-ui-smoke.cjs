/**
 * End-to-end UI check for the Keyboard Shortcuts page: launches the real app on
 * an isolated user-data dir and a temp workspace, then drives it over the Chrome
 * DevTools Protocol — opens the page through the command palette, verifies the
 * command rows and the fixed context section, records a new binding over the
 * keyboard and confirms it takes effect live, checks the conflict warning and
 * the reset flow, exercises Alt+Left / Alt+Right editor navigation, and commits
 * staged changes through the Ctrl+Enter command channel. A screenshot is saved
 * for visual review. Run after `pnpm build`:
 *
 *   node scripts/keyboard-ui-smoke.cjs
 */
const { spawn, spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const PORT = 9335
const electronPath = require('electron')

const baseDir = mkdtempSync(join(tmpdir(), 'gtd-keyboard-smoke-'))
const workspaceDir = join(baseDir, 'smoke-workspace')
const userDataDir = join(baseDir, 'user-data')
const logPath = join(baseDir, 'app.log')
const shotPath = join(baseDir, 'keyboard-shortcuts.png')

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

const failsafe = setTimeout(() => fail('failsafe timeout'), 240_000)

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

/** Dispatches a real key press; `modifiers` is Alt=1 | Ctrl=2 | Meta=4 | Shift=8. */
async function press({ key, code, vk, modifiers = 0 }) {
  const event = { modifiers, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
}

const rowExpr = (command) => `document.querySelector('[data-command=${JSON.stringify(command)}]')`
const rowTextExpr = (command) => `(${rowExpr(command)}?.textContent ?? '')`
const rowsCountExpr = `document.querySelectorAll('[data-command]').length`
const overridesExpr = `window.gtd.invokeRaw('keybindings:get')`
const rowButtonExpr = (command, label) => `(() => {
  const row = ${rowExpr(command)}
  if (row === undefined || row === null) return false
  const button = [...row.querySelectorAll('button')].find((el) => el.textContent.trim() === ${JSON.stringify(label)})
  if (button === undefined) return false
  button.click()
  return true
})()`
const activeTabTitleExpr = `([...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find((el) => el.hasAttribute('title'))?.title ?? '')`

async function fetchTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await response.json()
  return targets.find((target) => target.type === 'page' && target.url.includes('index.html'))
}

/** Expands tree folders until a row containing `name` is rendered. */
async function revealTreeRow(name) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[role="treeitem"]')]
      if (rows.some((el) => el.textContent.includes(${JSON.stringify(name)}))) return 'found'
      const collapsed = rows.find((el) => el.getAttribute('aria-expanded') === 'false')
      if (collapsed === undefined) return 'missing'
      collapsed.querySelector('button')?.click()
      return 'expanding'
    })()`)
    if (state === 'found') return
    if (state === 'missing') throw new Error(`tree row never rendered: ${name}`)
    await sleep(200)
  }
  throw new Error(`tree expansion exhausted before finding: ${name}`)
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
  writeFileSync(join(repoDir, 'second.txt'), 'second\n', 'utf8')
  if (git('add', 'file.txt').status !== 0) throw new Error('git add failed for the smoke workspace')
  const gitDir = `${repoDir.replace(/\\/g, '/')}/.git`

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

  // The page opens through its real chord: Ctrl+Shift+P, then the palette entry.
  await press({ key: 'P', code: 'KeyP', vk: 80, modifiers: 10 })
  await until(
    'command palette',
    () =>
      evaluate(
        `[...document.querySelectorAll('input')].some((el) => el.getAttribute('aria-label')?.includes('Type a command'))`
      )
  )
  await send('Input.insertText', { text: 'keyboard shortcuts' })
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Open Keyboard Shortcuts'))
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  if (clicked !== true) throw new Error('palette entry for keyboard shortcuts not found')
  await until('keyboard page', () => evaluate(`document.querySelector('h1')?.textContent === 'Keyboard Shortcuts'`))
  const tabPresent = await evaluate(
    `[...document.querySelectorAll('[role="tab"]')].some((el) => el.title === 'Keyboard Shortcuts')`
  )
  if (tabPresent !== true) throw new Error('shortcuts tab missing from the tab strip')
  process.stdout.write('SMOKE: keyboard page open via the palette\n')

  // The full default surface renders: 14 bound commands plus the context rows.
  await until('shortcut rows', () => evaluate(`${rowsCountExpr} === 14`))
  for (const command of ['view.commandPalette', 'editor.save', 'editor.quickOpen', 'commit.commitStaged']) {
    const found = await evaluate(`${rowExpr(command)} !== null`)
    if (found !== true) throw new Error(`row missing: ${command}`)
  }
  const saveRow = await evaluate(rowTextExpr('editor.save'))
  if (!saveRow.includes('Ctrl+S') || saveRow.includes('Custom')) {
    throw new Error(`editor.save row unexpected: ${saveRow}`)
  }
  const commitRow = await evaluate(rowTextExpr('commit.commitStaged'))
  if (!commitRow.includes('Ctrl+Enter')) throw new Error(`commit row missing chord: ${commitRow}`)
  const fetchRow = await evaluate(rowTextExpr('git.fetchRepo'))
  if (!fetchRow.includes('Ctrl+Shift+F')) throw new Error(`fetch row missing chord: ${fetchRow}`)
  const bodyText = await evaluate('document.body.textContent')
  for (const text of ['Context interactions', 'Stage or unstage the focused change', 'Open the focused entry']) {
    if (!bodyText.includes(text)) throw new Error(`context section missing: ${text}`)
  }
  process.stdout.write('SMOKE: rows and context section render\n')

  // Search narrows the list to the Fetch row and clears back.
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('input[type="text"]')].find((el) => el.placeholder === 'Search shortcuts…')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'fetch')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await until('filtered rows', () => evaluate(`${rowsCountExpr} === 1 && ${rowExpr('git.fetchRepo')} !== null`))
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('input[type="text"]')].find((el) => el.placeholder === 'Search shortcuts…')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await until('unfiltered rows', () => evaluate(`${rowsCountExpr} === 14`))
  process.stdout.write('SMOKE: search filter works\n')

  // Record Ctrl+Alt+K for Go to File, save it, and use it right away.
  const recording = await evaluate(rowButtonExpr('editor.quickOpen', 'Record'))
  if (recording !== true) throw new Error('record button not found for editor.quickOpen')
  await sleep(150)
  await press({ key: 'k', code: 'KeyK', vk: 75, modifiers: 3 })
  await until(
    'pending chord',
    () => evaluate(`${rowTextExpr('editor.quickOpen')}.includes('Ctrl+Alt+K')`)
  )
  if (await evaluate(`${rowTextExpr('editor.quickOpen')}.includes('Already used by')`)) {
    throw new Error('unexpected conflict for Ctrl+Alt+K')
  }
  const saved = await evaluate(rowButtonExpr('editor.quickOpen', 'Save'))
  if (saved !== true) throw new Error('save button not found for the pending chord')
  await until(
    'custom badge',
    () =>
      evaluate(
        `${rowTextExpr('editor.quickOpen')}.includes('Ctrl+Alt+K') && ${rowTextExpr('editor.quickOpen')}.includes('Custom')`
      )
  )
  const afterSave = await evaluate(overridesExpr)
  if (afterSave?.value?.overrides?.['editor.quickOpen'] !== 'Ctrl+Alt+K') {
    throw new Error(`override not stored: ${JSON.stringify(afterSave)}`)
  }
  process.stdout.write('SMOKE: recording saved to the store\n')

  // The rebuilt binding drives the real chord: Ctrl+Alt+K opens Go to File.
  await press({ key: 'k', code: 'KeyK', vk: 75, modifiers: 3 })
  await until(
    'quick open dialog',
    () =>
      evaluate(
        `[...document.querySelectorAll('input')].some((el) => el.getAttribute('aria-label') === 'Go to file…')`
      )
  )
  await press({ key: 'Escape', code: 'Escape', vk: 27 })
  await until(
    'quick open closed',
    () =>
      evaluate(
        `![...document.querySelectorAll('input')].some((el) => el.getAttribute('aria-label') === 'Go to file…')`
      )
  )
  process.stdout.write('SMOKE: recorded binding dispatches live\n')

  // A taken chord warns but still saves; reset puts the default back.
  const recording2 = await evaluate(rowButtonExpr('editor.save', 'Record'))
  if (recording2 !== true) throw new Error('record button not found for editor.save')
  await sleep(150)
  await press({ key: 'F', code: 'KeyF', vk: 70, modifiers: 10 })
  await until(
    'conflict warning',
    () =>
      evaluate(
        `${rowTextExpr('editor.save')}.includes('Already used by') && ${rowTextExpr('editor.save')}.includes('Fetch')`
      )
  )
  const saved2 = await evaluate(rowButtonExpr('editor.save', 'Save'))
  if (saved2 !== true) throw new Error('save button not found after the conflict warning')
  await until(
    'conflict saved',
    () => evaluate(`${rowTextExpr('editor.save')}.includes('Ctrl+Shift+F')`)
  )
  const reset1 = await evaluate(rowButtonExpr('editor.save', 'Reset'))
  if (reset1 !== true) throw new Error('reset button not found for editor.save')
  await until(
    'editor.save back to default',
    () =>
      evaluate(
        `${rowTextExpr('editor.save')}.includes('Ctrl+S') && !${rowTextExpr('editor.save')}.includes('Custom')`
      )
  )
  const reset2 = await evaluate(rowButtonExpr('editor.quickOpen', 'Reset'))
  if (reset2 !== true) throw new Error('reset button not found for editor.quickOpen')
  await until(
    'editor.quickOpen back to default',
    () =>
      evaluate(
        `${rowTextExpr('editor.quickOpen')}.includes('Ctrl+P') && !${rowTextExpr('editor.quickOpen')}.includes('Custom')`
      )
  )
  const afterReset = await evaluate(overridesExpr)
  const leftover = Object.keys(afterReset?.value?.overrides ?? {})
  if (leftover.length !== 0) throw new Error(`overrides not cleared: ${JSON.stringify(leftover)}`)
  process.stdout.write('SMOKE: conflict warning and reset work\n')

  // Editor navigation history: two files, then Alt+Left / Alt+Right.
  await until('explorer ready', () => evaluate(`document.querySelectorAll('[role="treeitem"]').length > 0`), 20_000)
  await revealTreeRow('file.txt')
  await revealTreeRow('second.txt')
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="treeitem"]')].find((el) => el.textContent.includes('file.txt'))
    row.click()
    return true
  })()`)
  await until('file.txt tab', () => evaluate(`${activeTabTitleExpr}.endsWith('file.txt')`))
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="treeitem"]')].find((el) => el.textContent.includes('second.txt'))
    row.click()
    return true
  })()`)
  await until('second.txt tab', () => evaluate(`${activeTabTitleExpr}.endsWith('second.txt')`))
  await press({ key: 'ArrowLeft', code: 'ArrowLeft', vk: 37, modifiers: 1 })
  await until('navigated back', () => evaluate(`${activeTabTitleExpr}.endsWith('file.txt')`))
  await press({ key: 'ArrowRight', code: 'ArrowRight', vk: 39, modifiers: 1 })
  await until('navigated forward', () => evaluate(`${activeTabTitleExpr}.endsWith('second.txt')`))
  process.stdout.write('SMOKE: Alt+Left / Alt+Right navigate history\n')

  // Screenshot the shortcuts page for visual review.
  await evaluate(
    `[...document.querySelectorAll('[role="tab"]')].find((el) => el.title === 'Keyboard Shortcuts').click(), true`
  )
  await sleep(400)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  process.stdout.write(`SMOKE: screenshot=${shotPath}\n`)

  // Ctrl+Enter commits staged changes through the command channel.
  await until(
    'scm status staged',
    async () => {
      const response = await evaluate(
        `window.gtd.invokeRaw('git:status', { gitDir: ${JSON.stringify(gitDir)} })`
      )
      return response?.value?.status?.staged?.length === 1
    },
    20_000
  )
  await evaluate(`[...document.querySelectorAll('button[aria-label="Source Control"]')][0].click(), true`)
  await until(
    'commit box',
    () => evaluate(`document.querySelector('textarea[aria-label="Commit message"]') !== null`),
    20_000
  )
  const placeholder = await evaluate(
    `document.querySelector('textarea[aria-label="Commit message"]')?.placeholder ?? ''`
  )
  if (!placeholder.includes('Ctrl+Enter')) throw new Error(`commit placeholder: ${placeholder}`)
  await evaluate(`(() => {
    const el = document.querySelector('textarea[aria-label="Commit message"]')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'smoke: keyboard commit')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
    return true
  })()`)
  await until(
    'commit ready',
    () =>
      evaluate(`(() => {
        const box = document.querySelector('textarea[aria-label="Commit message"]')?.closest('div.shrink-0')
        const button = [...(box?.querySelectorAll('button') ?? [])].find((el) => el.textContent.trim() === 'Commit')
        return button !== undefined && button.disabled === false
      })()`),
    20_000
  )
  await press({ key: 'Enter', code: 'Enter', vk: 13, modifiers: 2 })
  await until(
    'commit toast',
    () => evaluate(`document.body.textContent.includes('Committed')`),
    20_000
  )
  const count = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
  if (count.stdout.trim() !== '2') throw new Error(`unexpected commit count: ${count.stdout.trim()}`)
  process.stdout.write('SMOKE: Ctrl+Enter committed through the command channel\n')

  clearTimeout(failsafe)
  process.stdout.write('SMOKE PASS\n')
  shutdown(0)
}

main().catch((error) => fail(error.stack ?? String(error)))
