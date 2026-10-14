#!/usr/bin/env node
/**
 * Generates the `acme` reference workspace used for performance runs and
 * acceptance: ~55 repositories in groups, linked worktrees under
 * `__worktree__/`, mixed non-Git folders, a noisy root `node_modules/`, a
 * CJK-named directory, and a large history repository for the graph.
 *
 * Deterministic: fixed author/committer dates, fixed branch names, autocrlf
 * off — regenerating produces the same content. Requires Git on PATH.
 *
 * Usage:
 *   node scripts/generate-fixture-workspace.mjs [--out <dir>] [--force]
 *                                               [--large-commits <n>]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const AUTHOR = { name: 'Fixture', email: 'fixture@example.com' }
const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0)
let clock = 0

const baseEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

function fail(message) {
  console.error(`fixture: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    out: join(REPO_ROOT, '.fixtures', 'acme'),
    force: false,
    largeCommits: 10_000
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out' || arg === '--large-commits') {
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      if (arg === '--out') {
        opts.out = resolve(value)
      } else {
        opts.largeCommits = Number(value)
        if (!Number.isInteger(opts.largeCommits) || opts.largeCommits < 0) {
          fail('--large-commits must be an integer >= 0')
        }
      }
    } else if (arg === '--force') {
      opts.force = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/generate-fixture-workspace.mjs [--out <dir>] [--force] [--large-commits <n>]')
      process.exit(0)
    } else {
      fail(`unknown option: ${arg}`)
    }
  }
  return opts
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
}

function stampEnv() {
  const date = new Date(EPOCH + clock++ * 60_000).toISOString()
  return {
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
    GIT_COMMITTER_DATE: date
  }
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

function appendLine(file, line) {
  writeFileSync(file, `${line}\n`, { flag: 'a' })
}

function initRepo(repoDir) {
  mkdirSync(repoDir, { recursive: true })
  git(repoDir, ['init', '-q'])
  git(repoDir, ['checkout', '-q', '-b', 'main'])
  git(repoDir, ['config', 'core.autocrlf', 'false'])
}

function commitAll(repoDir, message) {
  git(repoDir, ['add', '-A'])
  git(repoDir, ['commit', '-q', '--no-gpg-sign', '-m', message], stampEnv())
}

/** The 55 main repositories, in creation order. */
const GROUPS = {
  app: [
    'mobile-app',
    'mobile-app-android',
    'mobile-app-ios',
    'web-desktop',
    'design-system',
    'lib-core',
    'lib-ui-kit',
    'lib-network',
    'miniapp',
    'editor',
    'editor-bridge',
    'app4merge'
  ],
  'backend/services': ['api-server', 'api-gateway', 'auth-service', 'billing-service', 'notify-service', 'search-service'],
  'backend/data': [
    'migrations',
    'sql-generator',
    'database-backup',
    'internal-develop-database-backup',
    'event-bus',
    'feature-flags'
  ],
  backend: ['worker', 'scheduler'],
  website: ['docs-site', 'landing', 'blog', 'status-page', 'careers-page', 'changelog', 'sitemap-tools', 'cdn-assets'],
  tools: [
    'codegen',
    'lint-preset',
    'release-cli',
    'fixture-tools',
    'mock-server',
    'perf-lab',
    'grafana-dashboards',
    'alert-rules',
    'oncall-bot'
  ],
  infra: [
    'terraform-core',
    'terraform-modules',
    'k8s-manifests',
    'ansible-playbook',
    'deploy-scripts',
    'secrets-template',
    'docker-images'
  ],
  labs: ['spike-auth', 'spike-realtime', 'prototype-graph', 'history-lab'],
  'content/中文文档': ['handbook']
}

const LARGE_REPO = 'labs/history-lab'
const WORKTREES = [
  {
    repo: 'app/mobile-app',
    dir: 'mobile-app_worktree-feat-dark-mode',
    branch: 'feat/dark-mode',
    commit: 'Start dark mode work'
  },
  {
    repo: 'app/lib-core',
    dir: 'lib-core_worktree-perf-spike',
    branch: 'perf/spike',
    commit: 'Spike: faster status refresh'
  }
]

const stats = { repos: 0, dirty: 0, staged: 0, untracked: 0, branches: 0, tags: 0 }
const started = Date.now()

function createLooseFolders(root) {
  writeTree(root, {
    'README.md':
      '# acme\n\nGenerated fixture workspace for GitTreeDesk performance runs and acceptance.\n\n' +
      'Regenerate with `pnpm fixture --force`. This folder is disposable; nothing here is tracked by the parent repository.\n',
    'notes/roadmap.md': '# Roadmap\n\n- Q3: desktop rollout\n- Q4: billing migration\n',
    'notes/meeting-2026-09.md': '# 2026-09 sync\n\nAttendees: a, b, c.\n\nDecisions recorded here are not versioned.\n',
    'notes/open-questions.md': '# Open questions\n\n- Who owns the changelog?\n',
    'assets/logo-small.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#22d3ee"/></svg>\n',
    'assets/og-cover.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#0b0c0f"/></svg>\n',
    'design/tokens.json': JSON.stringify({ color: { accent: '#22d3ee' }, radius: 8 }, null, 2) + '\n',
    'design/mockup-home.fig': ''
  })
}

