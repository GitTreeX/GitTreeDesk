#!/usr/bin/env node
/**
 * Builds the demo workspace used by the README screenshot: grouped repositories,
 * linked worktrees, dirty/staged/untracked changes, ahead/behind branches and
 * deterministic authors, messages and dates.
 *
 * Everything is written under .fixtures/readme-screenshot/ (gitignored) and can
 * be regenerated at any time. Requires Git on PATH.
 *
 * Usage:
 *   node examples/readme-screenshot/generate-workspace.mjs [--out <dir>] [--remotes <dir>]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')

function parseArgs(argv) {
  const options = {
    out: join(repoRoot, '.fixtures', 'readme-screenshot', 'workspace'),
    remotes: undefined
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out' || arg === '--remotes') {
      const value = argv[i + 1]
      if (!value) throw new Error(`${arg} needs a value`)
      i += 1
      if (arg === '--out') options.out = resolve(value)
      else options.remotes = resolve(value)
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node examples/readme-screenshot/generate-workspace.mjs [--out <dir>] [--remotes <dir>]')
      process.exit(0)
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  options.remotes ??= join(dirname(options.out), 'remotes')
  return options
}

const options = parseArgs(process.argv.slice(2))
const root = options.out
const remotes = options.remotes
const workDir = dirname(root)

if (existsSync(root)) rmSync(root, { recursive: true, force: true })
if (existsSync(remotes)) rmSync(remotes, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
mkdirSync(remotes, { recursive: true })

const base = Date.UTC(2026, 8, 1, 9, 0, 0)
let tick = 0

const people = {
  maya: { name: 'Maya Chen', email: 'maya@northstar.dev' },
  liam: { name: 'Liam Patel', email: 'liam@northstar.dev' },
  sofia: { name: 'Sofia Rossi', email: 'sofia@northstar.dev' },
  daniel: { name: 'Daniel Kim', email: 'daniel@northstar.dev' },
  aisha: { name: 'Aisha Rahman', email: 'aisha@northstar.dev' }
}

function git(cwd, args, extraEnv = {}) {
  tick += 3_600_000
  const date = new Date(base + tick).toISOString()
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      ...extraEnv
    }
  }).toString()
}

function write(cwd, path, content) {
  const target = join(cwd, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function initRepo(path, author) {
  const cwd = join(root, path)
  mkdirSync(cwd, { recursive: true })
  git(cwd, ['init', '-q', '-b', 'main'])
  git(cwd, ['config', 'user.name', author.name])
  git(cwd, ['config', 'user.email', author.email])
  git(cwd, ['config', 'core.autocrlf', 'false'])
  return cwd
}

function commit(cwd, author, message, files) {
  for (const [path, content] of Object.entries(files)) write(cwd, path, content)
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '-q', '-m', message], {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email
  })
}

function bareRemote(name) {
  const path = join(remotes, `${name}.git`)
  mkdirSync(path, { recursive: true })
  git(path, ['init', '-q', '--bare', '-b', 'main'])
  return path
}

function attachRemote(cwd, name) {
  const remote = bareRemote(name)
  git(cwd, ['remote', 'add', 'origin', remote])
  git(cwd, ['push', '-q', '-u', 'origin', 'main'])
  return remote
}

// ---------------------------------------------------------------- workspace

const workspaceFile = `.gitreedesk/workspace.json`
mkdirSync(join(root, '.gitreedesk'), { recursive: true })
writeFileSync(
  join(root, workspaceFile),
  JSON.stringify(
    {
      name: 'Northstar Platform',
      exclude: ['**/node_modules/**', '**/dist/**'],
      scan: { maxDepth: 8, followSymlinks: false },
      groups: [
        { name: 'Apps', match: ['apps/*'] },
        { name: 'Services', match: ['services/*'] },
        { name: 'Packages', match: ['packages/*'] },
        { name: 'Infrastructure', match: ['infra/*'] },
        { name: 'Docs', match: ['docs/*'] }
      ]
    },
    null,
    2
  ) + '\n'
)
writeFileSync(join(root, 'README.md'), '# Northstar Platform\n\nShared workspace for the Northstar commerce platform.\n')

// ---------------------------------------------------------------- storefront

{
  const cwd = initRepo('apps/storefront', people.maya)
  commit(cwd, people.maya, 'Bootstrap storefront with Next.js and shared layout', {
    'package.json': JSON.stringify({ name: '@northstar/storefront', private: true, version: '2.14.0' }, null, 2) + '\n',
    'README.md': '# Storefront\n\nCustomer-facing web app.\n',
    'src/app/layout.tsx': `import type { ReactNode } from 'react'\nimport './globals.css'\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  )\n}\n`,
    'src/components/CartSummary.tsx': `import { formatMoney } from '@northstar/ui-kit'\n\ninterface CartSummaryProps {\n  subtotal: number\n  shipping: number\n  discount: number\n  currency: string\n}\n\nexport function CartSummary({ subtotal, shipping, discount, currency }: CartSummaryProps) {\n  const total = subtotal + shipping - discount\n\n  return (\n    <section className="cart-summary">\n      <Row label="Subtotal" value={formatMoney(subtotal, currency)} />\n      <Row label="Shipping" value={formatMoney(shipping, currency)} />\n      <Row label="Discount" value={\`-\${formatMoney(discount, currency)}\`} />\n      <Row label="Total" value={formatMoney(total, currency)} emphasis />\n    </section>\n  )\n}\n\nfunction Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {\n  return (\n    <div className={emphasis ? 'cart-row cart-row--total' : 'cart-row'}>\n      <span>{label}</span>\n      <span>{value}</span>\n    </div>\n  )\n}\n`,
    'src/styles/cart.css': `.cart-summary {\n  display: grid;\n  gap: 8px;\n  padding: 20px;\n  border: 1px solid var(--border);\n  border-radius: 12px;\n}\n\n.cart-row {\n  display: flex;\n  justify-content: space-between;\n  color: var(--fg-muted);\n}\n\n.cart-row--total {\n  color: var(--fg);\n  font-weight: 600;\n}\n`
  })
  commit(cwd, people.aisha, 'Add address validation to the checkout form', {
    'src/components/AddressForm.tsx': `export function AddressForm() {\n  return <form aria-label="Shipping address" />\n}\n`
  })
  commit(cwd, people.liam, 'Load product recommendations on the cart page', {
    'src/components/Recommendations.tsx': `export function Recommendations() {\n  return <aside aria-label="You may also like" />\n}\n`,
    'src/app/cart/page.tsx': `import { CartSummary } from '../../components/CartSummary'\n\nexport default function CartPage() {\n  return <CartSummary subtotal={0} shipping={0} discount={0} currency="USD" />\n}\n`
  })
  commit(cwd, people.maya, 'Persist cart state across sessions', {
    'src/lib/cart-store.ts': `const KEY = 'northstar.cart'\n\nexport function loadCart() {\n  return JSON.parse(localStorage.getItem(KEY) ?? '[]')\n}\n\nexport function saveCart(lines: unknown[]) {\n  localStorage.setItem(KEY, JSON.stringify(lines))\n}\n`
  })
  commit(cwd, people.sofia, 'fix: keep line totals stable when quantity changes', {
    'src/lib/line-totals.ts': `export function lineTotal(unitPrice: number, quantity: number): number {\n  return Math.round(unitPrice * quantity * 100) / 100\n}\n`
  })
  commit(cwd, people.liam, 'Add empty state for an expired cart session', {
    'src/components/CartEmptyState.tsx': `export function CartEmptyState() {\n  return <p>Your cart has expired. Start a new order.</p>\n}\n`
  })
  commit(cwd, people.aisha, 'Improve keyboard focus styles in the cart drawer', {
    'src/styles/focus.css': `.focus-ring:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 2px;\n}\n`
  })
  attachRemote(cwd, 'storefront')
  commit(cwd, people.maya, 'Add delivery estimate to the cart summary', {
    'src/components/DeliveryEstimate.tsx': `export function DeliveryEstimate({ days }: { days: number }) {\n  return <p>Arrives in {days} business days</p>\n}\n`
  })
  write(cwd, 'src/components/CartSummary.tsx', `import { formatMoney } from '@northstar/ui-kit'\n\ninterface CartSummaryProps {\n  subtotal: number\n  shipping: number\n  discount: number\n  currency: string\n  deliveryDays?: number\n}\n\nexport function CartSummary({ subtotal, shipping, discount, currency, deliveryDays }: CartSummaryProps) {\n  const total = subtotal + shipping - discount\n\n  return (\n    <section className="cart-summary">\n      <Row label="Subtotal" value={formatMoney(subtotal, currency)} />\n      <Row label="Shipping" value={formatMoney(shipping, currency)} />\n      {deliveryDays !== undefined && (\n        <p className="delivery-note">Estimated delivery in {deliveryDays} business days</p>\n      )}\n      <Row label="Discount" value={\`-\${formatMoney(discount, currency)}\`} />\n      <Row label="Total" value={formatMoney(total, currency)} emphasis />\n    </section>\n  )\n}\n\nfunction Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {\n  return (\n    <div className={emphasis ? 'cart-row cart-row--total' : 'cart-row'}>\n      <span>{label}</span>\n      <span>{value}</span>\n    </div>\n  )\n}\n`)
  write(cwd, 'src/styles/cart.css', `.cart-summary {\n  display: grid;\n  gap: 8px;\n  padding: 20px;\n  border: 1px solid var(--border);\n  border-radius: 12px;\n}\n\n.cart-row {\n  display: flex;\n  justify-content: space-between;\n  color: var(--fg-muted);\n}\n\n.cart-row--total {\n  color: var(--fg);\n  font-weight: 600;\n}\n\n.delivery-note {\n  margin: 0;\n  color: var(--fg-subtle);\n  font-size: 12px;\n}\n`)
}

// ---------------------------------------------------------------- checkout-api

{
  const cwd = initRepo('services/checkout-api', people.liam)
  commit(cwd, people.liam, 'Scaffold checkout service with order endpoints', {
    'go.mod': 'module northstar/checkout-api\n\ngo 1.23\n',
    'README.md': '# Checkout API\n\nOrder and payment orchestration for the storefront.\n',
    'internal/pricing/discounts.ts': `export interface Discount {\n  code: string\n  percent: number\n  minSubtotal: number\n}\n\nexport function eligibleDiscounts(\n  subtotal: number,\n  discounts: Discount[]\n): Discount[] {\n  return discounts.filter((d) => (\n    subtotal >= d.minSubtotal\n  ))\n}\n\nexport function applyDiscount(\n  subtotal: number,\n  discount: Discount\n): number {\n  const rate = discount.percent / 100\n  return subtotal * (1 - rate)\n}\n`,
    'internal/pricing/totals.ts': `export function orderTotal(subtotal: number, shipping: number, discount: number): number {\n  return Math.max(0, subtotal + shipping - discount)\n}\n`
  })
  commit(cwd, people.maya, 'Validate inventory before authorizing payment', {
    'internal/inventory/reserve.ts': `export function canReserve(available: number, requested: number): boolean {\n  return available >= requested\n}\n`
  })
  commit(cwd, people.daniel, 'Add idempotency keys to order creation', {
    'internal/orders/idempotency.ts': `export function idempotencyKey(orderId: string, attempt: number): string {\n  return \`\${orderId}:\${attempt}\`\n}\n`
  })
  commit(cwd, people.sofia, 'refactor: extract pricing rule registry', {
    'internal/pricing/rule-registry.ts': `import type { Discount } from './discounts'\n\nconst RULES = new Map<string, Discount>()\n\nexport function registerDiscount(discount: Discount): void {\n  RULES.set(discount.code, discount)\n}\n\nexport function discountFor(code: string): Discount | undefined {\n  return RULES.get(code)\n}\n`,
    'internal/pricing/discounts.ts': `export interface Discount {\n  code: string\n  percent: number\n  minSubtotal: number\n  stackable?: boolean\n}\n\nexport function eligibleDiscounts(\n  subtotal: number,\n  discounts: Discount[]\n): Discount[] {\n  return discounts.filter((d) => (\n    subtotal >= d.minSubtotal\n  ))\n}\n\nexport function applyDiscount(\n  subtotal: number,\n  discount: Discount\n): number {\n  const rate = discount.percent / 100\n  const reduced = subtotal * (1 - rate)\n  return Math.round(reduced * 100) / 100\n}\n`,
  })
  commit(cwd, people.liam, 'fix: reject expired coupons at capture time', {
    'internal/pricing/coupons.ts': `export function isExpired(expiresAt: Date, now = new Date()): boolean {\n  return expiresAt.getTime() <= now.getTime()\n}\n`
  })
  commit(cwd, people.aisha, 'Expose payment retry reason to the storefront', {
    'internal/payments/retry.ts': `export type RetryReason = 'insufficient_funds' | 'network' | 'issuer_declined'\n\nexport function retryable(reason: RetryReason): boolean {\n  return reason === 'network'\n}\n`
  })
  attachRemote(cwd, 'checkout-api')
  commit(cwd, people.daniel, 'Add structured logging around payment capture', {
    'internal/payments/log.ts': `export function logCapture(orderId: string, outcome: string): void {\n  console.info(JSON.stringify({ orderId, outcome }))\n}\n`
  })
  commit(cwd, people.sofia, 'feat: support partial refunds on captured payments', {
    'internal/payments/refunds.ts': `export function refundable(captured: number, refunded: number): number {\n  return Math.max(0, captured - refunded)\n}\n`
  })

  // Working tree: one staged change, two unstaged files, one untracked test.
  write(cwd, 'internal/pricing/rule-registry.ts', `import type { Discount } from './discounts'\n\nconst RULES = new Map<string, Discount>()\n\nexport function registerDiscount(discount: Discount): void {\n  RULES.set(discount.code, discount)\n}\n\nexport function discountFor(code: string): Discount | undefined {\n  return RULES.get(code)\n}\n\nexport function listStackable(codes: string[]): Discount[] {\n  return codes\n    .map((code) => RULES.get(code))\n    .filter((discount): discount is Discount => discount?.stackable === true)\n}\n`)
  git(cwd, ['add', 'internal/pricing/rule-registry.ts'])

  write(cwd, 'internal/pricing/discounts.ts', `export interface Discount {\n  code: string\n  percent: number\n  minSubtotal: number\n  stackable?: boolean\n}\n\nexport function eligibleDiscounts(\n  subtotal: number,\n  discounts: Discount[]\n): Discount[] {\n  return discounts.filter((d) => (\n    subtotal >= d.minSubtotal\n  ))\n}\n\nexport function applyDiscount(\n  subtotal: number,\n  discount: Discount\n): number {\n  const rate = discount.percent / 100\n  const reduced = subtotal * (1 - rate)\n  return Math.round(reduced * 100) / 100\n}\n\n/** Non-stackable first, then stackable. */\nexport function applyDiscounts(\n  subtotal: number,\n  discounts: Discount[]\n): number {\n  const rank = (d: Discount) =>\n    Number(d.stackable)\n  const ordered = [...discounts].sort(\n    (a, b) => rank(a) - rank(b)\n  )\n  return ordered.reduce(\n    (total, d) => applyDiscount(total, d),\n    subtotal\n  )\n}\n\nexport function bestSingleDiscount(\n  subtotal: number,\n  discounts: Discount[]\n): Discount | null {\n  return discounts\n    .filter((d) => subtotal >= d.minSubtotal)\n    .sort((a, b) => b.percent - a.percent)\n    .at(0) ?? null\n}\n`)
  write(cwd, 'internal/pricing/totals.ts', `export function orderTotal(subtotal: number, shipping: number, discount: number): number {\n  return Math.max(0, subtotal + shipping - discount)\n}\n\nexport function taxFor(subtotal: number, rate: number): number {\n  return Math.round(subtotal * rate * 100) / 100\n}\n`)
  write(cwd, 'internal/pricing/discounts_test.ts', `import { applyDiscounts } from './discounts'\n\ntest('stacks coupons in eligibility order', () => {\n  const total = applyDiscounts(100, [\n    { code: 'WELCOME10', percent: 10, minSubtotal: 0, stackable: true },\n    { code: 'VIP20', percent: 20, minSubtotal: 80 }\n  ])\n  expect(total).toBe(72)\n})\n`)
}

// ---------------------------------------------------------------- catalog-api

{
  const cwd = initRepo('services/catalog-api', people.daniel)
  commit(cwd, people.daniel, 'Add product search endpoint', {
    'README.md': '# Catalog API\n\nProduct catalog and search.\n',
    'src/search/index.ts': `export async function search(query: string) {\n  return { query, items: [] }\n}\n`
  })
  commit(cwd, people.aisha, 'Cache category listings for five minutes', {
    'src/search/cache.ts': `const TTL_MS = 5 * 60 * 1000\n\nexport const cacheTtl = TTL_MS\n`
  })
  commit(cwd, people.maya, 'Add cursor pagination to product lists', {
    'src/search/pagination.ts': `export function nextCursor(offset: number, limit: number): string {\n  return Buffer.from(String(offset + limit)).toString('base64')\n}\n`
  })
  const remote = attachRemote(cwd, 'catalog-api')
  const temp = resolve(workDir, 'catalog-api-tmp')
  if (existsSync(temp)) rmSync(temp, { recursive: true, force: true })
  git(root, ['clone', '-q', remote, temp])
  git(temp, ['config', 'user.name', 'Maya Chen'])
  git(temp, ['config', 'user.email', 'maya@northstar.dev'])
  commit(temp, people.maya, 'Index product variants in the search pipeline', {
    'src/search/variants.ts': `export function variantKey(productId: string, sku: string): string {\n  return \`\${productId}::\${sku}\`\n}\n`
  })
  git(temp, ['push', '-q', 'origin', 'main'])
  rmSync(temp, { recursive: true, force: true })
}

