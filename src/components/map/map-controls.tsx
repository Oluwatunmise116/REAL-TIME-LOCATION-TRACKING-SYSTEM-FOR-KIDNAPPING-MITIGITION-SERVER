"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { Crosshair, LocateFixed, Minus, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function CtlButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "flex size-11 items-center justify-center text-foreground transition-colors hover:bg-muted [&_svg]:size-[18px]",
            pressed && "bg-live-tint text-live-fg hover:bg-live-tint",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Restyled zoom / recenter / follow controls (default Google UI is disabled). */
export function MapControls({
  onRecenter,
  follow,
  onToggleFollow,
  className,
}: {
  onRecenter?: () => void;
  follow?: boolean;
  onToggleFollow?: () => void;
  className?: string;
}) {
  const map = useMap();
  const zoom = (d: number) => map && map.setZoom((map.getZoom() ?? 13) + d);
  return (
    <div className={cn("absolute z-10 flex flex-col gap-2", className)}>
      {onToggleFollow && (
        <div className="overflow-hidden rounded-2xl bg-card shadow-float ring-1 ring-black/5 dark:ring-white/10">
          <CtlButton label={follow ? "Following device (click to stop)" : "Follow device"} pressed={follow} onClick={onToggleFollow}>
            <LocateFixed />
          </CtlButton>
        </div>
      )}
      <div className="flex flex-col divide-y overflow-hidden rounded-2xl bg-card shadow-float ring-1 ring-black/5 dark:ring-white/10">
        <CtlButton label="Zoom in" onClick={() => zoom(1)}>
          <Plus />
        </CtlButton>
        <CtlButton label="Zoom out" onClick={() => zoom(-1)}>
          <Minus />
        </CtlButton>
        {onRecenter && (
          <CtlButton label="Recenter" onClick={onRecenter}>
            <Crosshair />
          </CtlButton>
        )}
      </div>
    </div>
  );
}