function createNodeModulesNoise(root) {
  for (let p = 0; p < 60; p++) {
    const name = `pkg-${String(p).padStart(2, '0')}`
    writeTree(root, {
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }, null, 2) + '\n',
      [`node_modules/${name}/index.js`]: "module.exports = require('./lib/a')\n",
      [`node_modules/${name}/lib/a.js`]: `exports.a = ${p}\n`,
      [`node_modules/${name}/lib/b.js`]: `exports.b = '${name}'\n`,
      [`node_modules/${name}/README.md`]: `# ${name}\n`,
      [`node_modules/${name}/LICENSE`]: 'MIT\n',
      [`node_modules/${name}/test/index.test.js`]: `// tests for ${name}\n`,
      [`node_modules/${name}/.bin/${name}.cmd`]: '@echo off\n',
      [`node_modules/${name}/dist/index.min.js`]: `!function(){var a=${p}}();\n`,
      [`node_modules/${name}/types/index.d.ts`]: 'export declare const a: number\n'
    })
  }
}

function seedRepo(repoDir, relPath) {
  const name = relPath.split('/').pop()

  if (relPath === 'content/中文文档/handbook') {
    writeTree(repoDir, {
      'README.md': '# handbook\n\n团队手册。\n',
      '团队规范.md': '# 团队规范\n\n用于验证 CJK 路径的显示与操作。\n',
      '发布流程.md': '# 发布流程\n\n1. 冻结\n2. 构建\n3. 发布\n',
      '接口/用户接口.md': '# 用户接口\n\n描述用户相关的接口约定。\n'
    })
    commitAll(repoDir, 'Initial commit')
    appendLine(join(repoDir, '发布流程.md'), '\n4. 回滚演练\n')
    commitAll(repoDir, 'Add rollback drill')
    return
  }

  if (relPath === 'backend/services/api-server') {
    writeTree(repoDir, {
      'README.md': `# ${name}\n\nPart of the acme workspace fixture.\n`,
      '.gitignore': 'node_modules/\ndist/\n*.log\n',
      'package.json': JSON.stringify({ name: `@acme/${name}`, version: '1.0.0', private: true }, null, 2) + '\n',
      'src/index.ts': "export const name = 'api-server'\n"
    })
    commitAll(repoDir, 'Initial commit')
    for (let c = 1; c <= 6; c++) {
      writeTree(repoDir, { [`src/module-${c}.ts`]: `export const module${c} = ${c}\n` })
      commitAll(repoDir, `Add module ${c}`)
    }
    git(repoDir, ['tag', 'v1.2.0'])
    git(repoDir, ['checkout', '-q', '-b', 'refactor/auth'])
    appendLine(join(repoDir, 'src/index.ts'), 'export const auth = true\n')
    commitAll(repoDir, 'Rework auth wiring')
    git(repoDir, ['checkout', '-q', 'main'])
    stats.tags++
    stats.branches++
    return
  }

  writeTree(repoDir, {
    'README.md': `# ${name}\n\nPart of the acme workspace fixture.\n`,
    '.gitignore': 'node_modules/\ndist/\n*.log\n'
  })
  commitAll(repoDir, 'Initial commit')
  writeTree(repoDir, {
    'package.json': JSON.stringify({ name: `@acme/${name}`, version: '0.1.0', private: true }, null, 2) + '\n',
    'src/index.ts': `export const name = '${name}'\n`
  })
  commitAll(repoDir, 'Add package manifest')
  if (clock % 2 === 0) {
    appendLine(join(repoDir, 'src/index.ts'), 'export const ready = true\n')
    commitAll(repoDir, 'Add readiness flag')
  }
  if (relPath === 'website/docs-site') {
    writeTree(repoDir, {
      'docs/getting-started.md': '# Getting started\n\nOpen the workspace and pick a repository.\n',
      'docs/中文快速开始.md': '# 快速开始\n\n打开工作区，选择一个仓库即可开始。\n'
    })
    commitAll(repoDir, 'Add guides')
  }
}

/** Leaves a mix of dirty, staged, untracked, and extra-branch states behind. */
function applyVariation(repoDir, index, relPath) {
  if (relPath === 'app/mobile-app' || relPath === LARGE_REPO) return
  if (index % 9 === 5) {
    git(repoDir, ['checkout', '-q', '-b', `feature/cleanup-${index}`])
    appendLine(join(repoDir, 'README.md'), '\nCleanup in progress.\n')
    commitAll(repoDir, 'Start cleanup')
    git(repoDir, ['checkout', '-q', 'main'])
    stats.branches++
  }
  if (index % 5 === 4) {
    git(repoDir, ['tag', 'v0.1.0'])
    stats.tags++
  }
  if (index % 6 === 1) {
    writeTree(repoDir, { 'scratch.tmp': 'local scratch\n' })
    stats.untracked++
  } else if (index % 6 === 3) {
    appendLine(join(repoDir, 'README.md'), '\nStaged change pending review.\n')
    git(repoDir, ['add', 'README.md'])
    stats.staged++
  } else if (index % 3 === 0) {
    appendLine(join(repoDir, 'README.md'), '\nWork in progress.\n')
    stats.dirty++
  }
}

