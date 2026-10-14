/**
 * End-to-end UI check for the terminal panel: launches the real app on an
 * isolated user-data dir and a temp workspace, then drives it over the Chrome
 * DevTools Protocol the way a user would — open from the welcome screen, trust
 * the workspace, Ctrl+` to show the panel, start a shell with +, type into it,
 * hide and show the panel (replay), run a configured quick command, and open
 * terminals from the Explorer, Repos, Source Control and diff "Open Terminal
 * Here" entries. A screenshot is saved for visual review. Run after `pnpm build`:
 *
 *   node scripts/terminal-ui-smoke.cjs
 */
const { spawn, spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const PORT = 9333
const electronPath = require('electron')

const baseDir = mkdtempSync(join(tmpdir(), 'gtd-ui-smoke-'))
const workspaceDir = join(baseDir, 'smoke-workspace')
const userDataDir = join(baseDir, 'user-data')
const logPath = join(baseDir, 'app.log')
const shotPath = join(baseDir, 'terminal-panel.png')

const MARKER = 'smoke-marker-ok'
const QUICK_MARKER = 'quick-ok'
const OPEN_TERMINAL = 'Open Terminal Here'
const WS_DIR = workspaceDir.replace(/\\/g, '/')
const REPO_DIR = `${WS_DIR}/repo-one`
const REPO_SUB_DIR = `${REPO_DIR}/sub`

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

async function pressKey(key, code, keyCode, text) {
  const base = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode
  }
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    text: text ?? key,
    unmodifiedText: text ?? key,
    ...base
  })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

async function typeText(text) {
  for (const char of text) {
    if (char === ' ') await pressKey(' ', 'Space', 32, ' ')
    else if (char === '-') await pressKey('-', 'Minus', 189, '-')
    else await pressKey(char, `Key${char.toUpperCase()}`, char.toUpperCase().charCodeAt(0), char)
  }
}

/** Dispatches a contextmenu event on the first element matching `find`. */
async function rightClick(find) {
  const found = await evaluate(`(() => {
    const el = ${find}
    if (el === undefined) return false
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 6, clientY: rect.top + 6 }))
    return true
  })()`)
  if (found !== true) throw new Error(`right-click target not found: ${find}`)
}

async function clickMenuItem(label) {
  const find = `[...document.querySelectorAll('button[role="menuitem"]')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`
  await until(`menu item ${label}`, () => evaluate(`${find} !== undefined`))
  await evaluate(`${find}.click(), true`)
}

/**
 * Waits for a new session at `dir`, then closes it so later steps see a tidy
 * strip. Sessions append to the strip; pre-existing tabs may share the same
 * cwd, so both the count growth and the last matching tab are checked.
 */
