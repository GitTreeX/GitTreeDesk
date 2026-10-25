# README screenshot

Regenerates [`docs/images/gitreedesk-workspace.png`](../../docs/images/gitreedesk-workspace.png), the hero image at the top of the README.

## Usage

```bash
pnpm install
pnpm build               # capture.mjs drives the built app in apps/desktop/out
pnpm screenshot:readme
```

1. `generate-workspace.mjs` creates a throwaway multi-repo workspace under `.fixtures/readme-screenshot/workspace`, with bare remotes beside it. Commit authors, messages, and dates are fixed, so the workspace is reproducible.
2. `capture.mjs` launches the app with an isolated Electron profile, opens the workspace, pins two diffs, switches the sidebar to the Repos tab, and captures the window.
3. The image is written to `docs/images/gitreedesk-workspace.png`.

Both scripts accept `--out <dir>` to build the workspace elsewhere. The capture script debugs the app over CDP on port 9411.

Requirements: Git on PATH. `.fixtures/` is gitignored.
