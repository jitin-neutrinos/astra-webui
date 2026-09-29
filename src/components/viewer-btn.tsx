// yarl requires typed `label` (Label = keyof Labels) and `icon` (ElementType) props —
// a thin wrapper keeps call sites readable.
import type React from "react";
import { IconButton as YarlIconButton } from "yet-another-react-lightbox";

export function VBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <YarlIconButton
      label={label as never}
      icon={() => <>{children}</>}
      onClick={onClick}
    />
  );
}