async function expectTerminalAt(dir) {
  const titlesExpr = `[...document.querySelectorAll('[role="tab"]')].map((el) => el.title ?? '')`
  const before = await evaluate(titlesExpr)
  await until(
    `terminal at ${dir}`,
    () =>
      evaluate(`(() => {
        const titles = ${titlesExpr}
        return titles.length > ${before.length} && titles[titles.length - 1].endsWith(${JSON.stringify(dir)})
      })()`),
    20_000
  )
  await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')].filter((el) => (el.title ?? '').endsWith(${JSON.stringify(dir)}))
    tabs[tabs.length - 1].querySelector('button[aria-label="Close"]').click()
    return true
  })()`)
  await sleep(400)
}

async function fetchTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await response.json()
  return targets.find((target) => target.type === 'page' && target.url.includes('index.html'))
}

async function main() {
  mkdirSync(join(workspaceDir, '.gitreedesk'), { recursive: true })
  writeFileSync(
    join(workspaceDir, '.gitreedesk', 'terminal.json'),
    JSON.stringify({
      quickCommands: [
        { name: 'smoke-quick', command: 'cmd', args: ['/c', 'echo', QUICK_MARKER] }
      ]
    }),
    'utf8'
  )
  // A real repository with one modified nested file backs the Repos, SCM and
  // diff entries. The file is committed then edited, so SCM shows a file row
  // (a fully untracked folder would collapse into one directory row).
  mkdirSync(join(workspaceDir, 'repo-one', 'sub'), { recursive: true })
  const nestedPath = join(workspaceDir, 'repo-one', 'sub', 'nested.txt')
  writeFileSync(nestedPath, 'first\n', 'utf8')
  const git = (...args) =>
    spawnSync('git', args, { cwd: join(workspaceDir, 'repo-one'), stdio: 'ignore' })
  if (git('init', '-q').status !== 0) throw new Error('git init failed for the smoke workspace')
  git('-c', 'user.email=smoke@example.com', '-c', 'user.name=Smoke', 'add', '.')
  const committed = git(
    '-c', 'user.email=smoke@example.com', '-c', 'user.name=Smoke', 'commit', '-q', '-m', 'init'
  )
  if (committed.status !== 0) throw new Error('git commit failed for the smoke workspace')
  writeFileSync(nestedPath, 'changed\n', 'utf8')

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

  // Register the workspace as recent, then reload into the welcome screen and
  // open it the way the recent list does (React state follows that path).
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
  process.stdout.write('SMOKE: workspace opened\n')

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
  process.stdout.write('SMOKE: workspace trusted\n')
  await sleep(600)

  // Ctrl+` toggles the panel (the documented shortcut).
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\u0060', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true })), true`
  )
  await until('terminal panel', () =>
    evaluate(`document.querySelector('section[aria-label="Terminal"]') !== null`)
  )
  process.stdout.write('SMOKE: panel visible\n')

  await evaluate(`document.querySelector('button[aria-label="New Terminal"]').click(), true`)
  await until('terminal session', () =>
    evaluate(
      `document.querySelector('[data-terminal-id] .xterm-rows')?.textContent ?? ''`
    )
  )
  process.stdout.write('SMOKE: session mounted\n')
  await sleep(1500)

  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus(), true`)
  await typeText(`echo ${MARKER}`)
  await pressKey('Enter', 'Enter', 13, '\r')
  await until(
    'echo output',
    () =>
      evaluate(
        `(document.querySelector('[data-terminal-id] .xterm-rows')?.textContent ?? '').includes(${JSON.stringify(MARKER)})`
      ),
    20_000
  )
  process.stdout.write('SMOKE: shell input echoed\n')

  // Hide and show: the session unmounts; reopening must replay the scrollback.
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\u0060', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true })), true`
  )
  await until('panel hidden', () =>
    evaluate(`document.querySelector('section[aria-label="Terminal"]') === null`)
  )
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\u0060', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true })), true`
  )
  await until(
    'replayed scrollback',
    () =>
      evaluate(
        `(document.querySelector('[data-terminal-id] .xterm-rows')?.textContent ?? '').includes(${JSON.stringify(MARKER)})`
      ),
    20_000
  )
  process.stdout.write('SMOKE: scrollback replayed after remount\n')

  // Input must still reach the shell after the re-attach.
  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus(), true`)
  await typeText('echo after')
  await pressKey('Enter', 'Enter', 13, '\r')
  await until(
    'post-reattach input',
    () =>
      evaluate(
        `(document.querySelector('[data-terminal-id] .xterm-rows')?.textContent ?? '').includes('echo after')`
      ),
    20_000
  )
  process.stdout.write('SMOKE: input works after re-attach\n')

  // Quick command from the toolbar menu: runs argv-style and exits.
  await evaluate(`document.querySelector('button[aria-label="Profiles & Commands"]').click(), true`)
  await until(
    'quick command entry',
    () =>
      evaluate(
        `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'smoke-quick')`
      )
  )
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'smoke-quick').click(), true`
  )
  await until(
    'quick command output',
    () =>
      evaluate(
        `[...document.querySelectorAll('[data-terminal-id]')].some((el) => el.textContent.includes(${JSON.stringify(QUICK_MARKER)}))`
      ),
    20_000
  )
  await until(
    'quick command exit footer',
    () =>
      evaluate(
        `[...document.querySelectorAll('div')].some((el) => el.textContent.trim() === 'Process exited with code 0')`
      )
  )
  process.stdout.write('SMOKE: quick command ran and exited\n')

  // ---- "Open Terminal Here" entries ----
  // Explorer: a folder row targets that folder.
  await rightClick(
    `[...document.querySelectorAll('[role="treeitem"]')].find((el) => el.textContent.includes('.gitreedesk'))`
  )
  await clickMenuItem(OPEN_TERMINAL)
  await expectTerminalAt(`${WS_DIR}/.gitreedesk`)
  process.stdout.write('SMOKE: explorer entry\n')

  // Repos: a repository row targets the repository root.
  await evaluate(
    `[...document.querySelectorAll('button[role="tab"]')].find((b) => b.textContent.trim() === 'Repos').click(), true`
  )
  await until('repos row', () =>
    evaluate(
      `[...document.querySelectorAll('[role="treeitem"]')].some((el) => el.title === ${JSON.stringify(REPO_DIR)})`
    ),
    20_000
  )
  await rightClick(
    `[...document.querySelectorAll('[role="treeitem"]')].find((el) => el.title === ${JSON.stringify(REPO_DIR)})`
  )
  await clickMenuItem(OPEN_TERMINAL)
  await expectTerminalAt(REPO_DIR)
  process.stdout.write('SMOKE: repos entry\n')

  // Source Control: a file row targets the file's directory.
  await evaluate(`document.querySelector('button[aria-label="Source Control"]').click(), true`)
  await until('scm file row', () =>
    evaluate(
      `[...document.querySelectorAll('[role="treeitem"]')].some((el) => el.textContent.includes('nested.txt'))`
    ),
    20_000
  )
  await rightClick(
    `[...document.querySelectorAll('[role="treeitem"]')].find((el) => el.textContent.includes('nested.txt'))`
  )
  await clickMenuItem(OPEN_TERMINAL)
  await expectTerminalAt(REPO_SUB_DIR)
  process.stdout.write('SMOKE: scm entry\n')

  // Diff view: the toolbar button targets the file's directory.
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="treeitem"]')].find((el) => el.textContent.includes('nested.txt'))
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    return true
  })()`)
  const diffButton = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(OPEN_TERMINAL)})`
  await until('diff open terminal button', () => evaluate(`${diffButton} !== undefined`), 20_000)
  await evaluate(`${diffButton}.click(), true`)
  await expectTerminalAt(REPO_SUB_DIR)
  process.stdout.write('SMOKE: diff entry\n')

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  process.stdout.write(`SMOKE: screenshot=${shotPath}\n`)

  clearTimeout(failsafe)
  process.stdout.write('SMOKE PASS\n')
  shutdown(0)
}

main().catch((error) => fail(error.stack ?? String(error)))
