# Brand assets

## Concept — the commit tree

The mark is a conifer built from Git graph primitives. Each branch tier is a merge
glyph (`Λ`): two lanes converging into the trunk, capped by a commit node. Read as a
whole it is a tree; read closely it is a commit graph, which is exactly what the
workbench renders. The trunk runs from the top commit down through the workspace, so
the silhouette also carries "many repositories, one stem".

The tile is graphite with a soft inner light, and the mark uses a cool aurora ramp
(cyan → emerald → lime) so it stays legible on both light and dark desktop themes.

## Geometry

The mark is drawn in a 512 unit space and centred on `(256, 294)`; the tile is 1024
with a corner radius of 232 (macOS proportion). Stroke is monoline with round caps.

| Size class | Scale | Stroke | Nodes |
| --- | --- | --- | --- |
| `gitreedesk-icon.svg` (48px+) | 1.6 | 30 | 3 commit nodes on the trunk |
| `gitreedesk-icon-small.svg` (16–32px) | 1.8 | 38 | omitted, so the tiers stay open |

| Element | Path |
| --- | --- |
| Trunk | `M256 156 V442` |
| Tier 1 | `M200 196 L256 150 L312 196` |
| Tier 2 | `M164 288 L256 238 L348 288` |
| Tier 3 | `M126 390 L256 330 L386 390` |
| Commit nodes | `circle r=25` at `(256,156)`, `(256,244)`, `(256,332)` |

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Tile top | `#262A31` | Tile gradient start |
| Tile mid | `#15171C` | Tile gradient middle |
| Tile base | `#0B0C0F` | Tile gradient end |
| Mark cool | `#22D3EE` | Gradient start (top-left) |
| Mark mid | `#34D399` | Gradient middle |
| Mark warm | `#BEF264` | Gradient end (bottom-right) |
| Glow | `#34D399` @ 26% → `#22D3EE` @ 9% | Radial inner light |
| Edge light | `#FFFFFF` @ 7%, 3px | Tile bevel |

## Files

| File | Contents | Use for |
| --- | --- | --- |
| `svg/gitreedesk-icon.svg` | Tiled icon, full detail | 48px and above: dock, taskbar, installer, about box |
| `svg/gitreedesk-icon-small.svg` | Tiled icon, nodes dropped, stroke thickened | 16–32px: tray, window title bar, favicon |
| `svg/gitreedesk-mark.svg` | Mark only, `currentColor`, transparent | In-product artwork that must follow the theme |
| `svg/gitreedesk-mark-ink.svg` | Mark only, `#18181b` | Light backgrounds |
| `svg/gitreedesk-mark-light.svg` | Mark only, `#e4e4e7` | Dark backgrounds |

## Rules

- Keep the two optical sizes: full detail above 48px, small variant at 32px and below.
- Minimum clear space is the height of one commit node on every side.
- Do not recolour the mark outside the palette above, add drop shadows, or redraw the
  tiers as filled triangles.
- Raster exports are generated from the SVGs, never edited by hand. A 1024px PNG is the
  source for `.icns` and `.ico`.
