import type { MessagePortMain } from 'electron'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { buildSessionEnv } from '@gitreedesk/terminal-core'
import type { TerminalClientFrame, TerminalHostFrame } from '@gitreedesk/shared'
import { PtyHost, type PtyProcess, type SessionPort } from './host'
import type { HostControlRequest } from './protocol'

function toPtyProcess(pty: IPty): PtyProcess {
  return {
    onData: (listener) => {
      pty.onData(listener)
    },
    onExit: (listener) => {
      pty.onExit((event) => {
        listener({ exitCode: event.exitCode })
      })
    },
    write: (data) => {
      pty.write(data)
    },
    resize: (cols, rows) => {
      pty.resize(cols, rows)
    },
    kill: () => {
      pty.kill()
    }
  }
}

function adaptPort(port: MessagePortMain): SessionPort {
  return {
    post: (frame: TerminalHostFrame) => {
      try {
        port.postMessage(frame)
      } catch {
        // The renderer went away; the output stays in the replay buffer.
      }
    },
    onMessage: (handler) => {
      port.on('message', (event) => {
        handler(event.data as TerminalClientFrame)
      })
      port.start()
    },
    onClose: (handler) => {
      port.on('close', () => {
        handler()
      })
    },
    close: () => {
      port.close()
    }
  }
}

const host = new PtyHost({
  spawn: (options) =>
    toPtyProcess(
      spawnPty(options.shell, [...options.args], {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: options.env
      })
    ),
  onEvent: (event) => {
    process.parentPort.postMessage(event)
  }
})

process.parentPort.on('message', (event) => {
  const request = event.data as HostControlRequest
  const port = event.ports[0]
  switch (request.t) {
    case 'create': {
      const env = buildSessionEnv({
        base: process.env,
        profileEnv: request.env,
        workspaceRoot: request.workspaceRoot,
        repoRoot: request.repoRoot
      })
      host.create({ ...request, env })
      break
    }
    case 'attach':
      if (port !== undefined) host.attach(request.id, adaptPort(port))
      break
    case 'kill':
      host.kill(request.id)
      break
    case 'dispose':
      host.dispose(request.id)
      break
    case 'shutdown':
      host.shutdown()
      break
  }
})
