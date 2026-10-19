# MAXBALL Design Reference

## Direction And Scope

Preserve the existing Kazakh feedback workspace, not a new marketing landing
page. The user's reference is [TENEASY](https://teneasy.vercel.app/TENEASY.dc.html)
for VISUAL direction only: visible brand, original illustrated backdrop, bright
working surfaces, compact clear navigation and readable status indicators.
Do not copy its code, user/account data or LMS, XP, games or learning-map features.
No requirement to use a particular design agent remains when a good reference is
provided. This reference and committed screenshots guide the coding agent.

## Existing Assets And Evidence

- [Desktop baseline](screenshots/desktop.jpg), 1280x720.
- [Mobile baseline](screenshots/mobile.jpg), 390x844.
- Original transparent [logo](../public/maxball-logo.png).
- Original bitmap [space background](../public/space-background.png).
- Provenance/prompts: [earlier design decisions](decisions-2026-10-19.md).

Screenshots are a baseline, not proof every later screen passed QA. Preserve the
assets and capture new local screenshots for changed states. No private reference
account screenshots or real owner/contact details belong in the repository.

## Current Tokens

Read src/app/globals.css before UI edits. Existing root values at this checkpoint:

| Token | Value | Role |
| --- | --- | --- |
| --blue | #2762e7 | Primary selected/action state |
| --ink | #20293b | Primary text |
| --muted | #7a8292 | Secondary text |
| --line | #e9ecf2 | Subtle separators |
| --surface | #f7f8fb | Quiet working background |
| --green | #158965 | Positive/resolved state |
| --amber | #b77b0d | Pending/warning state |
| --red | #c84b60 | Error/moderation state |
| --sidebar | 224px | Desktop navigation width |

Font is Arial/Helvetica Neue/system sans-serif, baseline body 14px/1.5, h1 25px,
h2 19px, h3 15px; letter spacing is zero. Preserve compact working density and
non-blue status/teacher accents rather than replacing the UI with a monochrome
theme. Existing input radius is 6px. Avoid unneeded restyling during service and
storage changes; new repeated cards stay at 8px radius or below.

## Interaction And Responsive Rules

- Keep feed/detail, guest receipt, teacher ratings, reports and leadership views
  easy to enter/leave. First screen is the usable app, not feature marketing.
- Use existing Lucide icons with accessible names/tooltips; use appropriate
  selects, checkboxes and numeric controls rather than decorative text pills.
- Label status with readable text as well as color. Forms need visible labels,
  field errors, preserved values and disabled/pending states without layout jumps.
- Navigation, icon controls, counters and rating stars have stable dimensions.
  Text wraps without clipping/overlap; do not scale font size with viewport width.
- Keep keyboard focus visible, dialogs focus-contained and dismissible, hidden
  mobile navigation out of the focus order, and controls reachable on touch.
- Page sections stay unframed; avoid nested cards, oversized hero headings or new
  decorative gradients/orbs. The bitmap background must not reduce text contrast.
- Test 1280x720, 390x844 and 320x780: loaded assets, no horizontal overflow,
  coherent wrapping, dialogs/menus in view, usable loading/empty/error states.

Brand/design changes beyond these references need a groomed issue, not accidental
drift hidden in a persistence or contract change. Runtime and privacy correctness
still take precedence over visual similarity to a reference.
