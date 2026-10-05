// CanvasExportView — paginated A4 report / 16:9 slide display + download.
//
// Two surfaces from ONE set of page nodes:
//   • the VIEWER renders every page, but only the current one is visible
//   • the capture pass walks the SAME nodes, so an export is exactly what the
//     user saw — one render, never two that can drift.
//
// Capturing only the visible page is the bug this replaces: page N looked
// right but the PDF/PPTX carried one page, because the non-current pages were
// never in the DOM (or were detached, so html-to-image captured a blank box).
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Download, ChevronLeft, ChevronRight, FileText, Image, Presentation } from "lucide-react";
import { Blocks } from "./canvas-blocks";
import { CanvasStateProvider } from "./canvas-state";
import {
  toBlockRanges, groupLikeBlocks, pageWidth, PAD_X, PAD_Y, GAP,
  type PageMode, type BlockMeta,
} from "../../lib/canvas-pagination";
import type { CanvasSpec, CanvasBlock } from "../../lib/canvas-schema";
import { downloadCanvasFile } from "../../lib/canvas-download";
import { cn } from "../../lib/utils";

const A4 = { w: 794, h: 1123, label: "A4 portrait" };
const SLIDE = { w: 1280, h: 720, label: "16:9 landscape" };

/** Block heights read off the off-screen rig, in render order. */
/**
 * Measure off-screen in the SAME grouping the page renders, so every measured
 * entry corresponds to exactly one rendered element and its height is the real
 * rendered height. Section metadata comes from the first block of each group,
 * which is what decides whether the group opens a section.
 */
function useBlockMeta(
  blocks: CanvasBlock[],
  mode: PageMode,
): { meta: BlockMeta[]; setHost: (el: HTMLDivElement | null) => void } {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [meta, setMeta] = useState<BlockMeta[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!host) return;
    const groups = groupLikeBlocks(blocks);
    let raf2 = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const measure = () => {
      const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-cv-grp]"));
      if (nodes.length !== groups.length) {
        // The rig is still settling — a lazy chart chunk or a webfont can add
        // its DOM a frame or two later. Retrying a few times is what turns the
        // one-page fallback into real pagination; bailing on the first miss is
        // what produced "1 / 1" for a genuinely multi-page report.
        if (attempt < 12 && !cancelled) {
          retry = setTimeout(() => setAttempt((a) => a + 1), 80);
        }
        return;
      }
      setMeta(nodes.map((n, i) => {
        const first = groups[i]![0]!;
        return { h: n.offsetHeight, type: first.type, label: labelOf(first) };
      }));
    };

    // Two frames for layout to settle, then measure (possibly with retries).
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (retry) clearTimeout(retry);
    };
    // `attempt` is a deliberate re-run trigger for the retry loop above.
  }, [blocks, mode, attempt, host]);

  // Returned so the rig element can wire itself up. `useRef` alone was the
  // original bug: on the first commit `measureRef.current` is null, the effect
  // bailed on `if (!host) return`, and because refs do not trigger a render the
  // effect never re-ran — measurement never happened at all, so every report
  // took the one-page fallback.
  return { meta, setHost };
}

/** The label a block carries, used to detect a section opener. */
function labelOf(b: CanvasBlock | undefined): string | undefined {
  if (!b) return undefined;
  const l = (b as { label?: unknown }).label;
  if (typeof l === "string" && l.trim()) return l;
  return undefined;
}

