import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Git launches editors through a shell; this script stands in for the message
 * and sequence editors so rebases never wait on a TTY. `msg` mode resolves queued
 * reword/squash messages (accepting the file unchanged when the queue is empty),
 * `seq` mode overwrites the todo list with the prepared one.
 */
const SCRIPT = `'use strict'
const fs = require('node:fs')

function readConfig() {
  const file = process.env.GTD_EDITOR_JSON
  if (typeof file !== 'string' || file.length === 0) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function firstLine(content) {
  const end = content.indexOf('\\n')
  return (end === -1 ? content : content.slice(0, end)).replace(/\\s+$/, '')
}

const mode = process.argv[2]
const target = process.argv[3]

if (mode === 'seq') {
  const config = readConfig()
  if (config === null || typeof config.todo !== 'string' || typeof target !== 'string') {
    // Failing loudly stops the rebase instead of silently running the default todo.
    process.exit(1)
  }
  fs.copyFileSync(config.todo, target)
} else if (mode === 'msg') {
  const config = readConfig()
  if (config !== null && typeof config.messages === 'string' && typeof target === 'string') {
    try {
      const state = JSON.parse(fs.readFileSync(config.messages, 'utf8'))
      const content = fs.readFileSync(target, 'utf8')
      if (
        Array.isArray(state.squashes) &&
        state.squashes.length > 0 &&
        content.includes('# This is a combination of ')
      ) {
        const message = state.squashes[0]
        state.squashes = state.squashes.slice(1)
        fs.writeFileSync(config.messages, JSON.stringify(state))
        if (typeof message === 'string' && message.length > 0) fs.writeFileSync(target, message + '\\n')
      } else if (Array.isArray(state.rewords) && state.rewords.length > 0) {
        const line = firstLine(content)
        const index = state.rewords.findIndex(
          (entry) => entry !== null && typeof entry.subject === 'string' && entry.subject === line
        )
        if (index !== -1) {
          const entry = state.rewords[index]
          state.rewords.splice(index, 1)
          fs.writeFileSync(config.messages, JSON.stringify(state))
          if (typeof entry.message === 'string' && entry.message.length > 0) {
            fs.writeFileSync(target, entry.message + '\\n')
          }
        }
      }
    } catch {
      // Accept the file unchanged when the queues cannot be read.
    }
  }
}

process.exit(0)
`

let scriptPromise: Promise<string> | null = null

/** Absolute path of the shared editor script, written once per process. */
export function editorScriptPath(): Promise<string> {
  scriptPromise ??= (async () => {
    const dir = join(tmpdir(), 'gitreedesk-editor')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'gtd-editor.cjs')
    await writeFile(file, SCRIPT, 'utf8')
    return file
  })()
  return scriptPromise
}

/** Command line for `GIT_EDITOR` / `GIT_SEQUENCE_EDITOR`. */
export function editorCommand(script: string, mode: 'msg' | 'seq'): string {
  return `"${process.execPath}" "${script}" ${mode}`
}

/**
 * Environment for git commands that may launch an editor. The script runs under
 * Electron's bundled Node (`ELECTRON_RUN_AS_NODE`), so no external runtime is
 * required; under plain Node the flag is ignored.
 */
export function editorEnv(script: string, configPath?: string): Record<string, string> {
  const env: Record<string, string> = {
    GIT_EDITOR: editorCommand(script, 'msg'),
    ELECTRON_RUN_AS_NODE: '1'
  }
  if (configPath !== undefined) env.GTD_EDITOR_JSON = configPath
  return env
}
