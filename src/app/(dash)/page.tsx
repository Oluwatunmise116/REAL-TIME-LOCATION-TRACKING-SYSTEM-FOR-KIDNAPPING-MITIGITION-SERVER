"use client";

import { useState } from "react";
import { FleetPanel } from "@/components/devices/fleet-panel";
import { FleetMap } from "@/components/map/fleet-map";
import { BottomSheet, type Snap } from "@/components/shell/bottom-sheet";
import { useActiveSosByDevice } from "@/components/shell/sos-banner";
import { useStore } from "@/lib/client/store";
import { useIsPhone } from "@/lib/client/use-media";

function SheetHeader() {
  const devices = useStore((s) => s.devices);
  const ready = useStore((s) => s.ready);
  const sos = useActiveSosByDevice();
  const list = Object.values(devices);
  const online = list.filter((d) => d.connection === "online").length;
  return (
    <div className="flex items-baseline justify-between px-5 pb-3">
      <h2 className="text-base font-bold">Devices</h2>
      <p className="tabular text-xs font-medium text-muted-foreground">
        {ready ? (
          <>
            {online} of {list.length} online
            {sos.length > 0 && <span className="ml-2 font-bold text-danger-fg">· {sos.length} SOS</span>}
          </>
        ) : (
          "Loading…"
        )}
      </p>
    </div>
  );
}

export default function FleetPage() {
  const isPhone = useIsPhone();
  // The latest of (a device getting focused, the user moving the sheet) decides the snap: focusing a
  // device (tap, SOS auto-focus, "View on map") drops the sheet so the map and info card show.
  const focusAt = useStore((s) => s.focusRequest?.at ?? 0);
  const [manual, setManual] = useState<{ snap: Snap; at: number }>({ snap: "half", at: 0 });
  const snap: Snap = focusAt > manual.at ? "peek" : manual.snap;
  const setSnap = (next: Snap) => setManual({ snap: next, at: Date.now() });
  return (
    <div className="flex h-full">
      {!isPhone && (
        <aside
          aria-label="Fleet"
          className="scrollbar-thin w-[340px] shrink-0 overflow-y-auto border-r bg-background p-4 md:block xl:w-[380px] xl:p-5"
        >
          <FleetPanel />
        </aside>
      )}
      <section aria-label="Map" className="relative min-w-0 flex-1">
        <FleetMap />
        {isPhone && (
          <BottomSheet snap={snap} onSnapChange={setSnap} header={<SheetHeader />} label="Device list">
            <FleetPanel />
          </BottomSheet>
        )}
      </section>
    </div>
  );
}