// ---------------------------------------------------------------- other repos

{
  const cwd = initRepo('apps/admin-console', people.sofia)
  commit(cwd, people.sofia, 'Add order inspection view for support agents', {
    'README.md': '# Admin Console\n\nInternal operations console.\n',
    'src/routes/orders.tsx': `export function OrdersRoute() {\n  return <main aria-label="Orders" />\n}\n`
  })
  commit(cwd, people.liam, 'Add bulk refund confirmation dialog', {
    'src/routes/refunds.tsx': `export function RefundsRoute() {\n  return <main aria-label="Refunds" />\n}\n`
  })
  attachRemote(cwd, 'admin-console')
  commit(cwd, people.sofia, 'Show payment retry reasons in the order timeline', {
    'src/features/timeline.ts': `export type TimelineEntry = { at: string; label: string }\n`
  })
  commit(cwd, people.daniel, 'Add CSV export for filtered orders', {
    'src/features/export.ts': `export function toCsv(rows: Record<string, unknown>[]): string {\n  return rows.map((row) => Object.values(row).join(',')).join('\\n')\n}\n`
  })
  commit(cwd, people.aisha, 'fix: keep filters when navigating back from an order', {
    'src/features/filters.ts': `export const DEFAULT_FILTERS = { status: 'all', window: '30d' }\n`
  })
}

