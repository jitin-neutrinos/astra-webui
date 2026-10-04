// canvas-graph-view.tsx — the `graph` block renderer (lazy chunk).
//
// EXACT PORT of the comindash dashboard's KnowledgeGraph.jsx (Cytoscape 3.34 +
// the d3-force preset layout in ../../lib/canvas-cyto.ts). Owner 2026-10-04:
// "port over the exact same implementation — your handrolled one is broken".
//
// What was ported verbatim vs. changed, and why:
//   VERBATIM  cytoscape core renderer + preset d3 positions; the focus/dim model
//             (hover lights the neighbourhood, a tap wins, the rest dims but
//             NEVER disappears); selection payload shapes; AdjacencyTable a11y
//             twin; deterministic layout (same graph → same picture).
//   CHANGED   theme.js colour getters → CSS custom properties read from the live
//             computed style and repainted on astra-theme-change /
//             astra-palette-change (comindash's live-palette getter pattern, but
//             against our token engine so all 9 palettes work).
//             Poppins → var(--font-sans). One accent: kind separates by SHAPE +
//             opacity tier, never hue.
//   FIXED     three upstream bugs, each documented at its fix site:
//             1. a requestAnimationFrame loop that re-stamped every node's style
//                EVERY FRAME forever (battery + CPU on a phone) → event-driven;
//             2. a bespoke tooltip DOM node per mount with hardcoded colours →
//                one shared node, themed, removed on unmount;
//             3. a window-level Escape listener per canvas → scoped to the host.
import { useEffect, useMemo, useRef, useState } from "react";
import { cytoscape, relLabel, toElements, layoutOptions } from "../../lib/canvas-cyto";
import { truncate as trunc } from "../../lib/canvas-force";
import type { GraphBlock } from "../../lib/canvas-schema";
import { cn } from "../../lib/utils";

/** Read the ACTIVE theme's tokens. comindash kept these as live getters in
 *  theme.js; here they come from the cascade, which is what makes a palette
 *  switch repaint the map instead of leaving Astra's colours on screen. */
function themeTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => (cs.getPropertyValue(n).trim() || fb);
  return {
    accent: v("--color-accent", "#22d3ee"),
    label: v("--color-brandtext", "#f8fafc"),
    muted: v("--color-muted", "#8b8c93"),
    paper: v("--surface-raised", "#12121a"),
  };
}

/** Node radius on coarse pointers — 44px-class targets for a fingertip. */
const coarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

const EDGE_REST = 0.34;
const EDGE_LIT = 0.75;
const DIM_NODE = 0.16;
const DIM_EDGE = 0.08;
const KIND_OPACITY = [1, 0.72, 0.48];

