import { create } from "zustand";

export type StripChip = {
  id: string; // "live:android" or "ext:telegram"
  type: "live" | "external";
  device: string;
  focuses?: string[];
  connections?: number;
  last_active?: number;
};

interface SurfaceStripState {
  liveDevices: Record<string, { focuses: string[], connections: number }>;
  externalSources: Record<string, { last_active: number }>;
  
  ingestSnapshot: (payload: any) => void;
  ingestExternalStatus: (payload: any) => void;
}

export const useSurfaceStripStore = create<SurfaceStripState>((set) => ({
  liveDevices: {},
  externalSources: {},
  
  ingestSnapshot: (payload) => {
    if (!payload) return;
    set((state) => {
      const nextLive: Record<string, { focuses: string[], connections: number }> = {};
      if (Array.isArray(payload.devices)) {
        for (const d of payload.devices) {
          if (d.device) nextLive[d.device] = { focuses: d.focuses || [], connections: d.connections || 1 };
        }
      }
      const ext = payload.external_sources?.sources;
      let nextExt = state.externalSources;
      if (ext) {
        nextExt = { ...ext };
      }
      return { liveDevices: nextLive, externalSources: nextExt };
    });
  },
  
  ingestExternalStatus: (payload) => {
    if (!payload?.sources) return;
    set({ externalSources: payload.sources });
  }
}));

if (typeof window !== "undefined") {
  window.addEventListener("astra-ws-event", ((e: CustomEvent<any>) => {
    const d = e.detail;
    if (d?.type === "presence.snapshot" && d.payload) {
      useSurfaceStripStore.getState().ingestSnapshot(d.payload);
    } else if (d?.type === "external.status" && d.payload) {
      useSurfaceStripStore.getState().ingestExternalStatus(d.payload);
    }
  }) as EventListener);
}
