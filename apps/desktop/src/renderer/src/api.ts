import { gtdApiFromTransport, type GtdApi } from '@gitreedesk/shared'

/** Built in the renderer world so `GtdIpcError` keeps its class and code. */
export const api: GtdApi = gtdApiFromTransport(window.gtd)
