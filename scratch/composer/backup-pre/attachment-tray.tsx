// Composer attachment tray (R8a): 64px thumbnails with progress ring / retry
// / remove. Replaces the old text-only chips. Sits above the textarea.
import { useEffect, useState } from "react";
import { X, RotateCcw, Film } from "lucide-react";
import { downloadUrl } from "@/lib/media-paths";
import { mediaKind, badgeLabel } from "@/lib/media-kinds";
import type { Attachment } from "./composer-controls";

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Thumb({ att }: { att: Attachment }) {
  const k = mediaKind(att.name);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  useEffect(() => {
    if (k !== "image") return;
    if (att.file) {
      const u = URL.createObjectURL(att.file);
      setObjUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (att.serverPath) {
      setObjUrl(downloadUrl(att.serverPath));
    }
  }, [att.file, att.serverPath, k]);
  if (k === "image" && objUrl) return <img src={objUrl} alt="" loading="lazy" />;
  if (k === "video") return <Film className="h-6 w-6" style={{ color: "var(--color-muted)" }} />;
  return <span className="mg-badge" data-k={k} style={{ position: "static" }}>{badgeLabel(att.name)}</span>;
}

const RING_R = 14;
const RING_C = 2 * Math.PI * RING_R;

export function AttachmentTray({ items, onRemove, onRetry, countLabel }: {
  items: Attachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  countLabel?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="at-tray">
      {items.map((a) => (
        <div key={a.id} className="at-item" data-status={a.status} title={a.name}>
          <Thumb att={a} />
          {a.status === "uploading" && (
            <svg className="at-ring" width="32" height="32" viewBox="0 0 32 32" role="progressbar" aria-valuenow={a.progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${a.name}`}>
              <circle className="track" cx="16" cy="16" r={RING_R} fill="none" strokeWidth="2.5" strokeDasharray={RING_C} />
              <circle cx="16" cy="16" r={RING_R} fill="none" strokeWidth="2.5" strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - (a.progress ?? 0) / 100)}
                transform="rotate(-90 16 16)" strokeLinecap="round" />
            </svg>
          )}
          {a.status === "error" && (
            <div className="at-scrim">
              <button type="button" className="at-retry" aria-label={`Retry ${a.name}`} title="Retry"
                onClick={() => onRetry(a.id)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button type="button" className="at-x" aria-label={`Remove ${a.name}`} title="Remove"
            onClick={() => onRemove(a.id)}>
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {countLabel && <span className="at-count">{countLabel}</span>}
    </div>
  );
}
