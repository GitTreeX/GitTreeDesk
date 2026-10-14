/**
 * End-to-end check for the pty host: forks `out/main/ptyHost.js` in a utility
 * process, runs a shell through node-pty under Electron's ABI and reads the
 * output back over a MessagePort. Run after `pnpm build`:
 *
 *   ELECTRON_ENABLE_LOGGING=1 pnpm exec electron scripts/pty-host-smoke.cjs
 */
const { app, utilityProcess, MessageChannelMain } = require('electron')
const { join } = require('node:path')

const hostPath = join(__dirname, '..', 'out', 'main', 'ptyHost.js')
const expected = 'hello-electron-pty'
const isWindows = process.platform === 'win32'

let child = null

function finish(code, message) {
  process.stdout.write(`${message}\n`)
  child?.kill()
  process.exit(code)
}

process.on('uncaughtException', (error) => {
  finish(7, `SMOKE FAIL: ${error.stack}`)
})

const failsafe = setTimeout(() => finish(9, 'SMOKE FAIL: failsafe exit'), 25_000)

app.whenReady().then(() => {
  process.stdout.write('SMOKE: whenReady\n')
  child = utilityProcess.fork(hostPath)
  child.on('spawn', () => process.stdout.write(`SMOKE: host spawned pid=${String(child.pid)}\n`))
  child.on('exit', (code) => process.stdout.write(`SMOKE: host exited code=${String(code)}\n`))

  let output = ''
  const channel = new MessageChannelMain()
  channel.port1.on('message', (event) => {
    const frame = event.data
    if (frame.t === 'data') {
      output += new TextDecoder().decode(frame.data)
    } else if (frame.t === 'exit') {
      clearTimeout(failsafe)
      finish(output.includes(expected) ? 0 : 3, `SMOKE output: ${JSON.stringify(output)}`)
    }
  })
  channel.port1.start()

  // The utilityProcess 'message' event delivers the raw message, not a MessageEvent.
  child.on('message', (message) => {
    process.stdout.write(`SMOKE: host event ${JSON.stringify(message)}\n`)
    if (message?.t === 'created') {
      child.postMessage({ t: 'attach', id: message.id }, [channel.port2])
    }
    if (message?.t === 'create-failed') {
      clearTimeout(failsafe)
      finish(4, `SMOKE FAIL: create-failed: ${message.message}`)
    }
  })

  child.postMessage({
    t: 'create',
    id: 'smoke',
    shell: isWindows ? 'cmd.exe' : '/bin/sh',
    args: isWindows ? ['/d', '/s', '/c', `echo ${expected}`] : ['-c', `echo ${expected}`],
    env: {},
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    workspaceRoot: process.cwd(),
    repoRoot: null
  })
})
