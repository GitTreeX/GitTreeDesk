import { themes as prismThemes } from 'prism-react-renderer'
import type { EditUrlFunction } from '@docusaurus/plugin-content-docs'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const repoUrl = 'https://github.com/GitTreeX/GitTreeDesk'

// English content is authored in ../docs and is canonical; the zh-Hans tree under
// i18n/ mirrors it file for file, so an edited page always maps back to real source.
const editUrlFor: EditUrlFunction = ({ locale, docPath }) =>
  locale === 'en'
    ? `${repoUrl}/edit/main/docs/${docPath}`
    : `${repoUrl}/edit/main/website/i18n/${locale}/docusaurus-plugin-content-docs/current/${docPath}`

const config: Config = {
  title: 'GitTreeDesk',
  tagline: 'Workspace-first multi-repo Git workbench',
  favicon: 'img/gitreedesk-icon-small.svg',
  url: 'https://gittreex.github.io',
  baseUrl: '/GitTreeDesk/',
  trailingSlash: false,
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh-Hans'],
  },
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          exclude: ['draft/**'],
          showLastUpdateTime: true,
          editUrl: editUrlFor,
        } satisfies Preset.Options['docs'],
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        } satisfies Preset.ThemeConfig,
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/gitreedesk-icon.svg',
    colorMode: {
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'GitTreeDesk',
      logo: {
        alt: 'GitTreeDesk logo',
        src: 'img/gitreedesk-icon-small.svg',
        href: '/',
      },
      items: [
        { type: 'doc', docId: 'guide/README', position: 'left', label: 'Guide' },
        { type: 'doc', docId: 'spec', position: 'left', label: 'Specification' },
        { type: 'localeDropdown', position: 'left' },
        {
          href: `${repoUrl}/releases`,
          label: 'Downloads',
          position: 'right',
        },
        {
          href: repoUrl,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Guide',
          items: [
            { label: 'Getting started', to: '/' },
            { label: 'FAQ & troubleshooting', to: '/guide/faq' },
          ],
        },
        {
          title: 'Reference',
          items: [
            { label: 'Specification', to: '/spec' },
            { label: 'Changelog', href: `${repoUrl}/blob/main/CHANGELOG.md` },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: repoUrl },
            { label: 'Releases', href: `${repoUrl}/releases` },
          ],
        },
      ],
      copyright: 'Copyright © 2026 GitTreeDesk contributors · MIT license',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'ini', 'json', 'sql', 'toml', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
