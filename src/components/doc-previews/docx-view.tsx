// DOCX preview via docx-preview (Microsoft's Word-layout HTML renderer).
import { useEffect, useRef } from "react";
import { renderAsync } from "docx-preview";

interface Props {
  url: string;
  onLoad: () => Promise<ArrayBuffer>;
  onError: (message: string) => void;
}

export default function DocxView({ url, onLoad, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    (async () => {
      try {
        const data = await onLoad();
        if (!alive) return;
        await renderAsync(data, host, undefined, {
          className: "docx-render",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
        });
      } catch (e) {
        if (alive) onError(String((e as Error)?.message ?? e));
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div className="h-full w-full overflow-auto bg-slate-100 p-3">
      <div ref={hostRef} className="docx-host [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:flex [&_.docx-wrapper]:flex-col [&_.docx-wrapper]:items-center [&_.docx-wrapper]:gap-3 [&_.docx-wrapper]:p-3 [&_section.docx]:!shadow-md" />
    </div>
  );
}
