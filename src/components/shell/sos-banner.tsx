"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, MapPin, Siren, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acknowledge } from "@/components/providers/live-provider";
import { audioArmed, armAudio } from "@/lib/client/alarm";
import { formatAge, formatShortCoord, relTime } from "@/lib/client/format";
import { deviceName, useStore } from "@/lib/client/store";
import { useIsPhone } from "@/lib/client/use-media";
import { useNow } from "@/lib/client/use-now";
import { sosLevelLabel } from "@/lib/domain/labels";
import type { EventView } from "@/lib/domain/types";

type SosEvent = Extract<EventView, { type: "sos" }>;

/** Latest unacknowledged SOS per device, most severe / newest first. */
export function useActiveSosByDevice(): SosEvent[] {
  const activeSos = useStore((s) => s.activeSos);
  return useMemo(() => {
    const byDevice = new Map<string, SosEvent>();
    for (const e of Object.values(activeSos)) {
      if (e.type !== "sos") continue;
      const cur = byDevice.get(e.deviceId);
      if (!cur || e.ts > cur.ts) byDevice.set(e.deviceId, e);
    }
    return [...byDevice.values()].sort(
      (a, b) => Number(b.payload.level === "DANGER") - Number(a.payload.level === "DANGER") || b.ts - a.ts,
    );
  }, [activeSos]);
}

function SosRow({ e }: { e: SosEvent }) {
  const router = useRouter();
  const path = usePathname();
  const now = useNow();
  const device = useStore((s) => s.devices[e.deviceId]);
  const focus = useStore((s) => s.focus);
  const [busy, setBusy] = useState(false);
  const name = deviceName(device, e.deviceId);
  const hasPos = e.lat !== null && e.lon !== null;

  let where: string;
  if (hasPos) {
    where = `${formatShortCoord(e.lat!, e.lon!)} · position ${formatAge(e.ageSec)} old`;
  } else if (device?.lat != null && device?.lon != null) {
    const at = device.fixTs ?? device.fixChangedAt;
    where = `No position available. Last known: ${formatShortCoord(device.lat, device.lon)}${at ? `, ${relTime(at, now)}` : ""}`;
  } else {
    where = "No position available. The device has never reported a GPS fix.";
  }

  const view = () => {
    focus(e.deviceId, hasPos ? { lat: e.lat!, lon: e.lon! } : undefined);
    if (path !== "/") router.push(`/devices/${encodeURIComponent(e.deviceId)}`);
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20" aria-hidden>
          <span className="axm-sos-ring absolute inset-0 rounded-full bg-white/40" />
          <Siren className="relative size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm leading-tight font-bold sm:text-[15px]">
            SOS · {sosLevelLabel(e.payload.level).toUpperCase()} from {name}
            <span className="font-semibold opacity-90">
              {" "}
              · {e.payload.presses} press{e.payload.presses === 1 ? "" : "es"}
            </span>
          </p>
          <p className="mt-0.5 text-xs leading-snug opacity-90 sm:text-[13px]">
            {where} · {e.tsApprox ? "≈ " : ""}
            {relTime(e.ts, now) || "just now"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
        <Button size="lg" onClick={view} className="h-11 rounded-full bg-white px-4 font-semibold text-danger-fg hover:bg-white/90 sm:h-9">
          <MapPin /> View on map
        </Button>
        <Button
          size="lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await acknowledge(e, true);
            setBusy(false);
          }}
          className="h-11 rounded-full border border-white/50 bg-transparent px-4 font-semibold text-white hover:bg-white/15 sm:h-9"
        >
          <Check /> Acknowledge
        </Button>
      </div>
    </div>
  );
}

/** Full-width red banner pinned above every page until each SOS is acknowledged. */
export function SosBanner() {
  const items = useActiveSosByDevice();
  const soundOn = useStore((s) => s.prefs.sound);
  const [, force] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const isPhone = useIsPhone();
  // Keep the banner from swallowing the screen when several devices are in SOS at once.
  const limit = expanded ? items.length : isPhone ? 1 : 2;
  const hidden = items.length - limit;
  const needsArm = soundOn && items.length > 0 && !audioArmed();

  return (
    // The live region is always mounted so screen readers announce content as it appears.
    <div role="alert" aria-live="assertive" aria-atomic="false" className="pt-safe z-40 shrink-0 bg-danger text-white empty:hidden">
      {items.length > 0 && (
        <>
          <div className="divide-y divide-white/20">
            {items.slice(0, limit).map((e) => (
              <SosRow key={e.id} e={e} />
            ))}
          </div>
          {(hidden > 0 || expanded) && items.length > (isPhone ? 1 : 2) && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="flex h-10 w-full items-center justify-center gap-1.5 border-t border-white/20 text-xs font-bold"
            >
              {expanded ? "Show fewer" : `+ ${hidden} more device${hidden === 1 ? "" : "s"} in SOS · show all`}
            </button>
          )}
          {needsArm && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 bg-black/15 py-1.5 text-xs font-semibold"
              onClick={() => {
                armAudio();
                setTimeout(() => force((n) => n + 1), 100);
              }}
            >
              <VolumeX className="size-3.5" /> Alarm sound is blocked by the browser. Tap to enable.
            </button>
          )}
        </>
      )}
    </div>
  );
}
