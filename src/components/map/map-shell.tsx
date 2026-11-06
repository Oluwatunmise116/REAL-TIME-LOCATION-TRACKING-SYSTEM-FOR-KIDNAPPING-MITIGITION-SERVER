"use client";

import { APIProvider, ColorScheme, Map } from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";
import { Component, createContext, useContext, useEffect, useState } from "react";
import { KeyRound, MapPinOff, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/client/store";

/** True when children are rendered inside a working APIProvider (so map hooks are safe to call). */
const MapsAvailable = createContext(false);
export const useMapsAvailable = () => useContext(MapsAvailable);

export const DEFAULT_ZOOM = 13;

type GmWindow = Window & { gm_authFailure?: () => void };

/**
 * Keeps a broken map from taking the whole page down. After Google rejects a key (e.g. a referrer
 * that isn't allowed) its marker setters throw, and without this the SOS banner and alerts would go too.
 */
class MapErrorBoundary extends Component<{ onError: (e: Error) => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function MapNotice({ icon: Icon, title, children }: { icon: typeof KeyRound; title: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px] p-6">
      <div role="alert" className="max-w-md rounded-3xl bg-card p-6 text-center shadow-float ring-1 ring-black/5 dark:ring-white/10">
        <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-warning-tint text-warning-fg">
          <Icon className="size-5" aria-hidden />
        </span>
        <h2 className="text-base font-bold">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/**
 * Google Map with app defaults, loading/error states and a slot for floating UI.
 * `overlay` renders above the map even when the map can't load, so device info stays usable.
 */
export function MapShell({ children, overlay, className }: { children?: React.ReactNode; overlay?: React.ReactNode; className?: string }) {
  const config = useStore((s) => s.config);
  const configError = useStore((s) => s.configError);
  const { resolvedTheme } = useTheme();
  const [authFailed, setAuthFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crashed, setCrashed] = useState(false);

  useEffect(() => {
    // Google calls this global when the key is invalid or the referrer isn't allowed.
    (window as GmWindow).gm_authFailure = () => setAuthFailed(true);
  }, []);

  let body: React.ReactNode;
  if (configError) {
    body = (
      <MapNotice icon={TriangleAlert} title="Couldn't load map settings">
        {configError}. Device data below is still live.
      </MapNotice>
    );
  } else if (!config) {
    body = <Skeleton className="absolute inset-0 rounded-none" />;
  } else if (!config.mapsApiKey) {
    body = (
      <MapNotice icon={KeyRound} title="Google Maps API key missing">
        Set <code className="rounded bg-muted px-1 py-0.5 text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> (and{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">NEXT_PUBLIC_GOOGLE_MAP_ID</code>) in the server environment and restart. See
        the README section “Google Maps”. Live data, alerts and coordinates keep working without the map.
      </MapNotice>
    );
  }

  if (body || !config?.mapsApiKey) {
    return (
      <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
        {body}
        <MapsAvailable value={false}>{overlay}</MapsAvailable>
      </div>
    );
  }

  const scheme = resolvedTheme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT;
  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-muted", className)}>
      <APIProvider
        apiKey={config.mapsApiKey}
        libraries={["marker", "geocoding"]}
        onError={(e) => setLoadError(e instanceof Error ? e.message : "Maps failed to load")}
      >
        <MapsAvailable value={true}>
          <MapErrorBoundary
            onError={(e) => {
              console.error("[map]", e);
              setCrashed(true);
            }}
          >
            <Map
              key={scheme /* colorScheme only applies at init */}
              mapId={config.mapId ?? "DEMO_MAP_ID"}
              colorScheme={scheme}
              defaultCenter={config.defaultCenter}
              defaultZoom={DEFAULT_ZOOM}
              disableDefaultUI
              clickableIcons={false}
              gestureHandling="greedy"
              reuseMaps
              className="absolute inset-0"
            >
              {/* Markers on a map whose key was rejected throw, so don't mount them. */}
              {authFailed ? null : children}
            </Map>
          </MapErrorBoundary>
          {overlay}
        </MapsAvailable>
      </APIProvider>
      {(authFailed || loadError || crashed) && (
        <MapNotice icon={MapPinOff} title={authFailed || loadError ? "Google Maps rejected the API key" : "The map stopped working"}>
          {loadError ??
            "Check that the Maps JavaScript API is enabled for this key and that this site's URL is in the key's HTTP referrer restrictions."}{" "}
          Live data and alerts keep working without the map.
        </MapNotice>
      )}
    </div>
  );
}

/** Centered frosted card for "waiting for fix" / "no devices" states. */
export function MapGlassCard({ icon: Icon, title, children }: { icon: typeof KeyRound; title: string; children: React.ReactNode }) {
  // Without a working map the centered error card owns this spot.
  if (!useMapsAvailable()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center p-6 pt-32 md:items-center md:pt-6">
      <div
        role="status"
        className="glass pointer-events-auto max-w-sm rounded-3xl p-6 text-center shadow-float ring-1 ring-black/5 dark:ring-white/10"
      >
        <span className="relative mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-live-tint text-live-fg">
          <span className="axm-pulse-ring absolute inset-0 rounded-full bg-live/30" aria-hidden />
          <Icon className="relative size-5" aria-hidden />
        </span>
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
