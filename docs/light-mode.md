# Astra Web UI — Light Mode Style Documentation

Version 1.0 — 2026-09-25. Companion to the brand tokens in `src/index.css`.
Dark mode remains the default; light mode is an equal-citizen alternative.

## Principles

1. **Same brand, new ground.** Accents keep the brand hue family; only lightness
   changes. Surfaces invert from space-black to cool paper white.
2. **Contrast is law.** Every text/accent pair meets WCAG AA (≥4.5:1 normal
   text, ≥3:1 large text/UI borders). Measured values below.
3. **One source of truth.** Light mode overrides the same CSS custom properties
   the dark theme defines (`--color-*` tokens). Tailwind v4 utilities reference
   these vars, so components need zero per-theme code.

## Palette

### Surfaces (light)

| Token | Dark value | Light value | Role |
|---|---|---|---|
| `--color-void` | `#0a0a0f` | `#f5f2ec` | App background |
| `--color-midnight` | `#12121a` | `#fdfcf9` | Raised surfaces, cards, sidebar |
| `--color-depth` | `#1a1a2e` | `#ece8df` | Overlays, wells |
| `--color-surface` | `#252538` | `#e1dcd1` | Step-2 surfaces, inputs |

Background `#f5f2ec` (warm paper, not pure white — owner found pure white
too harsh) lets true-white-ish cards float with a hairline.

### Text (light)

| Token | Dark | Light | Contrast on `#f7f8fb` |
|---|---|---|---|
| `--color-brandtext` | `#f8fafc` | `#0f172a` | **16.8:1** |
| `--color-muted` | `#6b7280` | `#5b6472` | **5.6:1** |

### Brand accents — darkened for light surfaces

| Token | Dark | Light | Darkening | Contrast on bg |
|---|---|---|---|---|
| `--color-cyanx` | `#22d3ee` | `#0e7490` | cyan-600 family | **5.1:1** |
| `--color-violetx` | `#8b5cf6` | `#6d28d9` | violet-700 family | **6.7:1** |
| `--color-fuchsiax` | `#d946ef` | `#a21caf` | fuchsia-700 family | **6.0:1** |
| `--color-redx` | `#f87171` | `#dc2626` | red-600 family | **4.6:1** |

The site's brand accent **blue** is served by the darkened cyan `#0e7490`
(same hue family as `#22d3ee`, blues-shifted teal) and **green** by Tailwind
emerald `#047857` (5.2:1) where green accents appear — both pass AA for text
and icon use on the light ground.

### Neutrals — the inversion trick

Hardcoded neutrals are remapped so existing markup needs no edits:

| Token | Dark (semantic) | Light (semantic) |
|---|---|---|
| `--color-white` | literal white (hairlines `white/10`) | ink `#0f172a` (hairlines become `ink/10`) |
| `--color-black` | literal black (input fills `black/70`) | white `#ffffff` (input fills become washed white) |
| `--color-slate-300..700` | light→dark ramp | reversed ramp (`#334155`…`#94a3b8`) |

Hairlines `border-white/[0.07]` become 7% ink on paper — the correct visual
equivalent. Glow shadows (`shadow-[0_0_16px_rgba(34,211,238,…)]`) are literal
rgba and intentionally kept: on light ground a soft cyan glow reads as a
brand halo, matching the logo's drop-shadow treatment.

## Rules

- Never hardcode hex in components; use tokens (`bg-void`, `text-brandtext`,
  `border-cyanx/30`). Anything literal stays literal by design decision only.
- New accent colors must ship in both themes and pass contrast in both.
- Opacity modifiers compose correctly (`cyanx/20` uses the darkened light
  value on light ground automatically).
- Toggle semantics: `role="switch"`, `aria-checked`, labels "Light mode" /
  "Dark mode"; preference persists in `localStorage["astra-theme"]`.
- Anti-flash: an inline script in `index.html` applies the saved theme before
  first paint; `theme-color` meta follows the active theme.

## Verification

```bash
node -e "/* contrast check */" # see repo scratch, or:
python3 - <<'EOF'
# WCAG ratio helper used for the table above
def lum(c):
    r,g,b=[int(c[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda x: x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4
    r,g,b=f(r),f(g),f(b); return 0.2126*r+0.7152*g+0.0722*b
def ratio(a,b):
    la,lb=sorted((lum(a),lum(b)),reverse=True); return (la+0.05)/(lb+0.05)
print(ratio("0f172a","f7f8fb"), ratio("0e7490","f7f8fb"), ratio("047857","f7f8fb"))
EOF
```

## AI component layer (2026-09-29 chronological timeline)

Per-segment rows (ai-tool-call based; thoughts use the `.ai-thought` variant):

| Element | Dark | Light | Notes |
|---|---|---|---|
| `.ai-thought .ai-plate` | `rgba(250,204,21,.10)` bg / `#fbbf24` icon | `rgba(180,83,9,.10)` / `#b45309` | amber lightbulb plate on Thinking rows |
| `.ai-card` border | `rgba(248,250,252,.08)` | `rgba(15,23,42,.10)` | tool rows keep card chrome; thought rows are chrome-less |
