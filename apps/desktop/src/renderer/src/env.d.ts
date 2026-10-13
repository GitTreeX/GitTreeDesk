import type { GtdTransport } from '@gitreedesk/shared'

declare global {
  interface Window {
    /** Raw preload bridge; feature code uses the `api` wrapper instead. */
    readonly gtd: GtdTransport
  }
}
