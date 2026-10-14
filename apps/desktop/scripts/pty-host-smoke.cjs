/**
 * End-to-end check for the pty host: forks `out/main/ptyHost.js` in a utility
 * process, runs an interactive shell through node-pty under Electron's ABI and
 * exercises the flow the app uses — late attach (replay buffer) and input over
 * the MessagePort. Run after `pnpm build`:
 *
 *   ELECTRON_ENABLE_LOGGING=1 pnpm exec electron scripts/pty-host-smoke.cjs
 */
const { app, utilityProcess, MessageChannelMain } = require('electron')
const { join } = require('node:path')

const hostPath = join(__dirname, '..', 'out', 'main', 'ptyHost.js')
const expected = 'hello-electron-pty'
const isWindows = process.platform === 'win32'

let child = null
let output = ''
let attachedBytes = 0
let sentExit = false

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

  const channel = new MessageChannelMain()
  channel.port1.on('message', (event) => {
    const frame = event.data
    if (frame.t === 'data') {
      attachedBytes += frame.data.byteLength
      output += new TextDecoder().decode(frame.data)
      if (!sentExit && output.includes(expected)) {
        sentExit = true
        setTimeout(() => {
          channel.port1.postMessage({ t: 'input', data: 'exit\r' })
        }, 100)
      }
    } else if (frame.t === 'exit') {
      clearTimeout(failsafe)
      const ok = output.includes(expected) && attachedBytes > 0
      finish(
        ok ? 0 : 3,
        `SMOKE output=${JSON.stringify(output)} bytes=${String(attachedBytes)}`
      )
    }
  })

  // The utilityProcess 'message' event delivers the raw message, not a MessageEvent.
  child.on('message', (message) => {
    process.stdout.write(`SMOKE: host event ${JSON.stringify(message)}\n`)
    if (message?.t === 'create-failed') {
      clearTimeout(failsafe)
      finish(4, `SMOKE FAIL: create-failed: ${message.message}`)
    }
    if (message?.t === 'created') {
      // Attach late so the replay buffer path runs, the way a renderer reload does.
      setTimeout(() => {
        child.postMessage({ t: 'attach', id: message.id }, [channel.port2])
        channel.port1.start()
        // Round trip: the pty echo of this line proves input reached the shell.
        setTimeout(() => {
          channel.port1.postMessage({ t: 'input', data: `echo ${expected}\r` })
        }, 900)
      }, 600)
    }
  })

  child.postMessage({
    t: 'create',
    id: 'smoke',
    shell: isWindows ? 'cmd.exe' : '/bin/sh',
    args: isWindows ? ['/d'] : [],
    env: {},
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    workspaceRoot: process.cwd(),
    repoRoot: null
  })
})
