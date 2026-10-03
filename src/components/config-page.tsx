import { useEffect, useState, useMemo, useRef } from "react";
import { ArrowLeft, Check, Loader2, Undo, Download, Upload, AlertTriangle, Search, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type SchemaField = {
  type: string;
  description: string;
  category: string;
  options?: string[];
};

type Schema = {
  fields: Record<string, SchemaField>;
};

import { ThemePanel } from "./theme-panel";
import "./theme-panel.css";

export function ConfigPage({ onBack }: { onBack: () => void }) {
  const [config, setConfig] = useState<any>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [search, setSearch] = useState("");
  
  // Pending saves map: dotpath -> status ("saving" | "saved" | "error")
  const [saves, setSaves] = useState<Record<string, string>>({});
  
  // Undo state
  const [undoState, setUndoState] = useState<{ path: string; oldVal: any; newVal: any; timer?: number } | null>(null);

  // Text-field drafts: keystrokes stage locally, one PUT fires after 600ms idle
  // (ponytail ceiling: an unmount mid-draft drops the last <600ms of typing).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftTimers = useRef<Record<string, number>>({});
  useEffect(() => () => { Object.values(draftTimers.current).forEach(clearTimeout); }, []);

  const editTextInput = (path: string, value: string, commit?: (v: string) => any) => {
    setDrafts(d => ({ ...d, [path]: value }));
    if (draftTimers.current[path]) clearTimeout(draftTimers.current[path]);
    draftTimers.current[path] = window.setTimeout(() => {
      delete draftTimers.current[path];
      const v = commit ? commit(value) : value;
      if (v === undefined) return;
      updateVal(path, v);
      setDrafts(d => { const n = { ...d }; delete n[path]; return n; });
    }, 600);
  };

  // Hooks invariant: EVERY hook runs before the loading early-return below.
  // Group schema fields for the advanced view.
  const categories = useMemo(() => {
    const cats: Record<string, string[]> = {};
    if (!schema?.fields) return cats;
    for (const [path, f] of Object.entries(schema.fields)) {
      if (search && !path.toLowerCase().includes(search.toLowerCase()) && !f.description?.toLowerCase().includes(search.toLowerCase())) {
        continue;
      }
      const c = f.category || "uncategorized";
      if (!cats[c]) cats[c] = [];
      cats[c].push(path);
    }
    return cats;
  }, [schema, search]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cfgRes, schRes, optRes] = await Promise.all([
        fetch("/api/hx/config"),
        fetch("/api/hx/config/schema"),
        fetch("/api/hx/model/options").catch(() => ({ json: () => ({ models: [] }) } as any))
      ]);
      
      if (!cfgRes.ok) throw new Error("Failed to load config");
      
      const cfg = await cfgRes.json();
      const sch = await schRes.json();
      const opt = await optRes.json();
      
      setConfig(cfg);
      setSchema(sch);
      
      if (opt.providers && Array.isArray(opt.providers)) {
        // Catalog shape: {providers: [{slug, models: [...]}]} — flatten model ids/names.
        const mods = opt.providers.flatMap((p: any) =>
          (Array.isArray(p.models) ? p.models : []).map((m: any) => typeof m === "string" ? m : m.id || m.name)
        ).filter(Boolean);
        setModelOptions([...new Set<string>(mods)]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getVal = (path: string) => {
    if (!config) return undefined;
    const parts = path.split('.');
    let curr = config;
    for (const p of parts) {
      if (curr === undefined || curr === null) return undefined;
      curr = curr[p];
    }
    return curr;
  };

  const updateVal = async (path: string, val: any) => {
    if (!config) return;
    const oldVal = getVal(path);
    if (oldVal === val) return;

    // Optimistic UI update
    setConfig((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let curr = next;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!curr[parts[i]]) curr[parts[i]] = {};
        curr = curr[parts[i]];
      }
      curr[parts[parts.length - 1]] = val;
      return next;
    });

    setSaves(s => ({ ...s, [path]: "saving" }));

    // Construct deep update payload (single dotpath change per PUT)
    const payloadConfig: any = {};
    const parts = path.split('.');
    let curr = payloadConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = val;

    try {
      const res = await fetch("/api/hx/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: payloadConfig })
      });

      if (!res.ok) throw new Error("Save failed");

      setSaves(s => ({ ...s, [path]: "saved" }));
      setTimeout(() => {
        setSaves(s => {
          const next = { ...s };
          delete next[path];
          return next;
        });
      }, 2000);

      // Handle Undo
      if (undoState?.timer) clearTimeout(undoState.timer);
      const timer = window.setTimeout(() => setUndoState(null), 5000);
      setUndoState({ path, oldVal, newVal: val, timer });

    } catch (e) {
      console.error(e);
      setSaves(s => ({ ...s, [path]: "error" }));
      // Rollback
      setConfig((prev: any) => {
        const next = JSON.parse(JSON.stringify(prev));
        let c = next;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!c[parts[i]]) return next;
          c = c[parts[i]];
        }
        c[parts[parts.length - 1]] = oldVal;
        return next;
      });
    }
  };

  const handleUndo = () => {
    if (!undoState) return;
    const currentVal = getVal(undoState.path);
    // Race guard: only undo if value is still what we changed it to
    if (currentVal === undoState.newVal) {
      updateVal(undoState.path, undoState.oldVal);
    }
    if (undoState.timer) clearTimeout(undoState.timer);
    setUndoState(null);
  };

  const exportConfig = () => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `astra-config-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const json = JSON.parse(text);
        if (!window.confirm("Import this config? It will overwrite current settings.")) return;
        const res = await fetch("/api/hx/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: json })
        });
        if (res.ok) {
          fetchData(); // Reload all
        } else {
          alert("Import failed");
        }
      } catch {
        alert("Invalid JSON file");
      }
    };
    input.click();
  };

  if (loading || !config || !schema) {
    return (
      <div className="flex-1 overflow-auto bg-void text-brandtext p-6 lg:p-10 font-sans">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="h-8 ast-sk rounded w-48 mb-8" />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 ast-sk rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const renderField = (path: string, label?: string, typeOverride?: string, optionsOverride?: string[]) => {
    const fieldSchema = schema?.fields?.[path];
    if (!fieldSchema && !label) return null; // Wait, some curated fields might not be in schema, like agent.reasoning_effort. R2 says to render it anyway.
    
    const type = typeOverride || fieldSchema?.type || "string";
    const options = optionsOverride || fieldSchema?.options || [];
    const val = getVal(path);
    const saveStatus = saves[path];
    const displayLabel = label || path;

    const renderSaveState = () => {
      if (saveStatus === "saving") return <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />;
      if (saveStatus === "saved") return <Check className="w-3.5 h-3.5 text-green-400" />;
      if (saveStatus === "error") return <span className="text-[10px] text-redx font-mono flex items-center gap-1 cursor-pointer" onClick={() => updateVal(path, val)} title="Retry"><AlertTriangle className="w-3 h-3" /> Retry</span>;
      return null;
    };

    return (
      <div key={path} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-white/[0.04] last:border-0">
        <div className="flex-1 min-w-0">
          <label className="text-sm text-slate-200 font-medium font-mono">{displayLabel}</label>
          {fieldSchema?.description && (
            <p className="text-xs text-slate-500 mt-0.5 pr-4 truncate" title={fieldSchema.description}>{fieldSchema.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {renderSaveState()}
          {type === "boolean" ? (
            <button
              onClick={() => updateVal(path, !val)}
              className={cn("w-10 h-5 rounded-[5px] transition-colors relative", val ? "bg-accent" : "bg-white/10")}
            >
              <span className={cn("absolute top-0.5 left-0.5 bg-void w-4 h-4 rounded-[3px] transition-transform", val && "translate-x-5")} />
            </button>
          ) : type === "select" || (options && options.length > 0) ? (
            options.length > 0 ? (
              <select
                value={val ?? ""}
                onChange={(e) => updateVal(path, e.target.value)}
                className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50 min-w-[140px] appearance-none cursor-pointer"
              >
                {options.map((opt: string) => <option key={opt} value={opt}>{opt || "off"}</option>)}
              </select>
            ) : (
              // Fallback to text input if select has no options in schema
              <input
                type="text"
                value={drafts[path] ?? val ?? ""}
                onChange={(e) => editTextInput(path, e.target.value)}
                className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50 w-full sm:w-48"
              />
            )
          ) : type === "number" ? (
            <input
              type="number"
              value={drafts[path] ?? val ?? ""}
              onChange={(e) => editTextInput(path, e.target.value, (v) => { const n = parseFloat(v); return Number.isNaN(n) ? undefined : n; })}
              className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50 w-24 text-right"
            />
          ) : type === "list" ? (
            <textarea
              value={drafts[path] ?? (Array.isArray(val) ? val.join('\n') : "")}
              onChange={(e) => editTextInput(path, e.target.value, (v) => v.split('\n').filter(x => x))}
              className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50 w-full sm:w-64 min-h-[60px]"
              placeholder="One item per line"
            />
          ) : (
            <input
              type="text"
              value={drafts[path] ?? val ?? ""}
              onChange={(e) => editTextInput(path, e.target.value)}
              className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50 w-full sm:w-64"
            />
          )}
        </div>
      </div>
    );
  };

  const ttsProvider = getVal("tts.provider") || "openai";
  // Ponytail: keep only real voice keys — piper has voice but no speed; guard by schema presence.
  const ttsVoiceKey = schema?.fields?.[`tts.${ttsProvider}.voice`] ? `tts.${ttsProvider}.voice`
    : schema?.fields?.[`tts.${ttsProvider}.voice_id`] ? `tts.${ttsProvider}.voice_id` : null;
  const ttsSpeedKey = schema?.fields?.[`tts.${ttsProvider}.speed`] ? `tts.${ttsProvider}.speed` : null;

  return (
    <div className="flex-1 overflow-auto bg-void text-brandtext font-sans p-4 lg:p-10 relative">
      <div className="max-w-4xl mx-auto mb-8 flex items-center gap-4">
        <button type="button" onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 transition lg:hidden" aria-label="Back to chat">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="font-display text-2xl lg:text-3xl tracking-tight text-brandtext">System Configuration</h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent/70 mt-1">Live core parameters</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Curated Sections */}
        
        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
          <h3 className="font-display text-lg text-brandtext mb-4 border-b border-white/[0.04] pb-2">Brain</h3>
          <div className="space-y-1">
            {renderField("model", "Default Model", "select", modelOptions)}
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-white/[0.04]">
              <div className="flex-1 min-w-0">
                <label className="text-sm text-slate-200 font-medium font-mono">Fallback Chain</label>
                <p className="text-xs text-slate-500 mt-0.5">Read-only view of fallback_providers</p>
              </div>
              <div className="text-xs font-mono text-slate-400 max-w-[50%] text-right truncate">
                {(getVal("fallback_providers") || []).join(" → ") || "None"}
              </div>
            </div>

            {renderField("agent.reasoning_effort", "Reasoning Effort", "select", ["off", "low", "medium", "high", "ultra"])}
          </div>
        </section>

        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
          <h3 className="font-display text-lg text-brandtext mb-4 border-b border-white/[0.04] pb-2">Behavior</h3>
          <div className="space-y-1">
            {renderField("approvals.mode", "Approval Mode", "select", ["manual", "smart", "off"])}
            {renderField("memory.memory_enabled", "Memory System", "boolean")}
          </div>
        </section>

        {(ttsVoiceKey || ttsSpeedKey) && (
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
            <h3 className="font-display text-lg text-brandtext mb-4 border-b border-white/[0.04] pb-2">Voice</h3>
            <div className="space-y-1">
              {ttsVoiceKey && renderField(ttsVoiceKey, `${ttsProvider} Voice`)}
              {ttsSpeedKey && renderField(ttsSpeedKey, `${ttsProvider} Speed`, "number")}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
          <h3 className="font-display text-lg text-brandtext mb-4 border-b border-white/[0.04] pb-2">Appearance</h3>
          <div className="space-y-1">
            {renderField("display.skin", "Theme Skin")}
            {renderField("streaming.enabled", "Stream Responses", "boolean")}
          </div>
          <ThemePanel />
        </section>

        <section className="rounded-2xl border border-redx/20 bg-redx/5 p-6 backdrop-blur-md">
          <h3 className="font-display text-lg text-redx mb-4 border-b border-redx/10 pb-2">Danger Zone</h3>
          <div className="flex flex-wrap gap-3">
            <button onClick={exportConfig} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-void border border-white/10 hover:border-accent/50 transition-colors text-sm font-mono text-slate-300">
              <Download className="w-4 h-4" /> Export Config
            </button>
            <button onClick={importConfig} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-void border border-white/10 hover:border-fuchsia-500/50 transition-colors text-sm font-mono text-slate-300">
              <Upload className="w-4 h-4" /> Import Config
            </button>
            <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-void border border-white/10 hover:border-redx/50 transition-colors text-sm font-mono text-redx ml-auto">
              <RefreshCw className="w-4 h-4" /> Reset to Saved
            </button>
          </div>
        </section>

        {/* Advanced Toggle */}
        <div className="pt-4 pb-12">
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-center w-full gap-2 py-3 rounded-xl border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] transition-colors text-sm font-mono text-slate-400"
          >
            {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {showAdvanced ? "Hide advanced settings" : "Show all advanced settings"}
          </button>

          {showAdvanced && (
            <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Search settings..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-midnight/50 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-accent/50 font-mono"
                />
              </div>

              {Object.keys(categories).sort().map(cat => {
                if (categories[cat].length === 0) return null;
                return (
                  <section key={cat} className="rounded-2xl border border-white/[0.04] bg-midnight/30 p-6">
                    <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-accent/70 mb-4 border-b border-white/[0.04] pb-2">{cat}</h3>
                    <div className="space-y-1">
                      {categories[cat].sort().map(path => renderField(path))}
                    </div>
                  </section>
                );
              })}
              
              {Object.keys(categories).length === 0 && (
                <div className="text-center py-10 text-slate-500 text-sm font-mono">No settings match your search.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Undo Toast */}
      {undoState && (
        <div className="fixed bottom-6 right-6 z-50 bg-void border border-accent/30 rounded-lg shadow-2xl p-4 flex items-center gap-4 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div>
            <p className="text-sm font-medium text-slate-200">Setting updated</p>
            <p className="text-xs font-mono text-slate-500 mt-0.5 max-w-[200px] truncate">{undoState.path}</p>
          </div>
          <button 
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-xs font-mono uppercase tracking-wider font-bold"
          >
            <Undo className="w-3.5 h-3.5" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
