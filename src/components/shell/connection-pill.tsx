"use client";

import { Loader2, Radio, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/client/store";

/** SSE + broker link state in one pill. */
export function ConnectionPill({ className, floating }: { className?: string; floating?: boolean }) {
  const sse = useStore((s) => s.sse);
  const broker = useStore((s) => s.broker?.state);

  let tone: "live" | "warning" | "offline";
  let label: string;
  let Icon = Radio;
  if (sse === "connecting") {
    tone = "warning";
    label = "Connecting…";
    Icon = Loader2;
  } else if (sse === "reconnecting") {
    tone = "warning";
    label = "Reconnecting…";
    Icon = Loader2;
  } else if (broker === "connected") {
    tone = "live";
    label = "Live";
  } else if (broker === "not_configured") {
    tone = "offline";
    label = "Broker not configured";
    Icon = Unplug;
  } else {
    tone = "warning";
    label = broker === "reconnecting" || broker === "connecting" ? "Broker reconnecting…" : "Broker offline";
    Icon = Unplug;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold whitespace-nowrap",
        tone === "live" && "bg-live-tint text-live-fg",
        tone === "warning" && "bg-warning-tint text-warning-fg",
        tone === "offline" && "bg-offline-tint text-offline-fg",
        floating && "glass shadow-float ring-1 ring-black/5 dark:ring-white/10",
        className,
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        {tone === "live" && <span className="axm-pulse-ring absolute inset-0 rounded-full bg-live" />}
        <span
          className={cn("relative size-2 rounded-full", tone === "live" ? "bg-live" : tone === "warning" ? "bg-warning" : "bg-offline")}
        />
      </span>
      <Icon className={cn("size-3.5", Icon === Loader2 && "animate-spin motion-reduce:animate-none")} aria-hidden />
      {label}
    </span>
  );
}
