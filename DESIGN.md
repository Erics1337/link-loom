# Link Loom Design System

## Direction

Link Loom uses a Field.io-inspired Semantic Map language: saved links become a living spatial network. The UI should feel like AI cartography for personal context, not a generic dark SaaS dashboard.

## Token Rules

- Use `@link-loom/ui/theme.css` as the token source of truth.
- Prefer Tailwind classes backed by `ll-*` tokens: `bg-ll-bg`, `bg-ll-card`, `text-ll-text`, `text-ll-muted`, `border-ll-border`, `rounded-ll-md`.
- Use shared UI primitives from `@link-loom/ui` before inventing local button/card/input styles.
- Avoid raw palette utilities in app UI: `blue-*`, `gray-*`, `purple-*`, `bg-black`, arbitrary hex, and arbitrary color utilities.
- Allowed exceptions: official Google OAuth logo colors, imported brand assets, screenshots, and documented third-party badges.

## Visual Grammar

- Backgrounds: deep green-black fields with subtle signal gradients.
- Surfaces: translucent ink panels with 1px botanical borders.
- Primary action: warm signal orange.
- Structure/accent: pale mint/teal for semantic tags, links, icons, focus states.
- Status: semantic success/warning/danger tokens only.
- Radius: 8px controls, 12px panels, 18px maximum for large marketing mockups.
- Motion: one orchestrated marketing load/drift; dashboard and extension stay quiet and scannable.

## Components

- `Button`: primary, secondary, ghost, danger; no raw blue CTA.
- `Card`: default and elevated map panels.
- `Input`: dark field with mint focus border.
- `Badge`: semantic tags, plan labels, status chips.
- `Alert`: success, warning, danger, info.
- `IconButton`: square controls for settings, close, revoke, pop-out.

## Surface Guidance

- Landing: immersive semantic map, warm paper light mode acceptable.
- Login: access node panel, calm and branded.
- Dashboard: dense semantic-map workspace; rows read like linked nodes.
- Legal pages: document panels inside same field background.
- Extension: compact 400x600 control console, same token family, less decoration.

## Agent Checklist

Before finishing UI changes:

```bash
rg "blue-|gray-|purple-|bg-black|#[0-9A-Fa-f]{6}" apps/web apps/extension packages/ui
pnpm --filter @link-loom/ui exec tsc --noEmit
pnpm --filter web build
pnpm --filter extension build
```

Resolve or document every palette match.
