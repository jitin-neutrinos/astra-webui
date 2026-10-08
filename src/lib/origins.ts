import { create } from "zustand";
import { Terminal, Send, Monitor, Smartphone, MessageCircle } from "lucide-react";
import type { ElementType } from "react";

export type OriginBadgeInfo = {
  label: string;
  icon: ElementType;
};

export function getDeviceBadge(device: string): OriginBadgeInfo {
  const d = (device || "").toLowerCase();
  if (d === "telegram") return { label: "Telegram", icon: MessageCircle };
  if (d === "cli" || d === "tui" || d === "terminal") return { label: "Terminal", icon: Terminal };
  if (d.includes("android") || d.includes("phone") || d.includes("mobile")) return { label: "Android", icon: Smartphone };
  return { label: "Web", icon: Monitor };
}

interface OriginsState {
  origins: Record<string, string>;
  sessionSources: Record<string, string>;
  
  ingestHistory: (payload: any) => void;
  ingestEvent: (payload: { stored_sid: string; row_id: number; device: string }) => void;
  getOrigin: (sid: string, rowId: number) => string | null;
}

export const useOriginsStore = create<OriginsState>((set, get) => ({
  origins: {},
  sessionSources: {},
  
  ingestHistory: (payload) => {
    if (!payload) return;
    const sid = payload.id || payload.session_id;
    if (!sid) return;
    
    set((state) => {
      const nextOrigins = { ...state.origins };
      const nextSources = { ...state.sessionSources };
      
      const source = payload.source || payload.session?.source;
      if (source) nextSources[sid] = source;
      
      if (Array.isArray(payload.messages)) {
        for (const msg of payload.messages) {
          if (msg.role !== "user" || msg.id === undefined) continue;
          if (msg.origin) {
            nextOrigins[`${sid}:${msg.id}`] = msg.origin;
          }
        }
      }
      return { origins: nextOrigins, sessionSources: nextSources };
    });
  },
  
  ingestEvent: (ev) => {
    set((state) => ({
      origins: {
        ...state.origins,
        [`${ev.stored_sid}:${ev.row_id}`]: ev.device
      }
    }));
  },
  
  getOrigin: (sid, rowId) => {
    const { origins, sessionSources } = get();
    const explicit = origins[`${sid}:${rowId}`];
    if (explicit) return explicit;
    const source = sessionSources[sid];
    if (source === "telegram" || source === "cli" || source === "tui") return source;
    return null;
  }
}));

if (typeof window !== "undefined") {
  window.addEventListener("astra-ws-event", ((e: CustomEvent<any>) => {
    const d = e.detail;
    if (d?.type === "message.origin" && d.payload) {
      useOriginsStore.getState().ingestEvent(d.payload);
    }
  }) as EventListener);
}