{
  const cwd = initRepo('packages/ui-kit', people.maya)
  commit(cwd, people.maya, 'Publish button and input primitives', {
    'package.json': JSON.stringify({ name: '@northstar/ui-kit', version: '3.2.0' }, null, 2) + '\n',
    'src/button.tsx': `export function Button(props: { children: string }) {\n  return <button type="button">{props.children}</button>\n}\n`
  })
  commit(cwd, people.liam, 'Add money formatting helper', {
    'src/money.ts': `export function formatMoney(amount: number, currency: string): string {\n  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)\n}\n`
  })
  commit(cwd, people.sofia, 'Add focus ring tokens for dark mode', {
    'src/tokens.ts': `export const focusRing = { width: 2, offset: 2 }\n`
  })
  attachRemote(cwd, 'ui-kit')
}

{
  const cwd = initRepo('packages/design-tokens', people.aisha)
  commit(cwd, people.aisha, 'Define spacing and radius scales', {
    'tokens/spacing.json': JSON.stringify({ space: [0, 4, 8, 12, 16, 24, 32, 48], radius: [4, 8, 12, 16] }, null, 2) + '\n'
  })
  commit(cwd, people.maya, 'Add semantic color roles', {
    'tokens/colors.json': JSON.stringify({ surface: '#ffffff', panel: '#f7f7f8', accent: '#2f6fed' }, null, 2) + '\n'
  })
  attachRemote(cwd, 'design-tokens')
}

