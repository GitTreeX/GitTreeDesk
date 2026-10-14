import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { api } from '../api'
import {
  DEFAULT_BINDINGS,
  KeyBindingService,
  buildBindings,
  mergeBindings
} from '../commands/defaults'
import { CommandRegistry } from '../commands/registry'

export interface CommandsContextValue {
  registry: CommandRegistry
  /** Rebuilt whenever the user overrides change; dispatch and display stay in sync. */
  keybindings: KeyBindingService
  /** User overrides: accelerator text per command, `null` for an explicit unbind. */
  overrides: Readonly<Record<string, string | null>>
}

const CommandsContext = createContext<CommandsContextValue | null>(null)

export function CommandsProvider({ children }: { children: ReactNode }): JSX.Element {
  const registry = useMemo(() => new CommandRegistry(), [])
  const [overrides, setOverrides] = useState<Readonly<Record<string, string | null>>>({})

  const reload = useCallback(async (): Promise<void> => {
    try {
      const { overrides: next } = await api.invoke('keybindings:get')
      setOverrides(next)
    } catch {
      // An unreadable file reads as no overrides; the defaults stay in force.
    }
  }, [])

  useEffect(() => {
    void reload()
    return api.on('keybindings:changed', () => void reload())
  }, [reload])

  const keybindings = useMemo(
    () =>
      new KeyBindingService(
        registry,
        api.platform,
        buildBindings(api.platform, mergeBindings(DEFAULT_BINDINGS, overrides))
      ),
    [registry, overrides]
  )

  const value = useMemo(
    () => ({ registry, keybindings, overrides }),
    [registry, keybindings, overrides]
  )

  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>
}

export function useCommands(): CommandsContextValue {
  const value = useContext(CommandsContext)
  if (value === null) throw new Error('useCommands requires a CommandsProvider')
  return value
}
