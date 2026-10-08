import { useSurfaceStripStore } from "../lib/surface-strip";
import { getDeviceBadge, useOriginsStore } from "../lib/origins";
import { cn } from "../lib/utils";

// Device strip: live web/android chips (realtime presence) + telegram/terminal
// chips ("last active" — polled status, never faked as presence).
// Tokens: ONLY @theme-registered roles (accent/muted/...). The first draft used
// shadcn-default token names this repo never defines (see origin-badges.check
// for the blocklist) — phantom vars render nothing. The dead useBrand
// subscription (unused tokens, re-render per theme change) was removed.
export function SurfaceStrip() {
  const { liveDevices, externalSources } = useSurfaceStripStore();
  
  const chips = [];
  
  for (const [device, info] of Object.entries(liveDevices)) {
    const badge = getDeviceBadge(device);
    chips.push({
      id: `live:${device}`,
      label: badge.label,
      icon: badge.icon,
      isLive: true,
      connections: info.connections,
      subtext: "Live"
    });
  }
  
  for (const [device, info] of Object.entries(externalSources)) {
    if (liveDevices[device]) continue; // Live wins
    const badge = getDeviceBadge(device);
    const date = new Date(info.last_active);
    const subtext = `Last active ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    chips.push({
      id: `ext:${device}`,
      label: badge.label,
      icon: badge.icon,
      isLive: false,
      subtext
    });
  }
  
  if (chips.length === 0) return null;
  
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 lg:px-6 py-1.5 border-b border-white/[0.07]">
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.id} className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-sm transition-colors",
            c.isLive ? "bg-accent/10 border-accent/20 text-accent" : "bg-white/5 border-white/10 text-muted"
          )}>
            <Icon className="w-3.5 h-3.5" />
            <span>{c.label}</span>
            <span className="opacity-70 ml-1 font-normal text-[10px]">{c.subtext}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OriginBadge({ sid, rowId }: { sid: string; rowId: number }) {
  const origin = useOriginsStore((s) => s.getOrigin(sid, rowId));
  if (!origin) return null;
  // Own-device badges MAY be suppressed. We pick: do not suppress here, render it always.
  // The check just needs to assert whichever we pick.
  const badge = getDeviceBadge(origin);
  const Icon = badge.icon;
  return (
    <div className="flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-[10px] text-muted bg-muted/15" title={`Sent from ${badge.label}`}>
      <Icon className="w-3 h-3" />
      <span className="sr-only">{badge.label}</span>
    </div>
  );
}
