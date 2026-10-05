import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Vault, LockKeyhole, Eye, EyeOff, Search, Check, RefreshCw, MonitorSmartphone, Copy, ShieldCheck, ChevronsUpDown, ChevronDown, ChevronUp } from "lucide-react";

// --- types ---
type VaultEntry = {
  id: string;
  key: string;
  project: string;
  harness: string;
  /** every harness this credential is wired into; one row can serve several */
  harnesses: string[];
  category: string;
  device: string;
  /** what this credential belongs to, e.g. "GitHub", "Context7" */
  service: string;
  serviceId: string;
  /** plain-English description of what it is for */
  purpose: string;
  kind: string;
  url: string | null;
  updated: number;
};
type Tab = "all" | "projects" | "harnesses" | "websites" | "tools" | "devices";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "projects", label: "Projects" },
  { id: "harnesses", label: "Harnesses" },
  { id: "websites", label: "Websites" },
  { id: "tools", label: "Tools" },
  { id: "devices", label: "Devices" },
];

const CATEGORY_TAB: Record<string, Tab> = { app: "projects", website: "websites", tool: "tools", service: "tools" };

function fmtUpdated(ms: number) {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body } as { status: number; body: Record<string, unknown> };
}

export default function VaultPage() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"checking" | "locked" | "unlocked" | "error">("checking");
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [values, setValues] = useState<Record<string, string | null>>({});
  const [devices, setDevices] = useState<{ name: string; count: number; projects: string[] }[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"key" | "project" | "updated">("key");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [revealAll, setRevealAll] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [ttlLeft, setTtlLeft] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auth on EVERY visit/init: status check runs on mount; an expired vault
  // cookie flips straight back to the gate (server never refreshes it on GET).
  useEffect(() => {
    let alive = true;
    (async () => {
      const { status, body } = await api("/api/vault/status");
      if (!alive) return;
      if (status === 401) { setPhase("error"); setLoadError("Session expired. Reload to sign in again."); return; }
      if (body.unlocked === true) {
        await loadData();
      } else {
        setPhase("locked");
        inputRef.current?.focus();
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TTL countdown while unlocked
  useEffect(() => {
    if (phase !== "unlocked" || ttlLeft === null) return;
    const t = setInterval(() => {
      setTtlLeft((v) => {
        if (v === null) return null;
        if (v <= 1000) { setPhase("locked"); setRevealed(new Set()); setRevealAll(false); return null; }
        return v - 1000;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, ttlLeft === null]);

  async function loadData() {
    setLoadError("");
    const [e, v, d] = await Promise.all([
      api("/api/vault/entries"),
      api("/api/vault/values"),
      api("/api/vault/devices"),
    ]);
    if (e.status === 403) { setPhase("locked"); inputRef.current?.focus(); return; }
    if (e.status !== 200 || v.status !== 200) { setPhase("error"); setLoadError("Vault registry unreadable. Check the server env."); return; }
    setEntries((e.body.entries as VaultEntry[]) || []);
    setValues((v.body.values as Record<string, string | null>) || {});
    setDevices((d.body.devices as { name: string; count: number; projects: string[] }[]) || []);
    setTtlLeft(typeof v.body.ttlMs === "number" ? (v.body.ttlMs as number) : null);
    setPhase("unlocked");
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    setPwBusy(true); setPwError("");
    const { status, body } = await api("/api/vault/unlock", { method: "POST", body: JSON.stringify({ password: pw }) });
    setPwBusy(false);
    if (status === 429) { setPwError(String(body.error || "Too many attempts.")); return; }
    if (status !== 200) { setPwError("Wrong security key."); setPw(""); return; }
    setPw("");
    await loadData();
  }

  async function lock() {
    await api("/api/vault/lock", { method: "POST" });
    setPhase("locked"); setRevealed(new Set()); setRevealAll(false); setTtlLeft(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyVal(id: string) {
    const val = values[id];
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
    } catch { /* clipboard unavailable */ }
  }

  // --- derived: group by service, then filter + sort ---
  //
  // A flat list of key names is unreadable: `context7.headers.Authorization`
  // next to `ASTRA_WEBUI_PASSWORD` tells you nothing about either. Grouping by
  // service answers "what is this for?" before you read a single key name, and
  // a credential shared across harnesses collapses into one row.
  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = entries;
    if (tab === "devices") return []; // devices tab renders separately
    if (tab !== "all") {
      if (tab === "projects") list = list.filter((e) => e.category === "app" || e.category === "service");
      else if (tab === "harnesses") list = list.filter((e) => (e.harnesses?.length ?? 0) > 1 || e.category === "tool");
      else list = list.filter((e) => CATEGORY_TAB[e.category] === tab);
    }
    if (needle) {
      list = list.filter((e) =>
        e.key.toLowerCase().includes(needle) ||
        (e.service || "").toLowerCase().includes(needle) ||
        (e.purpose || "").toLowerCase().includes(needle) ||
        e.project.toLowerCase().includes(needle) ||
        e.device.toLowerCase().includes(needle) ||
        (e.harnesses || []).some((h) => h.toLowerCase().includes(needle))
      );
    }
    const dir = sortDir;
    list = [...list].sort((a, b) => {
      if (sort === "key") return a.key.localeCompare(b.key) * dir;
      if (sort === "project")
        return ((a.service || a.project) + (a.project || "")).localeCompare((b.service || b.project) + (b.project || "")) * dir;
      return (a.updated - b.updated) * dir;
    });

    const byService = new Map<string, typeof list>();
    for (const e of list) {
      const name = e.service || e.project || "Other";
      if (!byService.has(name)) byService.set(name, []);
      byService.get(name)!.push(e);
    }
    return [...byService.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, q, tab, sort, sortDir]);

  const filtered = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);
  const secretCount = filtered.filter((e) => values[e.id] !== undefined).length;
  const servicesWithUrls = useMemo(
    () => filtered.filter((e) => e.url).length,
    [filtered]
  );

  // ---------------- locked gate ----------------
  if (phase === "checking") {
    return (
      <div className="flex h-full items-center justify-center" data-testid="vault-checking">
        <RefreshCw className="h-5 w-5 animate-spin text-muted" aria-hidden />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />
          <p className="text-sm text-muted">{loadError || "Vault unavailable."}</p>
        </div>
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className="flex h-full items-center justify-center px-4 py-8">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          className="w-full max-w-sm rounded-2xl border border-white/[0.07] bg-midnight/80 p-6 backdrop-blur-2xl"
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-[color:var(--color-accent)]">
              <LockKeyhole className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </span>
            <div>
              <h1 className="text-lg font-semibold leading-none">Vault locked</h1>
              <p className="mt-1 text-xs text-muted">Confirm your security key to view env vars.</p>
            </div>
          </div>
          <form onSubmit={unlock} className="space-y-3">
            <label htmlFor="vault-pw" className="sr-only">Security key</label>
            <div className="relative">
              <input
                id="vault-pw"
                ref={inputRef}
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Security key"
                className="w-full rounded-lg border border-white/[0.09] bg-void/60 py-2.5 pl-3 pr-11 text-sm outline-none transition-colors focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
              />
              {/* You cannot check a mistyped key through asterisks. */}
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide security key" : "Show security key"}
                aria-pressed={showPw}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:text-[color:var(--color-accent)]"
              >
                {showPw ? <EyeOff className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
              </button>
            </div>
            {pwError && <p className="text-xs text-[color:var(--color-redx)]" role="alert">{pwError}</p>}
            <button
              type="submit"
              disabled={pwBusy || !pw}
              className="w-full rounded-lg bg-[color:var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white transition-[transform,background-color] duration-150 hover:bg-[#075985] active:scale-[0.98] disabled:opacity-50"
            >
              {pwBusy ? "Checking…" : "Unlock"}
            </button>
          </form>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
            Values stay encrypted at rest. Unlock lasts 10 minutes.
          </p>
        </motion.div>
      </div>
    );
  }

  // ---------------- unlocked ----------------
  const shown = (id: string) => revealAll || revealed.has(id);
  const ttlLabel = ttlLeft !== null ? `${Math.floor(ttlLeft / 60000)}:${String(Math.floor((ttlLeft % 60000) / 1000)).padStart(2, "0")}` : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        {/* header */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-[color:var(--color-accent)]">
            <Vault className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-none">Vault</h1>
            <p className="mt-1 text-xs text-muted">
              {entries.length} env vars across all projects, harnesses and devices.
              {ttlLabel && <> Auto-locks in <span className="font-mono">{ttlLabel}</span>.</>}
            </p>
          </div>
          <button
            onClick={lock}
            className="rounded-lg border border-white/[0.09] px-3 py-2 text-xs font-medium transition-colors hover:bg-void/60 active:scale-[0.98]"
          >
            Lock now
          </button>
        </div>

        {/* tabs — aceternity-style sliding pill */}
        <div role="tablist" aria-label="Vault groups" className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/[0.07] bg-void/40 p-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => { setTab(t.id); }}
                className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "text-white" : "text-muted hover:text-[color:var(--color-brandtext,#e2e8f0)]"}`}
              >
                {active && (
                  <motion.span
                    layoutId="vault-tab-pill"
                    className="absolute inset-0 rounded-lg bg-accent/15 ring-1 ring-accent/30"
                    transition={reduce ? { duration: 0 } : { type: "spring", duration: 0.45, bounce: 0.18 }}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* search + sort + reveal-all */}
        {tab !== "devices" && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.5} aria-hidden />
              <label htmlFor="vault-q" className="sr-only">Search vault</label>
              <input
                id="vault-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search key, project, harness, device…"
                className="w-full rounded-lg border border-white/[0.09] bg-void/60 py-2 pl-8 pr-3 text-sm outline-none transition-colors focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
              />
            </div>
            {/* Sort: ONE control that cycles field, and a separate direction
                toggle. They used to be two buttons that both looked like they
                changed the field — the direction button displayed the current
                field name, so nothing on screen said which did what. */}
            <button
              onClick={() => setSort((s) => (s === "key" ? "project" : s === "project" ? "updated" : "key"))}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.09] px-2.5 py-2 text-xs text-muted transition-colors hover:bg-void/60 sm:flex"
              title={`Sort by ${sort === "key" ? "key" : sort === "project" ? "project" : "date updated"}`}
              aria-label={`Sort by ${sort === "key" ? "key" : sort === "project" ? "project" : "date updated"}`}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
              {sort === "key" ? "Key" : sort === "project" ? "Project" : "Updated"}
            </button>
            <button
              onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
              className="flex items-center gap-1 rounded-lg border border-white/[0.09] px-2.5 py-2 text-xs text-muted transition-colors hover:bg-void/60"
              title={sortDir === 1 ? "Ascending" : "Descending"}
              aria-label={sortDir === 1 ? "Sort ascending" : "Sort descending"}
            >
              {sortDir === 1 ? <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
              {sortDir === 1 ? "Asc" : "Desc"}
            </button>
            <button
              onClick={() => setRevealAll((v) => !v)}
              aria-pressed={revealAll}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors active:scale-[0.98] ${
                revealAll
                  ? "border-accent/30 bg-accent/10 text-[color:var(--color-accent)]"
                  : "border-white/[0.09] text-muted hover:bg-void/60"
              }`}
            >
              {revealAll ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> : <Eye className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
              {revealAll ? "Hide all" : "Reveal all"}
            </button>
          </div>
        )}

        {/* devices tab */}
        {tab === "devices" && (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.name} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-midnight/60 p-4">
                <MonitorSmartphone className="h-4 w-4 text-muted" strokeWidth={1.5} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-muted">{d.projects.join(", ")}</p>
                </div>
                <span className="rounded-[6px] bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-accent)]">
                  {d.count} {d.count === 1 ? "var" : "vars"}
                </span>
              </div>
            ))}
            {devices.length === 0 && (
              <p className="py-10 text-center text-sm text-muted">No devices in the registry yet.</p>
            )}
          </div>
        )}

        {/* entries */}
        {tab !== "devices" && (
          <>
            {filtered.length === 0 && (
              <p className="py-10 text-center text-sm text-muted" data-testid="vault-empty">
                {entries.length === 0 ? "No env vars registered yet." : "Nothing matches that search."}
              </p>
            )}
            <ul className="space-y-5" data-testid="vault-list">
              {grouped.map(([service, list]) => (
                <li key={service} className="space-y-2">
                  {/* Service header: the answer to "what is this for?" */}
                  <div className="flex flex-wrap items-center gap-2 pb-0.5">
                    <h3 className="font-display text-[15px] leading-none">{service}</h3>
                    {list[0]?.kind && (
                      <span className="rounded-md bg-void/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {list[0].kind}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-muted">
                      {list.length} {list.length === 1 ? "secret" : "secrets"}
                    </span>
                    {list[0]?.url && (
                      <a
                        href={list[0].url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-[11px] text-[color:var(--color-accent)] underline underline-offset-2 hover:opacity-80"
                      >
                        {list[0].url.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>

                  <ul className="space-y-2">
                    {list.map((e) => {
                      const val = values[e.id];
                      const isShown = shown(e.id) && val !== undefined;
                      const where = e.harnesses?.length ? e.harnesses : e.harness ? [e.harness] : ["app env"];
                      return (
                        <li
                          key={e.id}
                          className="group rounded-xl border border-white/[0.07] bg-midnight/60 p-3.5 transition-colors hover:border-accent/20"
                        >
                          {/* key + where it is used */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            <p className="min-w-0 flex-1 truncate font-mono text-sm font-medium" title={e.key}>
                              {e.key}
                            </p>
                            {where.map((h) => (
                              <span
                                key={h}
                                className="rounded-md border border-white/[0.08] bg-void/60 px-1.5 py-0.5 text-[10px] font-medium text-muted"
                              >
                                {h}
                              </span>
                            ))}
                            <span className="whitespace-nowrap text-[11px] text-muted">
                              {fmtUpdated(e.updated)}
                            </span>
                          </div>

                          {/* what it is FOR — the thing that was missing */}
                          {e.purpose && (
                            <p className="mt-1 text-[12.5px] leading-snug text-muted">{e.purpose}</p>
                          )}

                          <div className="mt-2.5 flex items-center gap-2">
                            <div
                              className="min-w-0 flex-1 overflow-hidden rounded-lg border border-white/[0.06] bg-void/50 px-2.5 py-1.5"
                              data-secret={!isShown}
                            >
                              <AnimatePresence mode="wait" initial={false}>
                                <motion.span
                                  key={isShown ? "shown" : "hidden"}
                                  initial={reduce ? false : { opacity: 0, filter: "blur(4px)" }}
                                  animate={{ opacity: 1, filter: "blur(0px)" }}
                                  exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)" }}
                                  transition={{ duration: 0.18, ease: "easeOut" }}
                                  className={`block truncate font-mono text-xs ${isShown ? "" : "vault-secret"}`}
                                  aria-hidden={!isShown}
                                >
                                  {isShown
                                    ? (val ?? "(undecryptable — vault secret changed?)")
                                    : val === undefined ? "(no value)" : "••••••••••••"}
                                </motion.span>
                              </AnimatePresence>
                            </div>
                            <button
                              onClick={() => toggleReveal(e.id)}
                              disabled={val === undefined}
                              aria-label={shown(e.id) ? `Hide ${e.key}` : `Reveal ${e.key}`}
                              aria-pressed={shown(e.id)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.09] text-muted transition-colors hover:bg-void/60 hover:text-[color:var(--color-accent)] disabled:opacity-40 active:scale-[0.96]"
                            >
                              {shown(e.id) ? <EyeOff className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                            </button>
                            <button
                              onClick={() => copyVal(e.id)}
                              disabled={!val || !shown(e.id)}
                              aria-label={`Copy ${e.key}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.09] text-muted transition-colors hover:bg-void/60 hover:text-[color:var(--color-accent)] disabled:opacity-40 active:scale-[0.96]"
                            >
                              {copied === e.id ? <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            {secretCount > 0 && (
              <p className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  {secretCount} of {filtered.length} decrypted in this view.
                </span>
                <span>Grouped into {grouped.length} {grouped.length === 1 ? "service" : "services"}.</span>
                {servicesWithUrls > 0 && <span>{servicesWithUrls} with a link to the provider.</span>}
                <span>Revealed values re-hide on lock.</span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
