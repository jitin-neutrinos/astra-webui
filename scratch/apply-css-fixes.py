import pathlib, sys

p = pathlib.Path(sys.argv[1])
t = p.read_text()

# 1) Header = sidebar glass (owner steer 10-02: same treatment, blur restored).
old_hdr = ".mobile-accent-header { background: color-mix(in srgb, var(--color-depth) 92%, transparent); backdrop-filter: blur(35px) saturate(1.3); }"
new_hdr = (
    "/* Sidebar + header: one glass treatment (29px blur + saturate 1.25 over a\n"
    "   translucent midnight ground) — owner steer 10-02. */\n"
    ".sidebar-glass { background: color-mix(in oklab, var(--color-midnight) 45%, transparent); backdrop-filter: blur(29px) saturate(1.25); }\n"
    ".mobile-accent-header { background: color-mix(in oklab, var(--color-midnight) 45%, transparent); backdrop-filter: blur(29px) saturate(1.25); }"
)

# 2) Comet linecap must be butt (owner 10-02: stray bright tile at the tail).
old_cap = ".composer-trace-step { fill: none; stroke:rgb(var(--c-9)); stroke-linecap: round;"
new_cap = ".composer-trace-step { fill: none; stroke:rgb(var(--c-9)); stroke-linecap: butt;"
already_butt = ".composer-trace-step { fill: none; stroke:rgb(var(--c-9)); stroke-linecap: butt;"

# Idempotent: a worktree built from HEAD may already carry the butt fix.
if old_cap in t:
    n = t.count(old_cap)
    assert n == 1, f"linecap butt: expected 1 match, found {n}"
    t = t.replace(old_cap, new_cap, 1)
    linecap_note = "linecap round->butt"
elif already_butt in t:
    linecap_note = "linecap already butt"
else:
    raise AssertionError("composer-trace-step rule not found in expected form")

for old, new, label in ((old_hdr, new_hdr, "header glass"),):
    n = t.count(old)
    assert n == 1, f"{label}: expected 1 match, found {n}"
    t = t.replace(old, new, 1)

p.write_text(t)
print(f"applied: header glass + {linecap_note}")