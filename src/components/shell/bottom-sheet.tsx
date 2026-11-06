"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type Snap = "peek" | "half" | "full";
const ORDER: Snap[] = ["peek", "half", "full"];
const PEEK_PX = 148;
const FULL_GAP_PX = 64; // keep the floating status chip visible at "full"

/**
 * Draggable bottom sheet for phones with three snap points. It sizes itself against its
 * positioned parent (the map area), so mobile browser bars are handled by the 100dvh shell.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  header,
  children,
  label,
  className,
}: {
  snap: Snap;
  onSnapChange: (s: Snap) => void;
  header?: React.ReactNode;
  children: React.ReactNode;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [parentH, setParentH] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setParentH(parent.clientHeight));
    ro.observe(parent);
    setParentH(parent.clientHeight);
    return () => ro.disconnect();
  }, []);

  const heightFor = useCallback(
    (s: Snap) => {
      if (!parentH) return s === "peek" ? PEEK_PX : 0;
      if (s === "peek") return Math.min(PEEK_PX, parentH);
      if (s === "half") return Math.round(parentH * 0.5);
      return Math.max(PEEK_PX, parentH - FULL_GAP_PX);
    },
    [parentH],
  );

  const height = dragH ?? heightFor(snap);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height, t: performance.now(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setDragH(Math.max(PEEK_PX * 0.6, Math.min(heightFor("full"), d.h + dy)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // Tap on the handle cycles peek → half → full → peek.
      onSnapChange(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]);
      setDragH(null);
      return;
    }
    const h = dragH ?? d.h;
    const velocity = (d.y - e.clientY) / Math.max(1, performance.now() - d.t); // px/ms, + = up
    let target: Snap;
    if (velocity > 0.6) target = h > heightFor("half") ? "full" : "half";
    else if (velocity < -0.6) target = h < heightFor("half") ? "peek" : "half";
    else target = ORDER.reduce((best, s) => (Math.abs(heightFor(s) - h) < Math.abs(heightFor(best) - h) ? s : best), "peek" as Snap);
    onSnapChange(target);
    setDragH(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = ORDER.indexOf(snap);
    if (e.key === "ArrowUp") onSnapChange(ORDER[Math.min(2, i + 1)]);
    else if (e.key === "ArrowDown") onSnapChange(ORDER[Math.max(0, i - 1)]);
    else return;
    e.preventDefault();
  };

  return (
    <section
      ref={ref}
      aria-label={label}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[28px] bg-background shadow-[0_-8px_32px_rgb(15_23_42/0.16)] md:hidden",
        dragH === null && "transition-[height] duration-300 ease-out",
        className,
      )}
      style={{ height }}
    >
      <div
        className="shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragH(null);
        }}
      >
        <button
          type="button"
          onKeyDown={onKeyDown}
          // Pointer taps are handled above; detail === 0 means Enter/Space.
          onClick={(e) => e.detail === 0 && onSnapChange(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length])}
          aria-label={`Resize panel (currently ${snap}). Tap to cycle, or use arrow keys.`}
          className="flex h-7 w-full items-center justify-center"
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        </button>
        {header}
      </div>
      <div
        className={cn(
          "scrollbar-thin min-h-0 flex-1 overscroll-contain px-4 pb-4",
          snap === "peek" && dragH === null ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {children}
      </div>
    </section>
  );
}
