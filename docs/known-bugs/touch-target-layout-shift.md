# Touch-target rule silently shifts icon-only button layouts (2026-10-04)

Owner-reported: collapsed-rail logo sat 8px left on iPad Pro 12.9, both
orientations, after a hard reload. Desktop measured 0.00px and hid it.

## Root cause (measured, commits ab19279 + ac100ed)

`src/index.css` carries a global accessibility rule:

```css
@media (pointer: coarse) {
  button, [role="tab"] { min-width: 44px; }
  button, a[href], input, select, [role="tab"] { min-height: 44px; }
}
```

Every button is content-sized on a mouse (fine pointer) but inflated to 44x44 on
touch devices. Any layout that depends on a button's intrinsic width is correct
on desktop and wrong on tablet — desktop-only verification passes while the
iPad stays broken. Compounding it: the logo button did not centre its child (a
block-level <img> pins to the button's left edge), so a 28px button looked
centred while a 44px button left an 8px gap on the right.

Second trap in the shipped fix: a `place-content: center` wrapper sizes the
grid TRACK to content, so `w-full`/`h-full` on the child resolve against a
content-sized track and the fill silently doesn't happen — the wrapper needs
`grid-cols-1 place-content-stretch`.

## Rules

- Verify any button-geometry-sensitive layout at coarse pointer, not just fine:
  `Emulation.setDeviceMetricsOverride(..., mobile=True, deviceScaleFactor=2)` +
  `Emulation.setTouchEmulationEnabled(enabled=True)` actually activates
  `(pointer: coarse)`; desktop emulation never will.
- Icon-only buttons must centre their child (`grid place-content-center`), so
  the button's own inflated width stops mattering.
- Sidebar check: `npx tsx src/lib/sidebar-logo-align.check.ts` (fails on
  re-introduced `justify-center` or a content-sized rail logo button).

## Not yet swept

The 44px rule applies to EVERY button in the app; only the sidebar logo was
fixed. Other icon-only buttons may shift on tablets too — sweep outstanding as
of this session.

## Backup-risk fact (same session, proven)

`git fetch origin main` + `git rev-list --count origin/main..HEAD` = 214
commits local-only; last successful push 2026-09-28 (d480b64). `main` has NO
upstream tracking configured. Local commits here exist nowhere else until a
`git push -u origin main` is run — owner's call, pending as of this session.