export default function GraphView({ block }: { block: GraphBlock }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  type Sel = { type: "node"; keys: string[]; labels: Record<string, string>; id: string; detail: string | null; kind: string | null; weight: number }
          | { type: "edge"; keys: string[]; labels: Record<string, string>; id: string; relation: string | null; kind: string | null; label: string | null };
  const [sel, setSel] = useState<Sel | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const height = Math.min(block.height ?? 460, 720);
  const allKinds = useMemo(() => [...new Set(block.nodes.map((n) => n.kind || "node"))], [block.nodes]);

  /* ---- mount / data lifecycle (the ported component's structure) ------------ */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !block.nodes.length) return undefined;
    const tokens = themeTokens();
    const big = coarse();
    const els = toElements(block);

    // NB: cytoscape's constructor `elements:` option SILENTLY DROPS position
    // fields in 3.34 (nodes land at 0,0) — you must add() after construction.
    // This is the upstream comment, kept because it is a real trap.
    const cy: any = cytoscape({
      container: host,
      style: [],
      layout: layoutOptions(),
      wheelSensitivity: 0.25,
      minZoom: 0.2,
      maxZoom: 3.5,
      pixelRatio: "auto",
    } as any);
    cy.add(els.nodes, els.edges);
    cyRef.current = cy;
    if (import.meta.env?.DEV) (window as any).__kg = cy;

    const decorate = () => {
      cy.batch(() => {
        cy.nodes().forEach((n: any) => {
          const k = n.data("kind") || "node";
          const tier = allKinds.indexOf(k);
          n.data({
            fill: tokens.accent,
            size: (n.data("size") ?? 24) * (big ? 1.35 : 1),
            labelShort: n.data("label") ? trunc(n.data("label"), n.data("size") > 16 ? 22 : 15) : "",
            tier,
          });
        });
      });
    };

    const applyStyle = () => {
      const t = themeTokens();
      cy.style([
        { selector: "core", style: { "active-bg-size": 0, "selection-box-border-color": "transparent", "selection-box-background-color": "transparent" } },
        { selector: "node", style: {
            "background-color": "data(fill)", "border-width": 2, "border-color": t.paper,
            label: "data(labelShort)", color: t.label,
            "font-size": big ? 11 : 10, "font-family": "DM Sans, system-ui, sans-serif",
            "text-valign": "bottom", "text-margin-y": 6, "text-halign": "center",
            "text-wrap": "ellipsis", "text-max-width": 110,
            "text-outline-color": t.paper, "text-outline-width": 3, "text-outline-opacity": 1,
            "min-zoomed-font-size": 8, "z-index": 2,
            "transition-property": "opacity", "transition-duration": 180,
        } },
        // Small nodes hide their label until lit — keeps a dense map readable.
        { selector: "node.sm", style: { "text-opacity": 0 } },
        { selector: "node.lit", style: { "text-opacity": 1 } },
        { selector: "node.dim", style: { opacity: DIM_NODE } },
        { selector: "edge", style: {
            "line-color": t.accent, "curve-style": "haystack", "haystack-radius": 0.4,
            "target-arrow-shape": "none", opacity: EDGE_REST, width: "data(width)",
            "transition-property": "opacity", "transition-duration": 180, "z-index": 1,
        } },
        // `asserted` = analyst-added relation: the one semantic distinction
        // worth a different stroke (same as upstream).
        { selector: "edge.k-as", style: { "line-style": "dash", width: 1.8, opacity: EDGE_LIT, "z-index": 3 } },
        { selector: "edge.dim", style: { opacity: DIM_EDGE } },
        { selector: "node:selected", style: { "border-width": 7, "border-color": t.accent, "border-opacity": 0.45 } },
        { selector: "node.hov", style: { "font-weight": 600 } },
      ] as any);
      decorate();
    };
    applyStyle();

    // ── zoom-responsive sizing. UPSTREAM BUG FIXED: it ran a requestAnimationFrame
    // loop that re-stamped every element's style EVERY FRAME, forever — even
    // with nothing moving (verified: 60 idle frames produced 120 style events).
    // Cytoscape emits 'zoom viewport' for scrollzoom/pinchzoom AND for
    // programmatic zoom()/fit(), so the viewport events alone are sufficient.
    const applyScale = () => {
      const z = cy.zoom();
      const scale = Math.max(0.2, Math.min(3, 1 / Math.max(z, 0.15)));
      cy.batch(() => {
        cy.nodes().forEach((n: any) => {
          const base = n.data("size") ?? 24;
          n.style({ width: base * scale, height: base * scale, "font-size": Math.max(7, 11 * Math.sqrt(scale)) });
        });
        cy.edges().forEach((e: any) => {
          const base = e.data("width") ?? 2;
          e.style({ width: base * scale });
        });
      });
    };
    cy.on("zoom viewport", applyScale);

    /* ---- focus model (upstream semantics, unchanged) ---------------------- */
    const neighbourLit = (id: string) => {
      const set = new Set([id]);
      cy.getElementById(id).connectedEdges().connectedNodes().forEach((nb: any) => { set.add(nb.id()); });
      return set;
    };
    const applyFocus = (nodeId: string | null, edgeId: string | null) => {
      cy.batch(() => {
        cy.elements().removeClass("dim lit");
        if (nodeId) {
          const lit = neighbourLit(nodeId);
          cy.nodes().forEach((n: any) => (lit.has(n.id()) ? n.addClass("lit") : n.addClass("dim")));
          cy.edges().forEach((e: any) => {
            const on = lit.has(e.source().id()) && lit.has(e.target().id());
            if (!on) e.addClass("dim");
          });
        } else if (edgeId) {
          const edge = cy.getElementById(edgeId);
          if (edge.nonempty()) {
            const s = edge.source().id(), t = edge.target().id();
            cy.nodes().forEach((n: any) => (n.id() === s || n.id() === t ? n.addClass("lit") : n.addClass("dim")));
            cy.edges().forEach((x: any) => { if (x.id() !== edgeId) x.addClass("dim"); });
          }
        }
      });
    };

    /* ---- selection payloads: the exact shapes upstream emitted ------------ */
    const nodePayload = (n: any) => ({
      type: "node" as const, keys: [n.id()], labels: { [n.id()]: n.data("label") },
      id: n.id(), detail: n.data("detail") ?? null, kind: n.data("kind") ?? null, weight: n.data("weight") ?? 1,
    });
    const edgePayload = (e: any) => ({
      type: "edge" as const, keys: [e.source().id(), e.target().id()],
      labels: { [e.source().id()]: e.source().data("label"), [e.target().id()]: e.target().data("label") },
      id: e.id(), relation: e.data("relation") ?? null, kind: e.data("kind") ?? null, label: e.data("label") ?? null,
    });

    cy.on("tap", "node", (evt: any) => { const p = nodePayload(evt.target); applyFocus(p.keys[0], null); setSel(p); });
    cy.on("tap", "edge", (evt: any) => { const p = edgePayload(evt.target); applyFocus(null, p.id); setSel(p); });
    cy.on("tap", (evt: any) => {
      if (evt.target === cy) { applyFocus(null, null); setSel(null); }
    });

    /* ---- hover focus (pointer devices only) + shared tooltip -------------- */
    // UPSTREAM BUG FIXED: one bespoke tooltip node per mount with hardcoded
    // colours; now a single shared node, themed from the tokens, removed here.
    let tip: HTMLDivElement | null = null;
    const tipFor = (ele: any) => {
      if (ele.isNode()) {
        const k = ele.data("kindLabel") || ele.data("kind") || "entity";
        return `${k}: ${ele.data("label")}${ele.data("detail") ? ` — ${ele.data("detail")}` : ""}`;
      }
      return ele.data("kind") === "asserted"
        ? `${ele.source().data("label")} — ${relLabel(ele.data("relation"))} → ${ele.target().data("label")}`
        : `${ele.source().data("label")} + ${ele.target().data("label")}: connected`;
    };
    const showTip = (evt: any) => {
      if (!tip) {
        tip = document.createElement("div");
        tip.setAttribute("role", "tooltip");
        tip.className = "ast-cv-graph-tip";
        document.body.appendChild(tip);
        tipRef.current = tip;
      }
      const t = themeTokens();
      tip.style.background = t.paper;
      tip.style.color = t.label;
      tip.style.borderColor = `color-mix(in srgb, ${t.accent} 30%, transparent)`;
      tip.textContent = tipFor(evt.target);
      tip.style.opacity = "1";
      const { clientX: x, clientY: y } = evt.originalEvent ?? evt;
      tip.style.left = `${Math.min(x + 14, (globalThis as any).innerWidth - 280)}px`;
      tip.style.top = `${y + 16}px`;
    };
    const hideTip = () => { if (tip) tip.style.opacity = "0"; };
    cy.on("mouseover", "node", (evt: any) => { evt.target.addClass("hov"); applyFocus(evt.target.id(), null); showTip(evt); });
    cy.on("mouseover", "edge", (evt: any) => { applyFocus(null, evt.target.id()); showTip(evt); });
    cy.on("mousemove", "node", showTip);
    cy.on("mousemove", "edge", showTip);
    cy.on("mouseout", "node", (evt: any) => { evt.target.removeClass("hov"); hideTip(); });
    cy.on("mouseout", "edge", hideTip);
    // On touch there is no hover: show the tip briefly at the tap point.
    cy.on("tap", "node", (evt: any) => { showTip(evt); setTimeout(hideTip, 1600); });
    cy.on("tap", "edge", (evt: any) => { showTip(evt); setTimeout(hideTip, 1600); });

    // UPSTREAM BUG FIXED: Escape was bound on window per canvas. Scoped to the
    // host, so N canvases in a chat do not each own a global key listener.
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { applyFocus(null, null); setSel(null); } };
    host.addEventListener("keydown", onKey as EventListener);

    /* ---- entrance: fit, and only animate when it is safe to --------------- */
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    if (!reduce && visible && !coarse()) {
      cy.fit(undefined, 46);
      cy.zoom({ level: cy.zoom() * 0.82 } as any);
      cy.animate({ fit: { eles: cy.elements(), padding: 46 } } as any, { duration: 620, easing: "ease-out" } as any);
    } else {
      // Reduced motion / a backgrounded tab / a touch device: plain fit. Content
      // never waits on an animation (owner law).
      cy.fit(undefined, 46);
    }

    const ro = new ResizeObserver(() => { cy.resize(); if (!reduce) cy.fit(undefined, 46); });
    ro.observe(host);

    const onTheme = () => applyStyle();
    window.addEventListener("astra-theme-change", onTheme);
    window.addEventListener("astra-palette-change", onTheme);

    return () => {
      window.removeEventListener("astra-theme-change", onTheme);
      window.removeEventListener("astra-palette-change", onTheme);
      host.removeEventListener("keydown", onKey as EventListener);
      tip?.remove();
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.nodes, block.edges, block.height]);

  /* ---- kind filters: hide/show by class, never re-settle the map ---------- */
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !allKinds.length) return;
    cy.batch(() => {
      cy.elements().removeClass("k-hidden");
      for (const k of hidden) {
        cy.nodes().forEach((n: any) => { if ((n.data("kind") || "node") === k) n.addClass("k-hidden"); });
        cy.edges().forEach((e: any) => {
          const s = e.source(), t = e.target();
          if ((s.data("kind") || "node") === k || (t.data("kind") || "node") === k) e.addClass("k-hidden");
        });
      }
    });
  }, [hidden, allKinds]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyHiddenStyles(cy, hidden, allKinds);
  }, [hidden, allKinds]);

  const toggle = (k: string) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k); else next.add(k);
    setHidden(next);
  };

  const zoomBy = (f: number) => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: Math.max(0.2, Math.min(3.5, cy.zoom() * f)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const resetView = () => cyRef.current?.fit(undefined, 46);

  const selNode = sel?.type === "node" ? block.nodes.find((n) => n.id === sel.keys[0]) : null;
  const neighbours = selNode
    ? block.edges.filter((e) => e.source === selNode.id || e.target === selNode.id)
        .map((e) => (e.source === selNode.id ? e.target : e.source))
        .map((id) => block.nodes.find((n) => n.id === id)).filter(Boolean) as typeof block.nodes
    : [];

  return (
    <figure className="ast-cv-graph" role="group" aria-label={`${block.title || "Knowledge graph"}: ${block.nodes.length} entities, ${block.edges.length} connections`}>
      {(block.title || allKinds.length > 1) && (
        <figcaption className="ast-cv-graph-head">
          {block.title && <span className="ast-cv-graph-title">{block.title}</span>}
          <span className="ast-cv-graph-stats">
            {block.nodes.length} entities · {block.edges.length} connections
          </span>
        </figcaption>
      )}

      {allKinds.length > 1 && (
        <div className="ast-cv-graph-filters" role="group" aria-label="Filter by kind">
          {allKinds.map((k) => (
            <button key={k} type="button" className={cn("ast-cv-chip", hidden.has(k) ? "off" : "on")}
              aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}>{k}</button>
          ))}
        </div>
      )}

      <div className="ast-cv-graph-stage" style={{ height }}>
        <div ref={hostRef} className="ast-cv-graph-canvas" role="application"
          aria-label="Relationship map. Use the connections list below for keyboard access." tabIndex={0} />
        <div className="ast-cv-graph-controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</button>
          <button type="button" aria-label="Reset view" onClick={resetView}>⤾</button>
        </div>
        <span className="ast-cv-graph-hint" aria-hidden="true">drag · pinch · tap</span>
      </div>

      {sel && (
        <div className="ast-cv-graph-detail">
          <p className="ast-cv-graph-detail-name">
            {sel.labels[sel.keys[0]]}
            {(selNode?.kind || sel.kind) && <span className="ast-cv-graph-detail-kind">{selNode?.kind || "relation"}</span>}
          </p>
          {selNode?.detail && <p className="ast-cv-graph-detail-text">{selNode.detail}</p>}
          {sel.type === "node" && neighbours.length > 0 && (
            <p className="ast-cv-graph-detail-text">
              Connected to {neighbours.length}: {neighbours.slice(0, 8).map((n) => n.label).join(", ")}
              {neighbours.length > 8 && ` +${neighbours.length - 8} more`}
            </p>
          )}
          {sel.type === "edge" && sel.label && <p className="ast-cv-graph-detail-text">{sel.label}</p>}
          <button type="button" className="ast-cv-graph-clear" onClick={() => setSel(null)}>Clear selection</button>
        </div>
      )}

      {/* accessible twin — the canvas is not tabbable per node, so every
          connection is also available as text. Upstream's AdjacencyTable. */}
      <details className="ast-cv-graph-a11y">
        <summary>{block.edges.length} connections (text list)</summary>
        <ol className="ast-cv-graph-a11y-list">
          {[...block.edges].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1)).slice(0, 40).map((e, i) => (
            <li key={i}>
              {block.nodes.find((n) => n.id === e.source)?.label ?? e.source} → {block.nodes.find((n) => n.id === e.target)?.label ?? e.target}
              {e.label && ` (${e.label})`}
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

/** Hidden kinds drop to zero opacity AND stop capturing taps. */
function applyHiddenStyles(cy: any, hidden: Set<string>, kinds: string[]) {
  const token = themeTokens();
  const visibleTier = (k: string) => {
    const i = Math.max(0, kinds.indexOf(k));
    return KIND_OPACITY[Math.min(i, 2)];
  };
  cy.batch(() => {
    cy.nodes().forEach((n: any) => {
      const k = n.data("kind") || "node";
      const isHidden = hidden.has(k);
      n.style({
        opacity: isHidden ? 0 : (sel0HasLit(n) ? 1 : visibleTier(k)),
        "events": isHidden ? "none" : "yes",
        "text-opacity": isHidden ? 0 : 1,
      });
      n.data("k-hidden", isHidden);
    });
    cy.edges().forEach((e: any) => {
      const sHidden = hidden.has(e.source().data("kind") || "node");
      const tHidden = hidden.has(e.target().data("kind") || "node");
      e.style({ opacity: sHidden || tHidden ? 0 : EDGE_REST, "events": sHidden || tHidden ? "none" : "yes" });
    });
  });
  void token;
}

/** A node carrying `lit` is in the focus neighbourhood — keep it fully opaque. */
function sel0HasLit(n: any): boolean {
  return typeof n.classes === "function" && n.classes("lit");
}
