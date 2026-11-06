"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useActiveSosByDevice } from "./sos-banner";
import { BrandMark } from "./brand";
import { logout, NAV } from "./nav";

/** Dark sidebar: icon-only from 768 px, icon + label from 1280 px. */
export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const sosCount = useActiveSosByDevice().length;

  return (
    <nav aria-label="Main" className="hidden w-[76px] shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex xl:w-[232px]">
      <div className="flex h-16 items-center gap-3 px-5 xl:px-5">
        <BrandMark className="shrink-0" />
        <span className="hidden text-[15px] font-bold tracking-tight xl:inline">Axiometer</span>
      </div>
      <ul className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = item.match(path);
          const badge = item.href === "/alerts" && sosCount > 0 ? sosCount : null;
          const link = (
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-sidebar-foreground",
                "justify-center xl:justify-start",
                active && "bg-sidebar-active text-sidebar-foreground",
              )}
            >
              {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-live" aria-hidden />}
              <item.icon className={cn("size-[19px] shrink-0", active && "text-live")} aria-hidden />
              <span className="sr-only xl:not-sr-only">{item.label}</span>
              {badge !== null && (
                <span className="absolute top-1.5 right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white xl:static xl:ml-auto">
                  {badge}
                  <span className="sr-only"> active SOS</span>
                </span>
              )}
            </Link>
          );
          return (
            <li key={item.href}>
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" className="xl:hidden">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <div className="px-3 pb-5">
        <button
          type="button"
          onClick={() => void logout(router)}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-sidebar-foreground xl:justify-start"
        >
          <LogOut className="size-[19px] shrink-0" aria-hidden />
          <span className="sr-only xl:not-sr-only">Logout</span>
        </button>
      </div>
    </nav>
  );
}
