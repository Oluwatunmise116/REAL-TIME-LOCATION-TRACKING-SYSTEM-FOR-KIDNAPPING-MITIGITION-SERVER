"use client";

import { usePathname } from "next/navigation";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/client/store";
import { BottomTabs } from "./bottom-tabs";
import { ConnectionPill } from "./connection-pill";
import { isMapPage, pageTitle } from "./nav";
import { Sidebar } from "./sidebar";
import { SosBanner } from "./sos-banner";
import { ThemeToggle } from "./theme-toggle";

function TopBar({ hideOnPhone }: { hideOnPhone: boolean }) {
  const path = usePathname();
  const operator = useStore((s) => s.config?.operator);
  return (
    <header
      className={cn("h-14 shrink-0 items-center gap-3 border-b bg-card px-4 md:h-16 md:px-6", hideOnPhone ? "hidden md:flex" : "flex")}
    >
      <h1 className="truncate text-base font-bold tracking-tight md:text-lg">{pageTitle(path)}</h1>
      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <ConnectionPill />
        <ThemeToggle />
        {operator && (
          <span className="hidden items-center gap-2 rounded-full bg-muted py-1 pr-3 pl-1 text-xs font-semibold lg:inline-flex">
            <span className="flex size-7 items-center justify-center rounded-full bg-card">
              <UserRound className="size-4 text-muted-foreground" aria-hidden />
            </span>
            {operator}
          </span>
        )}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const mapPage = isMapPage(path);
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a href="#main" className="sr-only z-50 rounded-md bg-card px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2">
        Skip to content
      </a>
      <SosBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar hideOnPhone={mapPage} />
          <main id="main" className="relative min-h-0 flex-1">
            {children}
          </main>
        </div>
      </div>
      <BottomTabs />
    </div>
  );
}