{
  const cwd = initRepo('infra/terraform', people.daniel)
  commit(cwd, people.daniel, 'Provision staging database and cache', {
    'staging/main.tf': `variable "environment" {\n  default = "staging"\n}\n`,
    'README.md': '# Infrastructure\n\nTerraform stacks for the platform.\n'
  })
  commit(cwd, people.liam, 'Add read replica for analytics queries', {
    'staging/replica.tf': `resource "aws_db_instance" "analytics" {\n  identifier = "northstar-analytics"\n}\n`
  })
  attachRemote(cwd, 'terraform')
}

{
  const cwd = initRepo('docs/handbook', people.aisha)
  commit(cwd, people.aisha, 'Document the release checklist', {
    'README.md': '# Engineering Handbook\n',
    'releases/checklist.md': '# Release checklist\n\n- [ ] Green CI\n- [ ] Changelog\n- [ ] Rollback plan\n'
  })
  commit(cwd, people.sofia, 'Add incident severity definitions', {
    'incidents/severity.md': '# Severity\n\n| Level | Impact |\n|---|---|\n| SEV1 | Customer-facing outage |\n'
  })
  attachRemote(cwd, 'handbook')
}

// ---------------------------------------------------------------- worktree

{
  const cwd = join(root, 'apps/storefront')
  git(cwd, ['branch', 'feat/checkout-redesign'])
  git(cwd, ['worktree', 'add', '-q', '../../__worktree__/storefront-checkout-redesign', 'feat/checkout-redesign'])
  const wt = join(root, '__worktree__/storefront-checkout-redesign')
  commit(wt, people.maya, 'Prototype the two-step checkout layout', {
    'src/app/checkout/layout.tsx': `export default function CheckoutLayout({ children }: { children: React.ReactNode }) {\n  return <div className="checkout-shell">{children}</div>\n}\n`
  })
  write(wt, 'src/app/checkout/page.tsx', `export default function CheckoutPage() {\n  return <main aria-label="Checkout" />\n}\n`)
}

// Non-git folder makes the Explorer view look like a real workspace.
mkdirSync(join(root, 'design/marketing'), { recursive: true })
writeFileSync(join(root, 'design/marketing/homepage.fig'), '')
writeFileSync(join(root, 'design/marketing/notes.md'), '# Homepage exploration\n')

// The remote moved ahead after the local clone, so the repo shows a "behind" badge.
git(join(root, 'services/catalog-api'), ['fetch', '-q', 'origin'])

console.log(`showcase workspace ready: ${root}`)
