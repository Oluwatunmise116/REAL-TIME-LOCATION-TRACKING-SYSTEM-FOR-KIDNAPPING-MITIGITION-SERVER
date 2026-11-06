import { Bell, Cpu, Map as MapIcon, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Live map", icon: MapIcon, match: (p) => p === "/" },
  { href: "/devices", label: "Devices", icon: Cpu, match: (p) => p.startsWith("/devices") },
  { href: "/alerts", label: "Alerts", icon: Bell, match: (p) => p.startsWith("/alerts") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

export function pageTitle(path: string): string {
  if (path === "/") return "Live map";
  if (path.startsWith("/devices/")) return "Device";
  return NAV.find((n) => n.match(path))?.label ?? "Axiometer";
}

/** Pages whose phone layout is a full-bleed map with a bottom sheet. */
export function isMapPage(path: string): boolean {
  return path === "/" || /^\/devices\/[^/]+$/.test(path);
}

export async function logout(router: { replace: (href: string) => void; refresh: () => void }): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  router.replace("/login");
  router.refresh();
}
