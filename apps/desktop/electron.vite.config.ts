import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const desktopVersion = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string })
  .version

const devCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws:",
  "worker-src 'self' blob:"
].join('; ')

const prodCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:"
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'gitreedesk:content-security-policy',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        return html.replace('%CSP%', context.server === undefined ? prodCsp : devCsp)
      }
    }
  }
}

const MONACO_WORKER_CONSTRUCTOR =
  /new Worker\(new URL\('[^']+', import\.meta\.url\), \{ type: "module" \}\)/g

/**
 * Monaco's language worker managers contain a `new Worker(new URL('*.worker.js',
 * import.meta.url))` fallback that never runs at runtime (the app provides every
 * worker through `MonacoEnvironment.getWorker`), but Vite still emits a bundled
 * worker chunk per occurrence. Replacing it keeps those chunks out of the build.
 */
function monacoWorkerFallback(): Plugin {
  return {
    name: 'gitreedesk:monaco-worker-fallback',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('monaco-editor') || !id.includes('workerManager.js')) return null
      if (!code.includes('new Worker(new URL(')) return null
      return {
        code: code.replace(
          MONACO_WORKER_CONSTRUCTOR,
          `(() => { throw new Error('Monaco workers load through MonacoEnvironment.getWorker') })()`
        ),
        map: null
      }
    }
  }
}

const workspacePackages = [
  '@gitreedesk/shared',
  '@gitreedesk/ui',
  '@gitreedesk/git-core',
  '@gitreedesk/store',
  '@gitreedesk/workspace-core',
  '@gitreedesk/terminal-core',
  '@gitreedesk/commit-msg'
]

export default defineConfig({
  main: {
    define: { __APP_VERSION__: JSON.stringify(desktopVersion) },
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          ptyHost: resolve(__dirname, 'src/pty-host/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })]
  },
  renderer: {
    plugins: [monacoWorkerFallback(), react(), tailwindcss(), contentSecurityPolicy()]
  }
})
