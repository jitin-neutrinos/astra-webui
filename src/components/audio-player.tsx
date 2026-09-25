import { useState, useEffect, useRef } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "../lib/utils";
import { usePrefersReducedMotion } from "./chat-timeline";

export function AudioPlayer({ src, name }: { src: string; name: string }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const reqRef = useRef<number>(0);
  const instant = usePrefersReducedMotion();

  useEffect(() => {
    if (instant) return; // fallback to plain audio if reduced motion or data saving
    let active = true;
    const fetchPeaks = async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error("fetch failed");
        const buf = await res.arrayBuffer();
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuf = await ctx.decodeAudioData(buf);
        if (!active) return;
        const channel = audioBuf.getChannelData(0);
        const numBars = 48;
        const step = Math.floor(channel.length / numBars);
        const p = [];
        for (let i = 0; i < numBars; i++) {
          let max = 0;
          for (let j = 0; j < step; j++) {
            const v = Math.abs(channel[i * step + j]);
            if (v > max) max = v;
          }
          p.push(max);
        }
        setPeaks(p);
      } catch (e) {
        if (active) setError(true);
      }
    };
    fetchPeaks();
    return () => { active = false; };
  }, [src, instant]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => setError(true));
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const update = () => {
      if (a.duration) {
        setProgress(a.currentTime / a.duration);
        setDuration(a.duration);
      }
    };
    const loop = () => {
      update();
      if (playing) reqRef.current = requestAnimationFrame(loop);
    };
    if (playing) reqRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(reqRef.current);
  }, [playing]);

  const fmtDur = (s: number) => {
    const m = Math.floor(s / 60);
    const secs = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${secs}`;
  };

  if (instant || error || !peaks) {
    return (
      <div className="flex w-72 flex-col gap-2 rounded-[var(--radius-inner)] bg-[var(--surface-raised)] p-3 border border-white/5">
        <div className="truncate text-xs text-slate-300 font-medium">{name}</div>
        <audio ref={audioRef} src={src} controls className="h-8 w-full" preload="metadata" />
      </div>
    );
  }

  const curTime = audioRef.current?.currentTime || 0;

  return (
    <div className="flex w-72 items-center gap-3 rounded-[var(--radius-inner)] bg-[var(--surface-raised)] p-3 border border-white/5">
      <audio 
        ref={audioRef} 
        src={src} 
        preload="metadata"
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      
      <button 
        type="button" 
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-step-2)] text-[var(--color-cyanx)] hover:bg-[var(--surface-overlay)] transition-colors duration-[var(--motion-fast)]"
      >
        {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current translate-x-[1px]" />}
      </button>
      
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div className="truncate text-xs text-slate-300 font-medium leading-none">{name}</div>
        <div className="flex h-5 items-end gap-[1px]">
          {peaks.map((p, i) => {
            const h = Math.max(4, Math.round(p * 20));
            const filled = (i / peaks.length) <= progress;
            return (
              <div 
                key={i} 
                className={cn(
                  "w-1 rounded-sm transition-colors duration-100",
                  filled ? "bg-[var(--color-cyanx)]" : "bg-white/10"
                )}
                style={{ height: `${h}px` }}
              />
            );
          })}
        </div>
        <div className="text-[10px] font-mono text-slate-500 leading-none">
          {fmtDur(curTime)} / {fmtDur(duration)}
        </div>
      </div>
    </div>
  );
}
