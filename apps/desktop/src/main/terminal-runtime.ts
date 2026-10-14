import { join } from 'node:path'
import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron'
import type { HostControlEvent, HostControlRequest } from '../pty-host/protocol'
import type {
  TerminalChannel,
  TerminalHostChild,
  TerminalPort,
  TerminalRuntime
} from './services/terminal'

function adaptPort(port: MessagePortMain): TerminalPort {
  return {
    postMessage: (message) => {
      port.postMessage(message)
    },
    onMessage: (listener) => {
      port.on('message', (event) => {
        listener(event.data)
      })
    },
    start: () => {
      port.start()
    },
    close: () => {
      port.close()
    }
  }
}

function adaptChild(child: UtilityProcess, raw: WeakMap<TerminalPort, MessagePortMain>): TerminalHostChild {
  return {
    postMessage: (message: HostControlRequest, transfer?: readonly TerminalPort[]) => {
      if (transfer === undefined) {
        child.postMessage(message)
        return
      }
      const ports = transfer.map((handle) => {
        const port = raw.get(handle)
        if (port === undefined) throw new Error('Unknown terminal port in transfer list')
        return port
      })
      child.postMessage(message, [...ports])
    },
    onMessage: (listener) => {
      child.on('message', (message: unknown) => {
        listener(message as HostControlEvent)
      })
    },
    onExit: (listener) => {
      child.on('exit', (code: number) => {
        listener(code)
      })
    },
    kill: () => {
      child.kill()
    }
  }
}

/** The Electron-backed runtime: a utility process for the pty host plus message channels. */
export function electronTerminalRuntime(): TerminalRuntime {
  const raw = new WeakMap<TerminalPort, MessagePortMain>()
  const toHandle = (port: MessagePortMain): TerminalPort => {
    const handle = adaptPort(port)
    raw.set(handle, port)
    return handle
  }
  return {
    forkHost: () => adaptChild(utilityProcess.fork(join(__dirname, 'ptyHost.js')), raw),
    createChannel: (): TerminalChannel => {
      const { port1, port2 } = new MessageChannelMain()
      return { host: toHandle(port1), client: toHandle(port2) }
    }
  }
}
