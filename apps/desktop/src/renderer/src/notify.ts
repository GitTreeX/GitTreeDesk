export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastInput {
  message: string
  /** Full details for the "Copy details" affordance; defaults to the message. */
  details?: string
  tone?: 'info' | 'error'
  action?: ToastAction
}

export interface Toast extends ToastInput {
  id: number
}

type Listener = (toasts: readonly Toast[]) => void

const MAX_TOASTS = 4
const listeners = new Set<Listener>()
let toasts: readonly Toast[] = []
let nextId = 1

export function notify(input: ToastInput): number {
  const toast: Toast = { id: nextId, ...input }
  nextId += 1
  toasts = [...toasts, toast].slice(-MAX_TOASTS)
  emit()
  return toast.id
}

export function notifyError(message: string, details?: string): number {
  return notify({ message, details, tone: 'error' })
}

export function dismissToast(id: number): void {
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => {
    listeners.delete(listener)
  }
}

export function toastsSnapshot(): readonly Toast[] {
  return toasts
}

function emit(): void {
  for (const listener of listeners) listener(toasts)
}
