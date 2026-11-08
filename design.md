<!-- Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V3 -->
# Design — LayerFS Connect

Approved Cindy theme migration, 2026-11-07. Owner direction: one light theme,
closer Cindy geometry, no wallpaper options and no mobile testing. This is the shared visual system for
Chat, Projects, Machines, Storage and Settings. Preserve their behavior and
LayerFS terminology while extending the system consistently across surfaces.

## System and provenance

Genre: modern-minimal. App structure: Workbench with a continuous window canvas,
quiet sidebar, compact navigation and focused content. No marketing decoration.
The reference is the user-supplied Cindy screenshot and makecindy/cindy commit
`5c1ddeeab20476e9fc8fd40a99ad19ac958b7006`. Colors and geometry were verified
against its desktop theme source; screenshot motion was not inferred.

Cindy's code is Apache-2.0; adapted semantic theme values retain this source
credit (Cindy, Copyright 2026 XD Inc.). Connect keeps its own product identity
and artwork. No Cindy logo or character wallpaper is bundled.

## Tokens and typography

`src/renderer/src/tokens.css` holds the single light semantic palette and compatibility
aliases for Connect's existing shadcn consumers. `cindy-theme.css` adapts shared
surfaces; the existing `styles.css` keeps its framework imports and utilities.
Use existing semantic names rather than inline component colors. Use a cool neutral light-gray canvas and milky near-white raised surfaces. Use `--success`, `--warning`, `--destructive` for status and
`--link` / `--ring` for links and focus. Brand colors are limited to identity art.

Inter Variable is the UI family, with system/CJK fallbacks. Monospace is reserved
for code and identifiers. Foundation text is 14px; conversation text is 15px.
Ordinary action controls use pills; secondary tabs use compact 6px corners,
the composer and content cards 12px, panels 16px. Top-level page headers use
20px medium titles and small unboxed glyphs. Navigation and session rows follow
the supplied Cindy reference, with session status and timestamps from real data. Spacing follows the
existing 4px scale, with named 8/12/16/24/32px tokens for shared adapters.

## Surfaces

One fixed light canvas spans the main work area. On macOS the sidebar uses
native sidebar vibrancy under an 85% neutral tint; other platforms use the
solid neutral fallback. There is no theme selector.
There are no wallpaper options (owner decision, 2026-11-07). The composer uses a 90% milky white material with a fine outline and a minimal
contact shadow. Technical data, menus, dialogs, code, diffs and editor surfaces
use opaque semantic fills. Texture comes from the native material, never grain
or blue bevels. Avoid
backdrop-filter on the composer because it changes fixed palette layout.

## Interaction and accessibility

Use neutral ink hover/pressed states, visible blue keyboard focus, and explicit
status labels alongside colors. Default controls have no decorative shadows;
floating menus/dialogs may use the shared panel shadow. Fast/base/entry motion
uses 150/200/250ms; respect reduced motion. Success stays quiet.

Keep model/thinking, folder/project/Store context, attachments, queue/Steer/stop,
recovery, session navigation, simulation indicators and destructive confirmations.
Do not add Cindy-only controls without their behavior. At compact renderer widths,
the sidebar is a dismissible overlay and the composer toolbar wraps. The native
app retains its existing 900px minimum width.

## Exports

The drop-in CSS export is `src/renderer/src/tokens.css`, using existing shadcn
variable names (`--background`, `--foreground`, `--card`, `--primary`, `--border`,
`--ring`) and the Tailwind v4 `@theme inline` mappings already in `styles.css`.
Do not regenerate an independent palette per page.
