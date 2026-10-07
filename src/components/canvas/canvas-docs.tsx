// Editable canvas surfaces — spreadsheet, slides, document, text.
//
// One shared contract for all four:
//   - basic editing only (a cell/field/line you can type into), nothing more
//   - expandable to fullscreen via Expandable (same live node, moved by portal)
//   - a Download button that writes server-side FIRST (see lib/canvas-download.ts)
//     because the Android WebView refuses blob: URLs outright
//
// Engines are lazy so an ordinary chat never pays for them. xlsx is already a
// dependency; docx and pptxgenjs are the only additions and only load when one of
// those cards actually renders.
import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Expandable } from "./canvas-fullscreen";
import { downloadCanvasFile } from "../../lib/canvas-download";
import { AnimatedCopyButton } from "../../lib/animated-copy";
import type {
  SpreadsheetBlock, SlidesBlock, DocumentBlock, TextBlock,
} from "../../lib/canvas-schema";

const MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  md: "text/markdown",
  txt: "text/plain",
} as const;

function extOf(name: string, fallback: string): string {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1] : fallback;
}
function stemOf(name: string, fallback: string): string {
  return name.replace(/\.[^.]*$/, "") || fallback;
}

/** Shared Download button: owns the busy state and the error path. */
function DownloadBtn({ produce, filename, mime }: {
  produce: () => Promise<Uint8Array> | Uint8Array;
  filename: string;
  mime: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="ast-cv-dl">
      <button
        type="button"
        className="ast-cv-dl-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const r = await downloadCanvasFile(produce, filename, mime);
          setBusy(false);
          if (!r.ok) setMsg(r.error || "export failed");
          else setTimeout(() => setMsg(null), 2000);
        }}
        aria-label={`Download ${filename}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 ast-canvas-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
        <span>{busy ? "Saving…" : "Download"}</span>
      </button>
      {msg && <span className="ast-cv-dl-err" role="alert">{msg}</span>}
    </span>
  );
}

// ── Spreadsheet ───────────────────────────────────────────────────────────────

const MAX_ROWS = 500; // matches doc-previews/xlsx-view; keeps the WebView fast

export function SpreadsheetView({ block, id }: { block: SpreadsheetBlock; id: string }) {
  const [grid, setGrid] = useState<(string | number)[][]>(block.rows);
  const full = block.sheets?.[0] ?? "Sheet1";
  const file = block.filename ?? `${stemOf(block.title ?? "sheet", "sheet")}.xlsx`;

  const cols = useMemo(() => {
    const explicit = block.columns;
    const width = Math.max(
      block.rows.length > 0 ? block.rows[0].length : 0,
      ...block.rows.map((r) => r.length),
      explicit?.length ?? 0,
    );
    const labels = explicit ?? (block.header !== false && block.rows[0] ? block.rows[0].map((c) => String(c)) : []);
    return { width, labels };
  }, [block.rows, block.columns, block.header]);

  const shown = grid.slice(0, MAX_ROWS);

  const setCell = (r: number, c: number, v: string) => {
    setGrid((g) => {
      const next = g.map((row) => row.slice());
      while (next[r].length <= c) next[r].push("");
      next[r][c] = v;
      return next;
    });
  };

  const produce = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid as unknown[][]), full);
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return new Uint8Array(out);
  };

  const body = (
    <figure className="ast-cv-sheet">
      <figcaption className="ast-cv-sheet-bar">
        <span className="ast-cv-sheet-tab">{full}</span>
        <span className="ast-cv-sheet-meta">{grid.length} row{grid.length === 1 ? "" : "s"} × {cols.width}</span>
        <DownloadBtn produce={produce} filename={file} mime={MIME.xlsx} />
      </figcaption>
      <div className="ast-cv-sheet-wrap">
        <table className="ast-cv-sheet-table">
          <tbody>
            {shown.map((row, r) => {
              const isHead = block.header !== false && r === 0;
              if (isHead) {
                return (
                  <tr key={`h${r}`} className="ast-cv-sheet-head-row">
                    {Array.from({ length: cols.width }, (_, c) => (
                      <th key={c} scope="col">{cols.labels[c] ?? ""}</th>
                    ))}
                  </tr>
                );
              }
              return (
                <tr key={r}>
                  {Array.from({ length: cols.width }, (_, c) => (
                    <td key={c}>
                      <input
                        className="ast-cv-cell"
                        value={String(row[c] ?? "")}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        aria-label={`Row ${r} column ${c + 1}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {grid.length > MAX_ROWS && (
        <p className="ast-cv-sheet-foot">showing first {MAX_ROWS} of {grid.length} rows</p>
      )}
    </figure>
  );

  return <Expandable id={id} title={block.title ?? "Spreadsheet"}>{body}</Expandable>;
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function TextView({ block, id }: { block: TextBlock; id: string }) {
  const [val, setVal] = useState(block.content);
  const lang = extOf(block.filename ?? "", block.language === "markdown" ? "md" : "txt");
  const file = block.filename ?? `${stemOf(block.title ?? "notes", "notes")}.${lang}`;
  const produce = () => new TextEncoder().encode(val);

  const body = (
    <figure className="ast-cv-textdoc">
      <figcaption className="ast-cv-sheet-bar">
        <span className="ast-cv-sheet-tab">{block.title ?? file}</span>
        <span className="ast-cv-sheet-meta">{val.length} chars</span>
        {/* copy follows the LIVE textarea value; the shared copy system, not a second state machine */}
        <AnimatedCopyButton variant="chip" label="Copy" title="Copy text" text={val} />
        <DownloadBtn produce={produce} filename={file} mime={MIME[lang as keyof typeof MIME] ?? MIME.txt} />
      </figcaption>
      <textarea
        className="ast-cv-textarea"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        spellCheck={false}
        aria-label={block.title ?? "Text content"}
      />
    </figure>
  );
  return <Expandable id={id} title={block.title ?? "Text"}>{body}</Expandable>;
}

