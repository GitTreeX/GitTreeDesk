import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type EventMap,
  type GtdTransport,
  type InvokeChannel,
  type InvokeMap,
  type IpcResult,
  type Platform
} from '@gitreedesk/shared'

const invokeChannels = new Set<string>(INVOKE_CHANNELS)
const eventChannels = new Set<string>(EVENT_CHANNELS)

const transport = {
  platform: process.platform as Platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node
  },
  async invokeRaw<K extends InvokeChannel>(
    channel: K,
    request: InvokeMap[K]['request']
  ): Promise<IpcResult<InvokeMap[K]['response']>> {
    if (!invokeChannels.has(channel)) {
      return { ok: false, error: { code: 'unknown-channel', message: `Unknown channel: ${channel}` } }
    }
    return (await ipcRenderer.invoke(channel, request)) as IpcResult<InvokeMap[K]['response']>
  },
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void {
    if (!eventChannels.has(channel)) {
      throw new Error(`Unknown channel: ${channel}`)
    }
    const handler = (_event: IpcRendererEvent, payload: EventMap[K]): void => {
      listener(payload)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  getPathForFile(file: unknown): string {
    const stat = webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])
    return typeof stat === 'string' ? stat : ''
  }
} satisfies GtdTransport

contextBridge.exposeInMainWorld('gtd', transport)
