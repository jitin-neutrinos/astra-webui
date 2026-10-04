import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Check, SlidersHorizontal, ChevronRight, Gauge, Server, Cpu, Zap } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/upload-names";
import { splitVisible, type FitItem } from "../lib/overflow-fit";

export type Attachment = {
  id: string;
  name: string;
  size: number;
  path?: string;
  status: "uploading" | "done" | "error";
  progress?: number;
  file?: File;
  serverPath?: string;
  retried?: boolean;
};

const EFFORTS = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Maximum" },
  { id: "ultra", label: "Ultra" },
] as const;

export type CatalogPayload = {
  providers: { slug: string; label: string; models: string[] }[];
  current_provider: string;
  model?: string;
  provider?: string;
};

type Panel = null | "effort" | "provider" | "model";

// Astra motion signature (matches the app-wide cubic-bezier(0.23,1,0.32,1)).
const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

// Shared with chat-landing's drag-drop handler so dropped files get the exact
// same attachment shaping as the attach-button path.
export function filesToAttachments(files: File[]): Attachment[] {
  return files.map((f) => ({
    id: newId(),
    name: f.name,
    size: f.size,
    status: "uploading" as const,
    progress: 0,
    file: f,
  }));
}

export function ComposerControls({ setAttachments, disabled, sessionInfo, catalog, onPickModel, onPickEffort, onToggleYolo, onOpen, sessionPending }: {
  setAttachments: (fn: (a: Attachment[]) => Attachment[]) => void;
  disabled?: boolean;
  sessionInfo: any;
  catalog: CatalogPayload | null;
  onPickModel: (params: { provider: string; model: string }) => void;
  onPickEffort: (effort: string) => void;
  onToggleYolo: () => void;
  /** fired each time the popup opens - parent re-fetches the provider/model catalog */
  onOpen?: () => void;
  /** a stored chat is being resumed and its real settings have not arrived yet */
  sessionPending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [menuProvider, setMenuProvider] = useState<string | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [kb, setKb] = useState(-1); // keyboard-highlighted row index within the live panel
  const [picked, setPicked] = useState<string | null>(null);

  // ---- Priority+ overflow (owner 2026-10-04) --------------------------------
  // Which controls stay on the bar and which collapse into the options menu is a
  // LAYOUT decision, so it is measured rather than guessed: the row's real width,
  // each control's real width, and the width of the furniture that never collapses
  // (send button + hint). splitVisible() then decides, and it is a pure tested
  // function (src/lib/overflow-fit.ts) so the decision cannot drift from its tests.
  //
  // The measured widths are kept in state rather than read during render because a
  // ResizeObserver callback is not a render pass — reading layout there and calling
  // setState is the standard shape, but storing the numbers and deriving the split
  // keeps the render pure.
  const [layout, setLayout] = useState<{ avail: number; reserved: number; widths: Record<string, number> }>(
    () => ({ avail: 0, reserved: 0, widths: {} })
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    // The .chat-composer-bar row belongs to the PARENT (chat-landing), not to this
    // component, so barRef could never point at it and the first version of this
    // measurement silently returned early on every call — the controls never collapsed.
    // Measure from our own root instead: it is INSIDE that row, so its width plus the
    // row's own padding is the true space available, and it is the element that actually
    // changes width when the window does.
    const row = rootRef.current;
    if (!row) return;
    const widths: Record<string, number> = {};
    // Probe children are laid out but hidden from paint, so their widths are real
    // without ever appearing in the row (opacity/visibility, NOT display:none —
    // a display:none probe measures 0 and the whole fit calculation collapses).
    for (const el of Array.from(probeRef.current?.children ?? []) as HTMLElement[]) {
      const k = el.dataset.probe;
      if (!k) continue;
      const w = el.getBoundingClientRect().width;
      if (w > 0) widths[k] = w;
    }
    setLayout((prev) => {
      // Our root sits inside the row, so add the row's horizontal padding back to the
      // available width — otherwise we claim space that the padding already consumes and
      // the first control never quite fits.
      const rowEl = row.parentElement;
      const rowPad = rowEl ? parseFloat(getComputedStyle(rowEl).paddingLeft || "0") || 0 : 0;
      // clientWidth is only correct because CSS gives this element
      // `flex: 1 1 100%` — as a shrink-to-fit flex item it reported 164px (exactly the
      // width of the controls it already held), so the budget was always self-fulfilling
      // and no control was ever told to collapse. Claiming the free space makes
      // clientWidth the real available width.
      const avail = row.clientWidth + rowPad;
      // Only the send button is furniture that never collapses. The hint text is
      // deliberately NOT reserved: it sits between the controls, flexes, and soaks up
      // every spare pixel, so counting it made the row look permanently full and the
      // controls never collapsed. It stays on screen; it just does not get a budget line.
      const reserved = widths.__send ?? 0;
      if (
        prev.avail === avail && prev.reserved === reserved &&
        Object.keys(widths).length === Object.keys(prev.widths).length &&
        ["attach", "effort", "yolo"].every((k) => (prev.widths[k] ?? 0) === (widths[k] ?? 0))
      ) return prev; // no-op guard: ResizeObserver fires on sub-pixel changes too
      return { avail, reserved, widths };
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const row = rootRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);

  // Fonts load after first paint and change every control's width; remeasure once.
  useEffect(() => {
    const t = window.setTimeout(measure, 250);
    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(measure).catch(() => {});
    }
    return () => window.clearTimeout(t);
  }, [measure]);

  const fitItems: FitItem[] = useMemo(
    () => [
      // Pinned: provider + model live in the menu at EVERY width (owner's rule).
      { key: "provider", width: 0, pinned: true },
      { key: "model", width: 0, pinned: true },
      { key: "yolo", width: layout.widths.yolo ?? 0 },
      { key: "effort", width: layout.widths.effort ?? 0 },
      { key: "attach", width: layout.widths.attach ?? 0 },
    ],
    [layout.widths]
  );

  // avail=0 on the very first pass means "not measured yet" — show everything rather
  // than collapsing the row for one frame before the measurement lands.
  const { visible, hidden } = useMemo(
    () => (layout.avail > 0
      ? splitVisible(fitItems, layout.avail, layout.reserved)
      : { visible: ["yolo", "effort", "attach"], hidden: [] as string[] }),
    [fitItems, layout.avail, layout.reserved]
  );
  const onBar = (k: string) => visible.includes(k);
  const inMenu = (k: string) => hidden.includes(k);
  const fileRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Closing always drops the drill-down provider so the next open starts from the LIVE session.
  const closeAll = useCallback(() => { setOpen(false); setPanel(null); setMenuProvider(null); setKb(-1); setPicked(null); }, []);
  const menuRef = useDismiss(open, closeAll);

  const pickFiles = () => fileRef.current?.click();

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setAttachments((a) => [...a, ...filesToAttachments(files)]);
    e.target.value = "";
  };

  // Hydrate from session.info (pushed on create/resume) with catalog fallback so the
  // menu ALWAYS shows the live selection, even before the user touches anything.
  const yolo = sessionInfo?.yolo || false;
  const effort = sessionInfo?.reasoning_effort || "";
  // Catalog default (config.yaml) is only a stand-in for a brand-new chat. While a stored
  // chat is still resuming it would show the WRONG model as if it were the chat's own.
  const pending = !!sessionPending && !sessionInfo;
  const provider = sessionInfo?.provider || (pending ? "" : catalog?.provider || "");
  const model = sessionInfo?.model || (pending ? "" : catalog?.model || "");
  const unset = pending ? "Loading…" : "—";
  const activeProvider = menuProvider || provider;

  const providerLabel = (slug: string) =>
    catalog?.providers.find((p) => p.slug === slug)?.label || slug || "—";

  const effortLabel = effort === "" ? "Default" : EFFORTS.find((e) => e.id === effort)?.label || effort;
  useEffect(() => { if (panel === "model" && !menuProvider && provider) setMenuProvider(provider); }, [panel, menuProvider, provider]);

  // Reset the keyboard cursor whenever the panel content changes.
  useEffect(() => { setKb(-1); }, [panel, open]);

  const drill = (p: Panel) => { setDir(1); setPanel(p); };
  const back = () => { setDir(-1); setPanel(panel === "model" ? "provider" : null); };

  // Select-with-feedback: flash the row, then close — the menu visibly "heard" the pick.
  const pick = (key: string, act: () => void) => {
    act();
    if (key === "yolo") return; // switch stays open so the state change is visible
    setPicked(key);
    window.setTimeout(closeAll, 110);
  };

  // ---- keyboard navigation over the live panel's rows ------------------------------
  // Rows are discovered from the DOM by their data-row key, so the registry below
  // only needs to enumerate keys in tab order — never rendered nodes.
  const rows: string[] = panel === null
    ? ["attach", "provider", "model", "effort", "yolo"]
    : panel === "effort"
      ? (effort === "" ? ["effort:"] : []).concat(EFFORTS.map((e) => "effort:" + e.id))
      : panel === "provider"
        ? (catalog?.providers || []).map((p) => "prov:" + p.slug)
        : (() => {
            const list = catalog?.providers.find((p) => p.slug === activeProvider)?.models || [];
            const full = activeProvider === provider && model && !list.includes(model) ? [model, ...list] : list;
            return full.map((m) => "model:" + m);
          })();

  const rowByKey = (key: string) => sheetRef.current?.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(key)}"]`);

  const actByKey = (key: string) => {
    const el = rowByKey(key);
    if (el) el.click();
  };

  const onSheetKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    if (rows.length === 0) return;
    e.preventDefault();
    if (e.key === "Enter") { if (kb >= 0) actByKey(rows[kb]); return; }
    const next = e.key === "ArrowDown"
      ? (kb + 1) % rows.length
      : (kb - 1 + rows.length) % rows.length;
    setKb(next);
    rowByKey(rows[next])?.scrollIntoView({ block: "nearest" });
  };

  const sheetIn = reduce
    ? { opacity: 1 }
    : { opacity: 1, transform: "translateY(0px) scale(1)" };
  const sheetOut = reduce
    ? { opacity: 0 }
    : { opacity: 0, transform: "translateY(8px) scale(0.97)" };
  const sheetInit = reduce
    ? { opacity: 0 }
    : { opacity: 0, transform: "translateY(6px) scale(0.96)" };

  const panelInit = reduce ? { opacity: 0 } : { opacity: 0, transform: `translateX(${dir * 16}px)`, filter: "blur(2px)" };
  const panelIn = reduce ? { opacity: 1 } : { opacity: 1, transform: "translateX(0px)", filter: "blur(0px)" };

  const itemVariants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(5px)" },
    show: (i: number) => ({
      opacity: 1,
      ...(reduce ? {} : { transform: "translateY(0px)" }),
      transition: { duration: 0.16, ease: EASE, delay: 0.02 + i * 0.03 },
    }),
  };

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-1.5"
      ref={(el) => { rootRef.current = el; menuRef.current = el as any; }}>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles}
        aria-hidden="true" tabIndex={-1} />

      <button type="button" className="chat-chip chat-chip-options" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-controls="composer-options"
        aria-label={hidden.length ? `Composer options (${hidden.length} more)` : "Composer options"}
        title="Session settings"
        data-overflow={hidden.length || undefined}
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); setPanel(null); setMenuProvider(null); }}>
        <SlidersHorizontal className="cmenu-trigger-ico h-4 w-4" strokeWidth={1.5} />
        {/* A count badge only while something is collapsed, so the trigger itself does
            not change width when it appears/disappear (which would re-trigger the fit). */}
        {hidden.length > 0 && <span className="chat-chip-badge" aria-hidden="true">{hidden.length}</span>}
      </button>

      {/* ---- controls that FIT stay on the bar ---- */}
      {onBar("yolo") && (
        /* ICON-ONLY (owner 2026-10-04): every control on the bar is a square glyph. The
           state a label used to carry now rides the icon's COLOUR and the aria-label, so
           nothing is lost — a screen reader still announces "Yolo mode on", and the
           title gives the same detail on hover. */
        <button type="button" role="switch" aria-checked={yolo} data-bar="yolo"
          className={cn("chat-chip chat-chip-icon", yolo && "chat-chip-on")}
          aria-label={yolo ? "Yolo mode on" : "Yolo mode off"}
          title={yolo ? "Yolo on — tool calls run without asking" : "Yolo off — tool calls need your approval"}
          onClick={() => onToggleYolo()}>
          <Zap className={cn("h-4 w-4", yolo && "chat-chip-ico-on")} strokeWidth={1.5} />
        </button>
      )}
      {onBar("effort") && (
        <button type="button" data-bar="effort" className="chat-chip chat-chip-icon"
          aria-label={`Reasoning effort: ${effortLabel}`}
          title={`Reasoning effort: ${effortLabel}`}
          onClick={() => { if (!open) onOpen?.(); setOpen(true); setPanel("effort"); }}>
          <Gauge className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}
      {onBar("attach") && (
        <button type="button" data-bar="attach" className="chat-chip chat-chip-icon"
          aria-label="Attach files" title="Attach files"
          onClick={() => { pickFiles(); }}>
          <Paperclip className="h-4 w-4" strokeWidth={1.5} />
        </button>
      )}

      {/* ---- measurement probes ----
          Real, laid-out copies of every collapsible control (plus the two pieces of
          furniture that never collapse) so their intrinsic widths can be read without
          painting them. `visibility:hidden` keeps layout AND measurement working; a
          display:none probe measures 0 and the fit would collapse the row on load. */}
      <span ref={probeRef} className="chat-bar-probe" aria-hidden="true">
        <span data-probe="yolo" className="chat-chip chat-chip-icon"><Zap className="h-4 w-4" strokeWidth={1.5} /></span>
        <span data-probe="effort" className="chat-chip chat-chip-icon"><Gauge className="h-4 w-4" strokeWidth={1.5} /></span>
        <span data-probe="attach" className="chat-chip chat-chip-icon"><Paperclip className="h-4 w-4" strokeWidth={1.5} /></span>
        <span data-probe="__send" className="chat-send composer-bar-card .chat-send" />
        <span data-probe="__hint" className="chat-composer-hint" />
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            className="cmenu" id="composer-options" role="dialog" aria-label="Session settings"
            ref={sheetRef} tabIndex={-1} onKeyDown={onSheetKey}
            initial={sheetInit} animate={sheetIn} exit={sheetOut}
            transition={{ duration: reduce ? 0.1 : 0.17, ease: EASE }}
            style={{ transformOrigin: "bottom left" }}
          >
            <div className="cmenu-plate">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={panel ?? "root"}
                  className="cmenu-body"
                  initial={panelInit} animate={panelIn}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, transform: `translateX(${dir * -12}px)`, filter: "blur(2px)" }}
                  transition={{ duration: 0.14, ease: EASE }}
                >
                  {panel === null && (
                    <>
                      <header className="cmenu-head">
                        <span className="cmenu-title">Session settings</span>
                        <span className={cn("cmenu-sum", pending && "cmenu-shimmer")}>
                          {pending ? "loading…" : providerLabel(provider)}
                        </span>
                        {hidden.length > 0 && (
                          <span className="cmenu-sum" title="These controls are collapsed into this menu because the bar is narrow">
                            +{hidden.length} collapsed
                          </span>
                        )}
                      </header>

                      <motion.div variants={itemVariants} custom={0} initial="hidden" animate="show">
                        <button type="button" className="cmenu-row" data-row="attach" data-kb={kb === 0}
                          onClick={() => { pickFiles(); closeAll(); }}>
                          <Paperclip className="cmenu-ico h-4 w-4" strokeWidth={1.5} />
                          <span className="flex min-w-0 flex-col">
                            <span>Attach files</span>
                            <small>{inMenu("attach") ? "Collapsed — there is no room on the bar" : "Images, docs, sheets — or drop them in"}</small>
                          </span>
                        </button>
                      </motion.div>

                      <div className="cmenu-sep" />

                      <p className="cmenu-label">Model</p>
                      <motion.div variants={itemVariants} custom={1} initial="hidden" animate="show">
                        <button type="button" className="cmenu-row" data-row="provider" data-kb={kb === 1}
                          onClick={() => drill("provider")}>
                          <Server className="cmenu-ico h-4 w-4" strokeWidth={1.5} />
                          <span className="flex-1 truncate text-left">{provider ? providerLabel(provider) : unset}</span>
                          <ChevronRight className="cmenu-chev h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </motion.div>
                      <motion.div variants={itemVariants} custom={2} initial="hidden" animate="show">
                        <button type="button" className="cmenu-row" data-row="model" data-kb={kb === 2}
                          onClick={() => { if (provider) setMenuProvider(provider); drill("model"); }}>
                          <Cpu className="cmenu-ico h-4 w-4" strokeWidth={1.5} />
                          <span className={cn("cmenu-val", pending && "cmenu-shimmer")}>{model || unset}</span>
                          <ChevronRight className="cmenu-chev h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </motion.div>

                      <div className="cmenu-sep" />

                      <p className="cmenu-label">Reasoning</p>
                      <motion.div variants={itemVariants} custom={3} initial="hidden" animate="show">
                        <button type="button" className={cn("cmenu-row", inMenu("effort") && "cmenu-row-collapsed")} data-row="effort" data-kb={kb === 3}
                          onClick={() => { setDir(1); setPanel("effort"); }}>
                          <Gauge className="cmenu-ico h-4 w-4" strokeWidth={1.5} />
                          <span className="flex-1 truncate text-left">{effortLabel}</span>
                          <ChevronRight className="cmenu-chev h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </motion.div>

                      <motion.div variants={itemVariants} custom={4} initial="hidden" animate="show">
                        <button type="button" role="switch" aria-checked={yolo} data-row="yolo" data-kb={kb === 4}
                          className={cn("cmenu-row", picked === "yolo" && "cmenu-row-picked", inMenu("yolo") && "cmenu-row-collapsed")}
                          aria-label={yolo ? "Yolo mode on" : "Yolo mode off"}
                          title={yolo ? "Yolo on — auto-approve" : "Yolo off — ask first"}
                          onClick={() => pick("yolo", onToggleYolo)}>
                          <Zap className={cn("cmenu-ico h-4 w-4", yolo && "cmenu-ico-on")} strokeWidth={1.5} />
                          <span className="flex min-w-0 flex-1 flex-col text-left">
                            <span>Yolo mode</span>
                            <small>{yolo ? "Tool calls run without asking" : "Tool calls need your approval"}</small>
                          </span>
                          <span className={cn("cmenu-switch", yolo && "cmenu-switch-on")} aria-hidden="true">
                            <span className="cmenu-knob" />
                          </span>
                        </button>
                      </motion.div>

                      <footer className="cmenu-foot">
                        <span>↑↓ navigate</span><span>⏎ select</span><span>esc close</span>
                      </footer>
                    </>
                  )}

                  {panel === "effort" && (
                    <>
                      <header className="cmenu-head">
                        <span className="cmenu-title">Reasoning effort</span>
                        <span className="cmenu-sum">{effortLabel}</span>
                      </header>
                      {effort === "" && (
                        <button type="button" className="cmenu-row" aria-selected={true} disabled={true}>
                          <span>Provider default</span>
                          <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
                        </button>
                      )}
                      {EFFORTS.map((e) => (
                        <button key={e.id} type="button" className={cn("cmenu-row", picked === "effort:" + e.id && "cmenu-row-picked")}
                          data-row={"effort:" + e.id} aria-selected={e.id === effort}
                          onClick={() => pick("effort:" + e.id, () => onPickEffort(e.id))}>
                          <span className="flex-1 truncate text-left">{e.label}</span>
                          {e.id === effort ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2} /> : null}
                        </button>
                      ))}
                    </>
                  )}

                  {panel === "provider" && (
                    <>
                      <header className="cmenu-head">
                        <button type="button" className="cmenu-back" onClick={back} aria-label="Back">
                          <ChevronRight className="h-3.5 w-3.5 rotate-180" strokeWidth={1.5} />
                        </button>
                        <span className="cmenu-title">Provider</span>
                        <span className="cmenu-sum">{providerLabel(provider)}</span>
                      </header>
                      {!catalog ? (
                        <p className="cmenu-label">Loading catalog…</p>
                      ) : catalog.providers.length === 0 ? (
                        <p className="cmenu-label text-redx">Catalog unavailable</p>
                      ) : (
                        catalog.providers.map((p) => (
                          <button key={p.slug} type="button"
                            className={cn("cmenu-row", picked === "prov:" + p.slug && "cmenu-row-picked")}
                            data-row={"prov:" + p.slug} aria-selected={p.slug === activeProvider}
                            onClick={() => { setMenuProvider(p.slug); setDir(1); setPanel("model"); }}>
                            <span className="flex min-w-0 flex-1 flex-col text-left">
                              <span className="truncate">{p.label}</span>
                              <small>{p.models.length} model{p.models.length === 1 ? "" : "s"}</small>
                            </span>
                            {p.slug === activeProvider ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2} /> : null}
                          </button>
                        ))
                      )}
                    </>
                  )}

                  {panel === "model" && (
                    <>
                      <header className="cmenu-head">
                        <button type="button" className="cmenu-back" onClick={back} aria-label="Back to provider">
                          <ChevronRight className="h-3.5 w-3.5 rotate-180" strokeWidth={1.5} />
                        </button>
                        <span className="cmenu-title truncate">{providerLabel(activeProvider)}</span>
                        <span className={cn("cmenu-sum truncate", pending && "cmenu-shimmer")}>{model || "—"}</span>
                      </header>
                      {(() => {
                        const list = catalog?.providers.find((p) => p.slug === activeProvider)?.models || [];
                        // Live model may be custom / not in the curated list - still show it, selected.
                        return activeProvider === provider && model && !list.includes(model) ? [model, ...list] : list;
                      })().map((m) => (
                        <button key={m} type="button"
                          className={cn("cmenu-row", picked === "model:" + m && "cmenu-row-picked")}
                          data-row={"model:" + m} aria-selected={m === model && activeProvider === provider}
                          onClick={() => pick("model:" + m, () => onPickModel({ provider: activeProvider, model: m }))}>
                          <span className="flex-1 truncate text-left font-mono text-[12px]">{m}</span>
                          {m === model && activeProvider === provider ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2} /> : null}
                        </button>
                      ))}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
