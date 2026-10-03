import { useEffect, useState, useMemo, useRef } from "react";
import { ArrowLeft, Check, Loader2, Undo, Download, Upload, AlertTriangle, Search, ChevronDown, ChevronRight, RefreshCw, Brain, Cpu, Zap, Shield, Database, Plus, X, Trash2 } from "lucide-react";
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
  const [providerOptions, setProviderOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderSlug, setNewProviderSlug] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelProvider, setNewModelProvider] = useState("");
  const [brainOpen, setBrainOpen] = useState(true);
  const [behaviorOpen, setBehaviorOpen] = useState(true);

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
        setProviderOptions(opt.providers);
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
    const parts = path.split(".");
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
      const parts = path.split(".");
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
    const parts = path.split(".");
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

  // Derive current provider from model name (persists across reloads)
  const currentProvider = useMemo(() => {
    const model = getVal("model");
    if (!model) return "";
    for (const p of providerOptions) {
      const models = (p.models || []).map((m: any) => typeof m === "string" ? m : m.id || m.name);
      if (models.includes(model)) return p.slug;
    }
    return "";
  }, [getVal("model"), providerOptions]);

  // Models filtered by selected provider
  const filteredModels = useMemo(() => {
    if (!currentProvider) return modelOptions;
    const p = providerOptions.find((x: any) => x.slug === currentProvider);
    if (!p) return modelOptions;
    return (p.models || []).map((m: any) => typeof m === "string" ? m : m.id || m.name).filter(Boolean);
  }, [currentProvider, providerOptions, modelOptions]);

  // Fallback chain helpers
  const addFallbackEntry = () => {
    const chain = [...(getVal("fallback_providers") || [])];
    chain.push({ provider: "", model: "" });
    updateVal("fallback_providers", chain);
  };

  const updateFallbackEntry = (index: number, field: string, value: string) => {
    const chain = [...(getVal("fallback_providers") || [])];
    chain[index] = { ...chain[index], [field]: value };
    updateVal("fallback_providers", chain);
  };

  const removeFallbackEntry = (index: number) => {
    const chain = [...(getVal("fallback_providers") || [])];
    chain.splice(index, 1);
    updateVal("fallback_providers", chain);
  };

  // Add provider/model helpers
  const addProvider = () => {
    if (!newProviderSlug.trim()) return;
    const newProv = { slug: newProviderSlug.trim(), name: newProviderName.trim() || newProviderSlug.trim(), models: [] };
    setProviderOptions((prev: any[]) => [...prev, newProv]);
    setShowAddProvider(false);
    setNewProviderName("");
    setNewProviderSlug("");
  };

  const addModel = () => {
    if (!newModelName.trim() || !newModelProvider) return;
    setProviderOptions((prev: any[]) =>
      prev.map((p: any) =>
        p.slug === newModelProvider
          ? { ...p, models: [...(p.models || []), newModelName.trim()] }
          : p
      )
    );
    setShowAddModel(false);
    setNewModelName("");
    setNewModelProvider("");
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
          <div className="h-8 bg-white/5 rounded w-48 animate-pulse mb-8" />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const renderField = (path: string, label?: string, typeOverride?: string, optionsOverride?: string[]) => {
    const fieldSchema = schema?.fields?.[path];
    if (!fieldSchema && !label) return null;

    const type = typeOverride || fieldSchema?.type || "string";
    const options = optionsOverride || fieldSchema?.options || [];
    const val = getVal(path);
    const saveStatus = saves[path];
    const displayLabel = label || path;

    const renderSaveState = () => {
      if (saveStatus === "saving") return <Loader2 className="w-3.5 h-3.5 animate-spin text-cyanx" />;
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
              className={cn("w-12 h-6 rounded-lg transition-colors relative shrink-0", val ? "bg-cyanx" : "bg-white/10")}
            >
              <span className={cn("absolute top-0.5 left-0.5 bg-void w-5 h-5 rounded-md transition-transform", val && "translate-x-6")} />
            </button>
          ) : type === "select" || (options && options.length > 0) ? (
            options.length > 0 ? (
              <select
                value={val ?? ""}
                onChange={(e) => updateVal(path, e.target.value)}
                className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-cyanx/50 min-w-[140px] appearance-none cursor-pointer"
              >
                {options.map((opt: string) => <option key={opt} value={opt}>{opt || "off"}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={drafts[path] ?? val ?? ""}
                onChange={(e) => editTextInput(path, e.target.value)}
                className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-cyanx/50 w-full sm:w-48"
              />
            )
          ) : type === "number" ? (
            <input
              type="number"
              value={drafts[path] ?? val ?? ""}
              onChange={(e) => editTextInput(path, e.target.value, (v) => { const n = parseFloat(v); return Number.isNaN(n) ? undefined : n; })}
              className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-cyanx/50 w-24 text-right"
            />
          ) : type === "list" ? (
            <textarea
              value={drafts[path] ?? (Array.isArray(val) ? val.join('\n') : "")}
              onChange={(e) => editTextInput(path, e.target.value, (v) => v.split('\n').filter(x => x))}
              className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-cyanx/50 w-full sm:w-64 min-h-[60px]"
              placeholder="One item per line"
            />
          ) : (
            <input
              type="text"
              value={drafts[path] ?? val ?? ""}
              onChange={(e) => editTextInput(path, e.target.value)}
              className="bg-midnight border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-cyanx/50 w-full sm:w-64"
            />
          )}
        </div>
      </div>
    );
  };

  const ttsProvider = getVal("tts.provider") || "openai";
  const ttsVoiceKey = schema?.fields?.[`tts.${ttsProvider}.voice`] ? `tts.${ttsProvider}.voice`
    : schema?.fields?.[`tts.${ttsProvider}.voice_id`] ? `tts.${ttsProvider}.voice_id` : null;
  const ttsSpeedKey = schema?.fields?.[`tts.${ttsProvider}.speed`] ? `tts.${ttsProvider}.speed` : null;

  // Custom dropdown component
  const DropdownSelect = ({ value, onChange, options, placeholder = "Select...", className = "" }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    className?: string;
  }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);
    const selected = options.find(o => o.value === value);
    return (
      <div ref={ref} className={`relative ${className}`}>
        <button type="button" onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-2 bg-midnight border border-white/10 rounded-lg px-3 py-2 text-sm text-left hover:border-cyanx/30 focus:border-cyanx/50 focus:outline-none transition-colors cursor-pointer"
        >
          <span className={cn("truncate", !selected && "text-slate-500")}>{selected?.label || placeholder}</span>
          <ChevronDown className={cn("w-4 h-4 text-slate-500 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-midnight border border-white/10 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
            {options.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-cyanx/10 transition-colors truncate",
                  o.value === value ? "text-cyanx bg-cyanx/5" : "text-slate-300")}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto bg-void text-brandtext font-sans px-3 py-4 sm:px-6 lg:p-10 relative">
      <div className="max-w-4xl mx-auto mb-8 flex items-center gap-4">
        <button type="button" onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-white/5 text-slate-400 transition lg:hidden" aria-label="Back to chat">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="font-display text-2xl lg:text-3xl tracking-tight text-brandtext">System Configuration</h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyanx/70 mt-1">Live core parameters</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-6">

        {/* Brain Section - Collapsible */}
        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 backdrop-blur-md overflow-hidden">
          <button type="button" onClick={() => setBrainOpen(!brainOpen)} className="w-full flex items-center gap-3 p-6 pb-4 text-left hover:bg-white/[0.02] transition-colors">
            <div className="w-8 h-8 rounded-lg bg-cyanx/10 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-cyanx" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg text-brandtext">Brain</h3>
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Core AI Configuration</p>
            </div>
            <ChevronDown className={cn("w-5 h-5 text-slate-500 transition-transform shrink-0", !brainOpen && "-rotate-90")} />
          </button>
          {brainOpen && (
          <div className="px-6 pb-6 space-y-6">

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-void/50 rounded-lg p-3">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1">Model</div>
              <div className="text-sm font-mono text-brandtext truncate">{getVal("model") || "—"}</div>
            </div>
            <div className="bg-void/50 rounded-lg p-3">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1">Reasoning</div>
              <div className="text-sm font-mono text-brandtext">{getVal("agent.reasoning_effort") || "—"}</div>
            </div>
            <div className="bg-void/50 rounded-lg p-3">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1">Memory</div>
              <div className="text-sm font-mono text-brandtext">{getVal("memory.memory_enabled") ? "On" : "Off"}</div>
            </div>
            <div className="bg-void/50 rounded-lg p-3">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1">Streaming</div>
              <div className="text-sm font-mono text-brandtext">{getVal("streaming.enabled") ? "On" : "Off"}</div>
            </div>
          </div>

          {/* Model & Provider */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-3.5 h-3.5 text-cyanx/70" />
              <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Model & Provider</h4>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-mono mb-1 block">Provider</label>
                  <div className="flex gap-2">
                    <DropdownSelect
                      value={currentProvider}
                      onChange={(v) => updateVal("provider", v)}
                      options={providerOptions.map(p => ({ value: p.slug, label: p.name }))}
                      placeholder="Select provider"
                      className="flex-1"
                    />
                    <button onClick={() => setShowAddProvider(true)} className="p-2 rounded-lg bg-cyanx/10 hover:bg-cyanx/20 text-cyanx transition-colors shrink-0" title="Add provider">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-mono mb-1 block">Model</label>
                  <div className="flex gap-2">
                    <DropdownSelect
                      value={getVal("model") || ""}
                      onChange={(v) => updateVal("model", v)}
                      options={filteredModels.map((m: string) => ({ value: m, label: m }))}
                      placeholder="Select model"
                      className="flex-1"
                    />
                    <button onClick={() => setShowAddModel(true)} className="p-2 rounded-lg bg-cyanx/10 hover:bg-cyanx/20 text-cyanx transition-colors shrink-0" title="Add model">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
              {renderField("model_context_length", "Context Length", "number")}

              {/* Fallback Chain - Editable */}
              <div className="py-3 border-b border-white/[0.04]">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="text-sm text-slate-200 font-medium font-mono">Fallback Chain</label>
                    <p className="text-xs text-slate-500 mt-0.5">Ordered failover sequence</p>
                  </div>
                  <button onClick={addFallbackEntry} className="flex items-center gap-1 px-2 py-1 rounded-md bg-cyanx/10 hover:bg-cyanx/20 text-cyanx text-xs font-mono transition-colors">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {(getVal("fallback_providers") || []).map((entry: any, i: number) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-void/50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500 w-4">{i + 1}.</span>
                        <select
                          value={entry.provider || ""}
                          onChange={(e) => updateFallbackEntry(i, "provider", e.target.value)}
                          className="flex-1 sm:flex-none bg-midnight border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyanx/50 appearance-none cursor-pointer"
                        >
                          <option value="">Provider</option>
                          {providerOptions.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                        </select>
                        <button onClick={() => removeFallbackEntry(i)} className="p-1 rounded hover:bg-redx/20 text-slate-500 hover:text-redx transition-colors shrink-0" title="Remove">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <select
                        value={entry.model || ""}
                        onChange={(e) => updateFallbackEntry(i, "model", e.target.value)}
                        className="flex-1 bg-midnight border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-cyanx/50 appearance-none cursor-pointer"
                      >
                        <option value="">Model</option>
                        {(() => {
                          const models: any[] = providerOptions.find((p: any) => p.slug === entry.provider)?.models || [];
                          return models.map((m: any) => {
                            const mid = typeof m === "string" ? m : m.id || m.name || "";
                            return <option key={mid} value={mid}>{mid}</option>;
                          });
                        })()}
                      </select>
                    </div>
                  ))}
                  {(!getVal("fallback_providers") || getVal("fallback_providers").length === 0) && (
                    <p className="text-xs text-slate-500 font-mono py-2">No fallback providers configured</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Reasoning & Thinking */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-3.5 h-3.5 text-cyanx/70" />
              <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Reasoning & Thinking</h4>
            </div>
            <div className="space-y-1">
              {renderField("agent.reasoning_effort", "Reasoning Effort", "select", ["off", "low", "medium", "high", "ultra"])}
              {renderField("agent.service_tier", "Service Tier", "select", ["", "normal", "fast", "auto", "cold"])}
              {renderField("agent.max_turns", "Max Turns", "number")}
              {renderField("agent.reasoning_echo", "Reasoning Echo", "boolean")}
            </div>
          </div>

          {/* Memory & Context */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-3.5 h-3.5 text-cyanx/70" />
              <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Memory & Context</h4>
            </div>
            <div className="space-y-1">
              {renderField("memory.memory_enabled", "Memory System", "boolean")}
              {renderField("memory.provider", "Memory Provider", "select", ["", "agentmemory", "byterover", "holographic", "honcho", "mem0", "openviking", "retaindb", "supermemory"])}
              {renderField("memory.memory_char_limit", "Memory Char Limit", "number")}
              {renderField("memory.user_char_limit", "User Char Limit", "number")}
              {renderField("memory.user_profile_enabled", "User Profile", "boolean")}
            </div>
          </div>

          {/* Streaming & Output */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-cyanx/70" />
              <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Streaming & Output</h4>
            </div>
            <div className="space-y-1">
              {renderField("streaming.enabled", "Stream Responses", "boolean")}
              {renderField("streaming.buffer_threshold", "Buffer Threshold", "number")}
              {renderField("streaming.cursor", "Cursor Character")}
            </div>
          </div>

          {/* Agent Behavior */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-3.5 h-3.5 text-cyanx/70" />
              <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Agent Behavior</h4>
            </div>
            <div className="space-y-1">
              {renderField("agent.tool_use_enforcement", "Tool Use Enforcement")}
              {renderField("agent.execution_guidance", "Execution Guidance")}
              {renderField("agent.stall_guards", "Stall Guards", "boolean")}
              {renderField("agent.verify_guidance", "Verify Guidance", "boolean")}
              {renderField("agent.environment_probe", "Environment Probe", "boolean")}
            </div>
          </div>

          {/* Safety & Guards */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-cyanx/70" />
              <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Safety & Guards</h4>
            </div>
            <div className="space-y-1">
              {renderField("agent.empty_response_guard.enabled", "Empty Response Guard", "boolean")}
              {renderField("agent.empty_response_guard.cost_threshold_usd", "Cost Threshold (USD)", "number")}
              {renderField("agent.bot_mode_protocol", "Bot Mode Protocol", "boolean")}
            </div>
          </div>
          </div>
          )}
        </section>

        {/* Behavior Section - Collapsible */}
        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 backdrop-blur-md overflow-hidden">
          <button type="button" onClick={() => setBehaviorOpen(!behaviorOpen)} className="w-full flex items-center gap-3 p-6 pb-4 text-left hover:bg-white/[0.02] transition-colors">
            <div className="w-8 h-8 rounded-lg bg-violetx/10 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-violetx" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg text-brandtext">Behavior</h3>
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Interaction & Safety</p>
            </div>
            <ChevronDown className={cn("w-5 h-5 text-slate-500 transition-transform shrink-0", !behaviorOpen && "-rotate-90")} />
          </button>
          {behaviorOpen && (
          <div className="px-6 pb-6 space-y-6">
            {/* Approvals */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-3.5 h-3.5 text-violetx/70" />
                <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Approvals</h4>
              </div>
              <div className="space-y-1">
                {renderField("approvals.mode", "Approval Mode", "select", ["manual", "smart", "off"])}
                {renderField("approvals.timeout", "Approval Timeout (s)", "number")}
                {renderField("approvals.destructive_slash_confirm", "Confirm Destructive Commands", "boolean")}
              </div>
            </div>
            {/* Memory */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-3.5 h-3.5 text-violetx/70" />
                <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Memory</h4>
              </div>
              <div className="space-y-1">
                {renderField("memory.memory_enabled", "Memory System", "boolean")}
                {renderField("memory.write_approval", "Memory Write Approval", "boolean")}
                {renderField("memory.nudge_interval", "Nudge Interval", "number")}
              </div>
            </div>
            {/* Interaction */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-3.5 h-3.5 text-violetx/70" />
                <h4 className="text-xs font-mono uppercase tracking-[0.15em] text-slate-400">Interaction</h4>
              </div>
              <div className="space-y-1">
                {renderField("agent.text_verbosity", "Text Verbosity")}
                {renderField("agent.coding_context", "Coding Context")}
                {renderField("agent.image_input_mode", "Image Input Mode")}
              </div>
            </div>
          </div>
          )}
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
            {renderField("streaming.enabled", "Stream Responses", "boolean")}
          </div>
          <ThemePanel />
        </section>

        <section className="rounded-2xl border border-redx/20 bg-redx/5 p-6 backdrop-blur-md">
          <h3 className="font-display text-lg text-redx mb-4 border-b border-redx/10 pb-2">Danger Zone</h3>
          <div className="flex flex-wrap gap-3">
            <button onClick={exportConfig} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-void border border-white/10 hover:border-cyanx/50 transition-colors text-sm font-mono text-slate-300">
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
                  className="w-full bg-midnight/50 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-cyanx/50 font-mono"
                />
              </div>

              {Object.keys(categories).sort().map(cat => {
                if (categories[cat].length === 0) return null;
                return (
                  <section key={cat} className="rounded-2xl border border-white/[0.04] bg-midnight/30 p-6">
                    <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-cyanx/70 mb-4 border-b border-white/[0.04] pb-2">{cat}</h3>
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
        <div className="fixed bottom-6 right-6 z-50 bg-void border border-cyanx/30 rounded-lg shadow-2xl p-4 flex items-center gap-4 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div>
            <p className="text-sm font-medium text-slate-200">Setting updated</p>
            <p className="text-xs font-mono text-slate-500 mt-0.5 max-w-[200px] truncate">{undoState.path}</p>
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyanx/10 text-cyanx hover:bg-cyanx/20 transition-colors text-xs font-mono uppercase tracking-wider font-bold"
          >
            <Undo className="w-3.5 h-3.5" /> Undo
          </button>
        </div>
      )}

      {/* Add Provider Modal */}
      {showAddProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddProvider(false)}>
          <div className="bg-midnight border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-brandtext">Add Provider</h3>
              <button onClick={() => setShowAddProvider(false)} className="p-1 rounded hover:bg-white/10 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 font-mono mb-1 block">Provider Slug</label>
                <input
                  type="text"
                  value={newProviderSlug}
                  onChange={e => setNewProviderSlug(e.target.value)}
                  placeholder="e.g. openai"
                  className="w-full bg-void border border-white/10 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyanx/50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 font-mono mb-1 block">Display Name</label>
                <input
                  type="text"
                  value={newProviderName}
                  onChange={e => setNewProviderName(e.target.value)}
                  placeholder="e.g. OpenAI"
                  className="w-full bg-void border border-white/10 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyanx/50"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowAddProvider(false)} className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition-colors">Cancel</button>
                <button onClick={addProvider} className="flex-1 px-4 py-2 rounded-lg bg-cyanx hover:bg-cyanx/80 text-void text-sm font-medium transition-colors">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Model Modal */}
      {showAddModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModel(false)}>
          <div className="bg-midnight border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-brandtext">Add Model</h3>
              <button onClick={() => setShowAddModel(false)} className="p-1 rounded hover:bg-white/10 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 font-mono mb-1 block">Provider</label>
                <select
                  value={newModelProvider}
                  onChange={e => setNewModelProvider(e.target.value)}
                  className="w-full bg-void border border-white/10 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyanx/50 appearance-none cursor-pointer"
                >
                  <option value="">Select provider</option>
                  {providerOptions.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-mono mb-1 block">Model ID</label>
                <input
                  type="text"
                  value={newModelName}
                  onChange={e => setNewModelName(e.target.value)}
                  placeholder="e.g. gpt-4o"
                  className="w-full bg-void border border-white/10 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-cyanx/50"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowAddModel(false)} className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition-colors">Cancel</button>
                <button onClick={addModel} className="flex-1 px-4 py-2 rounded-lg bg-cyanx hover:bg-cyanx/80 text-void text-sm font-medium transition-colors">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
