"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useActiveSosByDevice } from "./sos-banner";
import { NAV } from "./nav";

const SHORT: Record<string, string> = { "/": "Map" };

/** Phone navigation (< 768 px). */
export function BottomTabs() {
  const path = usePathname();
  const sosCount = useActiveSosByDevice().length;
  return (
    <nav aria-label="Main" className="pb-safe z-30 shrink-0 border-t bg-card md:hidden">
      <ul className="grid grid-cols-4">
        {NAV.map((item) => {
          const active = item.match(path);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground",
                  active && "text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-live-tint text-live-fg",
                  )}
                >
                  <item.icon className="size-5" aria-hidden />
                </span>
                {SHORT[item.href] ?? item.label}
                {item.href === "/alerts" && sosCount > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                    {sosCount}
                    <span className="sr-only"> active SOS</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
