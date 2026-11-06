"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeviceCard, DeviceCardSkeleton } from "@/components/devices/device-card";
import { KpiTiles, onListKeyDown, SearchAndFilter, useFilteredDevices, type DeviceFilter } from "@/components/devices/fleet-panel";
import { useStore } from "@/lib/client/store";

export default function DevicesPage() {
  const router = useRouter();
  const ready = useStore((s) => s.ready);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const { visible, counts, total, sosByDevice } = useFilteredDevices(query, filter);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <KpiTiles className="lg:grid-cols-4" />
        <div className="max-w-xl">
          <SearchAndFilter query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} counts={counts} />
        </div>
        {!ready ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <DeviceCardSkeleton key={i} />
            ))}
          </div>
        ) : total === 0 ? (
          <div className="rounded-3xl border border-dashed bg-card/50 p-10 text-center">
            <p className="font-bold">No devices yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Trackers are discovered automatically from <span className="font-mono text-xs">devices/+/#</span> — there is nothing to
              register. Run <span className="font-mono text-xs">npm run simulate</span> to see one appear.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-3xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No devices match this search or filter.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Devices" onKeyDown={onListKeyDown}>
            {visible.map((d) => (
              <li key={d.id}>
                <DeviceCard device={d} sos={sosByDevice.get(d.id)} onSelect={() => router.push(`/devices/${encodeURIComponent(d.id)}`)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
