// CanvasView — the composed generative-UI surface rendered between prose.
// Lazy-loaded chunk: this module (and its recharts import) never enters the
// main bundle; only chats that actually contain a canvas pay for it.
import { useReducer } from "react";
import { Copy, Check } from "lucide-react";
import { canvasToMarkdown } from "../../lib/canvas-markdown";
import { copyText } from "../../lib/copy-text";
import { Blocks } from "./canvas-blocks";
import type { CanvasSpec } from "../../lib/canvas-schema";

export default function CanvasView({ spec }: { spec: CanvasSpec }) {
  const [copied, ping] = useReducer((x: number) => x + 1, 0);
  const done = copied > 0;

  const onCopy = async () => {
    const ok = await copyText(canvasToMarkdown(spec));
    if (ok) {
      ping();
      setTimeout(() => ping(), 1600);
    }
  };

  return (
    <section className="ast-canvas" aria-label={spec.title || "Data canvas"}>
      <header className="ast-canvas-head">
        <span className="ast-canvas-title">{spec.title || "Canvas"}</span>
        <button type="button" className="ast-canvas-copy" onClick={onCopy} aria-label="Copy canvas as markdown">
          {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{done ? "Copied" : "Copy"}</span>
        </button>
      </header>
      <div className="ast-canvas-body">
        <Blocks blocks={spec.blocks} />
      </div>
    </section>
  );
}