// ── Document (docx) ──────────────────────────────────────────────────────────

export function DocumentBlockView({ block, id }: { block: DocumentBlock; id: string }) {
  const [content, setContent] = useState(block.content);
  const file = block.filename ?? `${stemOf(block.title ?? "document", "document")}.docx`;

  const produce = async () => {
    const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
    const paras = content.map((c) => {
      const kind = c.kind;
      if (kind === "h2") return new Paragraph({ text: c.text, heading: HeadingLevel.HEADING_2 });
      if (kind === "h3") return new Paragraph({ text: c.text, heading: HeadingLevel.HEADING_3 });
      if (kind === "quote") return new Paragraph({ text: c.text, style: "IntenseQuote" } as never);
      if (kind === "li") return new Paragraph({ text: c.text, bullet: { level: 0 } });
      return new Paragraph({ children: [new TextRun(c.text)] });
    });
    const doc = new Document({ sections: [{ children: paras.length ? paras : [new Paragraph("")] }] });
    const blob = await Packer.toBlob(doc);
    return new Uint8Array(await blob.arrayBuffer());
  };

  const setText = (i: number, v: string) =>
    setContent((cs) => cs.map((c, j) => (j === i ? { ...c, text: v } : c)));

  const body = (
    <figure className="ast-cv-doc">
      <figcaption className="ast-cv-sheet-bar">
        <span className="ast-cv-sheet-tab">{block.title ?? "Document"}</span>
        <span className="ast-cv-sheet-meta">{content.length} block{content.length === 1 ? "" : "s"}</span>
        <DownloadBtn produce={produce} filename={file} mime={MIME.docx} />
      </figcaption>
      <div className="ast-cv-doc-page">
        {content.map((c, i) => {
          const common = { key: i, className: "ast-cv-doc-input" };
          if (c.kind === "h2") return <input {...common} value={c.text} onChange={(e) => setText(i, e.target.value)} aria-label="Heading" />;
          if (c.kind === "h3") return <input {...common} value={c.text} onChange={(e) => setText(i, e.target.value)} aria-label="Subheading" />;
          if (c.kind === "li") {
            return (
              <div key={i} className="ast-cv-doc-li">
                <span aria-hidden="true">•</span>
                <input {...common} value={c.text} onChange={(e) => setText(i, e.target.value)} aria-label="Bullet" />
              </div>
            );
          }
          return <textarea {...common} value={c.text} rows={Math.min(8, Math.max(2, Math.ceil(c.text.length / 68)))} onChange={(e) => setText(i, e.target.value)} aria-label="Paragraph" />;
        })}
      </div>
    </figure>
  );
  return <Expandable id={id} title={block.title ?? "Document"}>{body}</Expandable>;
}