/**
 * One repository with a large, branched history via a single `git fast-import`
 * stream — a linear main line with a two-commit topic branch merged in every
 * 100 commits, so the graph shows real lanes.
 */
function createLargeRepo(repoDir, count) {
  initRepo(repoDir)
  const chunks = []
  const say = (line) => chunks.push(line, '\n')
  const data = (text) => {
    say(`data ${Buffer.byteLength(text)}`)
    chunks.push(text, '\n')
  }
  let mark = 0
  let mainMark = 0
  let pendingTopic = 0
  for (let c = 1; c <= count; c++) {
    const ts = Math.floor(EPOCH / 1000) + c * 60
    if (c % 100 === 50) {
      let topicFrom = mainMark
      for (let t = 1; t <= 2; t++) {
        say('commit refs/heads/topic')
        say(`mark :${++mark}`)
        say(`author ${AUTHOR.name} <${AUTHOR.email}> ${ts} +0000`)
        say(`committer ${AUTHOR.name} <${AUTHOR.email}> ${ts + t} +0000`)
        data(`topic work ${c}.${t}`)
        say(`from :${topicFrom}`)
        say('M 100644 inline topic.txt')
        data(`topic ${c}.${t}`)
        topicFrom = mark
      }
      pendingTopic = mark
    }
    const merge = c % 100 === 0 && pendingTopic !== 0
    say('commit refs/heads/main')
    say(`mark :${++mark}`)
    say(`author ${AUTHOR.name} <${AUTHOR.email}> ${ts} +0000`)
    say(`committer ${AUTHOR.name} <${AUTHOR.email}> ${ts} +0000`)
    data(merge ? `Merge topic ${c}` : `Generator commit ${c}`)
    if (mainMark !== 0) say(`from :${mainMark}`)
    if (merge) say(`merge :${pendingTopic}`)
    say('M 100644 inline history.txt')
    data(`release ${c}`)
    mainMark = mark
    if (merge) pendingTopic = 0
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repoDir,
    env: baseEnv,
    input: chunks.join(''),
    encoding: 'utf8',
    windowsHide: true
  })
  git(repoDir, ['reset', '-q', '--hard', 'main'])
  for (const [tag, skip] of [
    ['v0.5.0', Math.floor(count / 4)],
    ['v1.0.0', Math.floor((count * 3) / 4)]
  ]) {
    if (skip <= 0 || skip >= count) continue
    const sha = git(repoDir, ['rev-list', 'main', `--skip=${skip}`, '-1']).trim()
    if (sha === '') continue
    git(repoDir, ['tag', tag, sha])
    stats.tags++
  }
}

function createWorktrees(root) {
  for (const wt of WORKTREES) {
    const repoDir = join(root, wt.repo)
    const wtDir = join(root, '__worktree__', wt.dir)
    mkdirSync(dirname(wtDir), { recursive: true })
    git(repoDir, ['worktree', 'add', '-b', wt.branch, wtDir])
    appendLine(join(wtDir, 'README.md'), `\nWorktree branch: ${wt.branch}\n`)
    commitAll(wtDir, wt.commit)
  }
  appendLine(join(root, '__worktree__', WORKTREES[0].dir, 'src/index.ts'), 'export const darkMode = true\n')
}

const opts = parseArgs(process.argv.slice(2))

try {
  git(REPO_ROOT, ['--version'])
} catch {
  fail('git is required on PATH')
}

if (existsSync(opts.out)) {
  if (!opts.force) fail(`${opts.out} already exists; pass --force to regenerate`)
  rmSync(opts.out, { recursive: true, force: true })
}
mkdirSync(opts.out, { recursive: true })

createLooseFolders(opts.out)
createNodeModulesNoise(opts.out)

const repos = Object.entries(GROUPS).flatMap(([group, names]) => names.map((name) => `${group}/${name}`))
for (const [index, relPath] of repos.entries()) {
  console.log(`  [${index + 1}/${repos.length}] ${relPath}`)
  if (relPath === LARGE_REPO) {
    if (opts.largeCommits > 0) {
      createLargeRepo(join(opts.out, relPath), opts.largeCommits)
      stats.repos++
    }
    continue
  }
  const repoDir = join(opts.out, relPath)
  initRepo(repoDir)
  seedRepo(repoDir, relPath)
  applyVariation(repoDir, index, relPath)
  stats.repos++
}

createWorktrees(opts.out)

const duration = ((Date.now() - started) / 1000).toFixed(1)
console.log(`
acme fixture workspace generated
  target:       ${opts.out}
  repositories: ${stats.repos}${opts.largeCommits > 0 ? ` (history-lab: ${opts.largeCommits} commits)` : ''}
  worktrees:    ${WORKTREES.length} under __worktree__/
  states:       ${stats.dirty} dirty · ${stats.staged} staged · ${stats.untracked} untracked · ${stats.branches} extra branches · ${stats.tags} tags
  duration:     ${duration}s
`)