export function CanvasExportView({
  spec,
  canvasId,
  initialMode = "a4",
}: {
  spec: CanvasSpec;
  canvasId: string;
  initialMode?: PageMode;
}) {
  const [mode, setMode] = useState<PageMode>(initialMode);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => spec.blocks.filter((b) => b.type !== "data"), [spec.blocks]);
  // Measure off-screen, then pack with the tested pure function — the packing
  // rules live in canvas-pagination.ts, pinned by canvas-pagination.check.ts.
  //
  // The `ready` gate that used to sit here was a deadlock: an effect set
  // `ready = false` on every render, the measuring effect depended on `ready`,
  // and the two reset each other in a loop. `meta` never settled to match
  // `blocks`, so the fallback (`[[0, blocks.length]]` — everything on one
  // page) won, which is exactly the "one endless page, no page 2" symptom.
  // Measuring on `[blocks, mode]` alone is stable: the effect runs once per
  // real change and its result stays put.
  const { meta, setHost } = useBlockMeta(blocks, mode);
  // `meta` is one entry per rendered GROUP; `blocks` is the flat block list.
  // They are different index spaces, so the guard must compare meta against the
  // group count — comparing to blocks.length let a mismatched rig through and
  // produced the single-page fallback.
  const groupCount = useMemo(() => groupLikeBlocks(blocks).length, [blocks]);
  const ranges = useMemo<[number, number][]>(
    () => (meta.length === groupCount && meta.length > 0
      ? toBlockRanges(meta, mode)
      : [[0, groupCount]]),
    [meta, groupCount, mode],
  );
  const count = ranges.length;
  const dims = mode === "a4" ? A4 : SLIDE;

  // Mode switch invalidates the page index (page 4 of an A4 run has no
  // equivalent on a 16:9 run) — clamp rather than reset so the user's place
  // survives when both layouts have the same count.
  useEffect(() => { setPage((p) => Math.min(p, Math.max(0, count - 1))); }, [count]);

  // Fit-to-width, and CENTRE the result.
  //
  // The bug this replaces: the stage was scaled with transform but kept its
  // unscaled 794px layout box, so `margin-inline:auto` had nothing to centre
  // inside and the page sat hard against the left edge with a gap on the
  // right. transform does not change layout size.
  //
  // So the sizing lives on an outer wrapper in REAL px (page × scale), and the
  // transform goes on an inner box. The wrapper is what centres; the inner box
  // is what shrinks. Capture resets the inner transform, so files stay
  // full-size and crisp regardless of the on-screen scale.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fit = () => {
      const avail = el.clientWidth;
      if (avail <= 0) return;
      setScale(Math.min(1, avail / pageWidth(mode)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const stem = useMemo(() => {
    const t = spec.title?.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return t || "canvas-export";
  }, [spec.title]);

  // Capture reads the UNSCALED page box: a transform on the page node would
  // rasterise the scaled (blurry) result. Reset the inner transform, shoot,
  // then restore it so the on-screen view snaps back to fitted.
  const shoot = useCallback(async (): Promise<string[]> => {
    const stage = stageRef.current;
    if (!stage) throw new Error("page stage not mounted");
    const pages = Array.from(stage.querySelectorAll<HTMLElement>("[data-cv-page]"));
    if (!pages.length) throw new Error("no pages to export");
    const { toPng } = await import("html-to-image");

    const prevTransform = stage.style.transform;
    stage.style.transform = "none";
    try {
      const out: string[] = [];
      for (const el of pages) {
        out.push(await toPng(el, {
          cacheBust: true,
          pixelRatio: 2,
          // The card paints its own colours; nothing here needs webfonts fetched.
          skipFonts: true,
          backgroundColor: getComputedStyle(el).backgroundColor || undefined,
        }));
      }
      return out;
    } finally {
      stage.style.transform = prevTransform;
    }
  }, []);

  const save = useCallback(async (bytes: Uint8Array, name: string, mime: string) => {
    const r = await downloadCanvasFile(() => bytes, name, mime);
    if (!r.ok) throw new Error(r.error || "save failed");
    return r;
  }, []);

  const run = useCallback(async (
    kind: "pdf" | "png" | "pptx",
  ) => {
    setBusy(kind);
    setMsg(null);
    try {
      const shots = await shoot();

      if (kind === "pdf") {
        const { jsPDF } = await import("jspdf");
        // A4 portrait is 210×297mm; a 16:9 page is 279.4×157.5mm.
        const landscape = mode === "slide";
        const pdf = new jsPDF({
          orientation: landscape ? "landscape" : "portrait",
          unit: "mm",
          format: landscape ? [279.4, 157.5] : "a4",
        });
        shots.forEach((src, i) => {
          if (i > 0) pdf.addPage(landscape ? [279.4, 157.5] : "a4", landscape ? "landscape" : "portrait");
          const pw = pdf.internal.pageSize.getWidth();
          const ph = pdf.internal.pageSize.getHeight();
          // fit inside the page, preserving the shot's aspect
          const ratio = Math.min(pw / dims.w, ph / dims.h);
          const w = dims.w * ratio;
          const h = dims.h * ratio;
          pdf.addImage(src, "PNG", (pw - w) / 2, (ph - h) / 2, w, h, undefined, "FAST");
        });
        await save(new Uint8Array(pdf.output("arraybuffer")), `${stem}.pdf`, "application/pdf");
        setMsg(`${count} page${count === 1 ? "" : "s"} · PDF`);
      }

      if (kind === "png") {
        // One file per page; downloads fire in sequence so the host is not
        // asked to store N copies of the same bytes at once.
        for (let i = 0; i < shots.length; i++) {
          const name = shots.length === 1 ? `${stem}.png` : `${stem}-p${i + 1}.png`;
          const bin = atob(shots[i].split(",")[1] ?? "");
          const bytes = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
          await save(bytes, name, "image/png");
        }
        setMsg(`${count} page${count === 1 ? "" : "s"} · PNG`);
      }

      if (kind === "pptx") {
        const PptxGenJS = (await import("pptxgenjs")).default;
        const p = new PptxGenJS();
        p.layout = "LAYOUT_16x9";
        for (const src of shots) {
          const s = p.addSlide();
          s.addImage({ data: src, x: 0, y: 0, w: "100%", h: "100%" });
        }
        const out = await p.write({ outputType: "uint8array" });
        await save(out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
          `${stem}.pptx`,
          "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        setMsg(`${count} slide${count === 1 ? "" : "s"} · PPTX`);
      }

      window.setTimeout(() => setMsg(null), 3200);
    } catch (e) {
      setMsg(`Export failed: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
    } finally {
      setBusy(null);
    }
  }, [shoot, save, mode, dims.w, dims.h, count, stem]);

  // Measured GROUPS → block indices. `ranges` is in group space (one entry per
  // rendered element); pages must slice BLOCKS, so map each group range back
  // through the same grouping the rig and the page both use.
  const groups = useMemo(() => groupLikeBlocks(blocks), [blocks]);
  const pages = useMemo<CanvasBlock[][]>(() => {
    const out: CanvasBlock[][] = [];
    for (const [gs, ge] of ranges) {
      const slice: CanvasBlock[] = [];
      for (let g = gs; g < ge; g++) {
        const grp = groups[g];
        if (grp) slice.push(...grp);
      }
      out.push(slice);
    }
    return out.length ? out : [blocks];
  }, [ranges, groups, blocks]);

  const dl = (kind: "pdf" | "png" | "pptx", label: string, Icon: typeof Download) => (
    <button
      type="button"
      className="ast-cv-dl-btn"
      disabled={busy !== null}
      onClick={() => run(kind)}
      aria-label={`Download ${label}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{busy === kind ? "Exporting…" : label}</span>
    </button>
  );

  return (
    <div className={cn("ast-cv-x", busy && "is-exporting")}>
      <div className="ast-cv-x-bar">
        <div className="ast-cv-x-modes" role="group" aria-label="Page format">
          <button
            type="button"
            className={cn("ast-cv-x-mode", mode === "a4" && "is-on")}
            aria-pressed={mode === "a4"}
            onClick={() => setMode("a4")}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>A4</span>
          </button>
          <button
            type="button"
            className={cn("ast-cv-x-mode", mode === "slide" && "is-on")}
            aria-pressed={mode === "slide"}
            onClick={() => setMode("slide")}
          >
            <Presentation className="h-3.5 w-3.5" aria-hidden="true" />
            <span>16:9</span>
          </button>
          <span className="ast-cv-x-dim" aria-hidden="true">{dims.label}</span>
        </div>
        <div className="ast-cv-x-acts">
          {mode === "a4"
            ? dl("pdf", "PDF", Download)
            : [dl("png", "Images", Image), dl("pptx", "PPTX", Presentation)]}
        </div>
      </div>

      <div className="ast-cv-x-scroll" ref={scrollRef}>
        {/* Outer box: REAL px (page × scale) — this is what centres, because a
            transform does not change layout size. Inner box: the transform. */}
        <div
          className="ast-cv-x-fit"
          style={{
            width: dims.w * scale,
            height: dims.h * scale,
          }}
        >
          <div
            ref={stageRef}
            className="ast-cv-x-stage"
            data-mode={mode}
            style={{
              // Padding constants come from canvas-pagination.ts so the painted
              // box and the measured height can never disagree.
              ["--pg-w" as string]: `${dims.w}px`,
              ["--pg-h" as string]: `${dims.h}px`,
              ["--pad-x" as string]: `${PAD_X}px`,
              ["--pad-y" as string]: `${PAD_Y}px`,
              // --x-gap is the CSS twin of GAP in canvas-pagination.ts. If the
              // two ever drift, every page mis-paginates silently.
              ["--x-gap" as string]: `${GAP}px`,
              transform: `scale(${scale})`,
            }}
          >
          {pages.map((pblocks, i) => (
            <div
              key={i}
              data-cv-page={i}
              className={cn("ast-cv-x-page", i !== page && "is-off")}
              aria-hidden={i !== page}
              aria-label={`${dims.label} page ${i + 1} of ${pages.length}`}
            >
              <div className="ast-cv-x-inner">
                <CanvasStateProvider
                  canvasId={`${canvasId}-pg${i}-${mode}`}
                  initial={spec.state ?? {}}
                >
                  <Blocks blocks={pblocks} canvasId={`${canvasId}-pg${i}-${mode}`} />
                </CanvasStateProvider>
              </div>
              <span className="ast-cv-x-folio" aria-hidden="true">{i + 1} / {pages.length}</span>
            </div>
          ))}
          </div>
        </div>
      </div>

      {pages.length > 1 && (
        <div className="ast-cv-x-nav">
          <button
            type="button"
            className="ast-cv-dl-btn"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Prev</span>
          </button>
          <span className="ast-cv-x-count">
            Page <b>{page + 1}</b> of <b>{pages.length}</b>
          </span>
          <button
            type="button"
            className="ast-cv-dl-btn"
            disabled={page >= pages.length - 1}
            onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
            aria-label="Next page"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {msg && <p className="ast-cv-x-msg" role="status">{msg}</p>}

      {/* Off-screen measuring rig. It renders the SAME groups the page renders
          (groupLikeBlocks), so one measured entry === one rendered element.
          visibility:hidden (not display:none) so offsetHeight is real; out of
          flow so it never scrolls the card. Width and padding match the real
          page exactly — measuring at a different width than the page paints is
          what silently mis-paginates a report. */}
      <div
        className="ast-cv-x-measure"
        ref={setHost}
        aria-hidden="true"
        style={{
          width: dims.w,
          padding: `${PAD_Y}px ${PAD_X}px`,
        }}
      >
        {groupLikeBlocks(blocks).map((g, i) => (
          <div key={i} data-cv-grp>
            <Blocks blocks={g} canvasId={`${canvasId}-m${i}`} />
          </div>
        ))}
      </div>
    </div>
  );
}