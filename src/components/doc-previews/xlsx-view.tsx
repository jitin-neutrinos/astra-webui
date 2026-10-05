// XLSX/XLS/CSV preview via SheetJS — parse to sheet rows, render as tabs +
// virtualization-free HTML table (row cap keeps huge sheets usable).
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

interface Props {
  url: string;
  onLoad: () => Promise<ArrayBuffer>;
  onError: (message: string) => void;
}

const MAX_ROWS = 500;

export default function XlsxView({ url, onLoad, onError }: Props) {
  const [book, setBook] = useState<XLSX.WorkBook | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await onLoad();
        if (!alive) return;
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        if (!alive) return;
        setBook(wb);
      } catch (e) {
        if (alive) onError(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const rows = useMemo(() => {
    if (!book) return null;
    const name = book.SheetNames[sheetIdx];
    if (!name) return null;
    const sheet = book.Sheets[name];
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  }, [book, sheetIdx]);

  if (!book) return null;

  const shown = rows?.slice(0, MAX_ROWS) ?? [];
  return (
    <div className="flex h-full w-full flex-col bg-white">
      {book.SheetNames.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1">
          {book.SheetNames.map((n, i) => (
            <button
              key={n}
              type="button"
              onClick={() => setSheetIdx(i)}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition ${
                i === sheetIdx ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-200"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-auto border-collapse text-[11px]">
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className={r === 0 ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"}>
                {row.map((cell, c) => (
                  // no max-width: cells take the width the container gives them,
                  // so a wide sheet uses the full preview area instead of clipping
                  <td key={c} className="truncate border border-slate-200 px-2 py-1 align-top text-slate-700">
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(rows?.length ?? 0) > MAX_ROWS && (
          <div className="p-2 text-center text-[10px] text-slate-400">
            showing first {MAX_ROWS} of {rows!.length} rows
          </div>
        )}
      </div>
    </div>
  );
}
