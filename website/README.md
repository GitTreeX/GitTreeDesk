# Documentation site

Docusaurus site publishing `../docs` as [gittreex.github.io/GitTreeDesk](https://gittreex.github.io/GitTreeDesk/).

- Content: `../docs` (English, canonical) — `docs/guide/README.md` is the site front page (`slug: /`).
- Translations: `i18n/zh-Hans/docusaurus-plugin-content-docs/current/`, mirroring the source tree file for file. Theme chrome labels live in `i18n/zh-Hans/*.json`; refresh the skeleton with `pnpm write-translations --locale zh-Hans`.
- Layout and branding: `docusaurus.config.ts`, `sidebars.ts`, `src/css/custom.css`, `static/img` (copied from `../brand`).

This folder is its own pnpm workspace, so installing the site never pulls the desktop app's
Electron and native toolchain, and vice versa.

```bash
pnpm install          # run inside this folder
pnpm start            # dev server with hot reload
pnpm build            # static bundle in build/
pnpm serve            # serve the built bundle
```

`pnpm --dir website build` is what CI runs; `.github/workflows/docs.yml` deploys `build/` to
GitHub Pages on every push to `main` that touches `docs/` or `website/`.