// ── Slides (pptx) ────────────────────────────────────────────────────────────

export function SlidesBlockView({ block, id }: { block: SlidesBlock; id: string }) {
  const [deck, setDeck] = useState(block.slides);
  const [cur, setCur] = useState(0);
  const file = block.filename ?? `${stemOf(block.title ?? "deck", "deck")}.pptx`;
  const slide = deck[cur];

  const setHeading = (v: string) =>
    setDeck((d) => d.map((s, i) => (i === cur ? { ...s, heading: v } : s)));
  const setBullet = (bi: number, v: string) =>
    setDeck((d) =>
      d.map((s, i) =>
        i === cur ? { ...s, bullets: (s.bullets ?? []).map((b, j) => (j === bi ? v : b)) } : s,
      ),
    );

  const produce = async () => {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const p = new PptxGenJS();
    p.layout = "LAYOUT_16x9";
    for (const s of deck) {
      const sl = p.addSlide();
      sl.addText(s.heading || " ", { x: 0.5, y: 0.6, w: 9, h: 1.1, fontSize: 30, bold: true });
      if (s.bullets?.length) {
        sl.addText(
          s.bullets.map((b) => ({ text: b, options: { bullet: true } })),
          { x: 0.7, y: 2, w: 8.6, h: 3.4, fontSize: 18 },
        );
      }
      if (s.note) sl.addNotes(s.note);
    }
    // pptxgenjs 4.x takes a JSZip output type, not "array". "uint8array" hands
    // back exactly what downloadCanvasFile wants — no ArrayBuffer normalisation.
    const out = await p.write({ outputType: "uint8array" });
    return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  };

  const body = (
    <figure className="ast-cv-deck">
      <figcaption className="ast-cv-sheet-bar">
        <span className="ast-cv-sheet-tab">{block.title ?? "Deck"}</span>
        <span className="ast-cv-sheet-meta">{deck.length} slide{deck.length === 1 ? "" : "s"}</span>
        <DownloadBtn produce={produce} filename={file} mime={MIME.pptx} />
      </figcaption>
      <div className="ast-cv-slide" data-layout={slide?.layout ?? "bullets"}>
        <input
          className="ast-cv-slide-heading"
          value={slide?.heading ?? ""}
          onChange={(e) => setHeading(e.target.value)}
          aria-label="Slide heading"
        />
        <ul className="ast-cv-slide-bullets">
          {(slide?.bullets ?? []).map((b, bi) => (
            <li key={bi}>
              <input
                className="ast-cv-slide-bullet"
                value={b}
                onChange={(e) => setBullet(bi, e.target.value)}
                aria-label={`Bullet ${bi + 1}`}
              />
            </li>
          ))}
        </ul>
        {slide?.note && <p className="ast-cv-slide-note">{slide.note}</p>}
      </div>
      <nav className="ast-cv-deck-nav">
        <button type="button" className="ast-cv-dl-btn" disabled={cur === 0} onClick={() => setCur((c) => Math.max(0, c - 1))} aria-label="Previous slide">
          ‹ Prev
        </button>
        <span className="ast-cv-sheet-meta">{cur + 1} / {deck.length}</span>
        <button type="button" className="ast-cv-dl-btn" disabled={cur >= deck.length - 1} onClick={() => setCur((c) => Math.min(deck.length - 1, c + 1))} aria-label="Next slide">
          Next ›
        </button>
      </nav>
    </figure>
  );
  return <Expandable id={id} title={block.title ?? "Slides"}>{body}</Expandable>;
}