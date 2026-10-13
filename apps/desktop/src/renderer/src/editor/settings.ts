import { useEffect, useState } from 'react'
import { api } from '../api'

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  tabSize: number
  insertSpaces: boolean
  minimap: boolean
  wordWrap: boolean
}

export const EDITOR_SETTINGS_DEFAULTS: EditorSettings = {
  fontSize: 13,
  fontFamily: '',
  tabSize: 2,
  insertSpaces: true,
  minimap: false,
  wordWrap: false
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Editor appearance options; user settings override the shipped defaults. */
export function useEditorSettings(): EditorSettings {
  const [settings, setSettings] = useState<EditorSettings>(EDITOR_SETTINGS_DEFAULTS)

  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      try {
        const [fontSize, fontFamily, tabSize, insertSpaces, minimap, wordWrap] = await Promise.all([
          api.invoke('settings:getEffective', { keyPath: ['editor', 'fontSize'] }),
          api.invoke('settings:getEffective', { keyPath: ['editor', 'fontFamily'] }),
          api.invoke('settings:getEffective', { keyPath: ['editor', 'tabSize'] }),
          api.invoke('settings:getEffective', { keyPath: ['editor', 'insertSpaces'] }),
          api.invoke('settings:getEffective', { keyPath: ['editor', 'minimap'] }),
          api.invoke('settings:getEffective', { keyPath: ['editor', 'wordWrap'] })
        ])
        if (!live) return
        setSettings({
          fontSize: numberValue(fontSize.value, EDITOR_SETTINGS_DEFAULTS.fontSize),
          fontFamily: typeof fontFamily.value === 'string' ? fontFamily.value : '',
          tabSize: numberValue(tabSize.value, EDITOR_SETTINGS_DEFAULTS.tabSize),
          insertSpaces:
            typeof insertSpaces.value === 'boolean'
              ? insertSpaces.value
              : EDITOR_SETTINGS_DEFAULTS.insertSpaces,
          minimap:
            typeof minimap.value === 'boolean' ? minimap.value : EDITOR_SETTINGS_DEFAULTS.minimap,
          wordWrap:
            typeof wordWrap.value === 'boolean' ? wordWrap.value : EDITOR_SETTINGS_DEFAULTS.wordWrap
        })
      } catch (error) {
        console.error('[editor] reading editor settings failed', error)
      }
    }
    void load()
    const off = api.on('settings:changed', (change) => {
      if (change.keyPath[0] === 'editor') void load()
    })
    return () => {
      live = false
      off()
    }
  }, [])

  return settings
}
