import { Suspense } from "react";
import { LiveProvider } from "@/components/providers/live-provider";
import { AppShell } from "@/components/shell/app-shell";

/** Shown while the shell streams in on routes whose URL is only known at request time (/devices/[id]). */
function ShellFallback() {
  return (
    <div className="flex h-dvh" aria-busy="true">
      <div className="hidden w-[76px] shrink-0 bg-sidebar md:block xl:w-[232px]" />
      <div className="flex-1 animate-pulse bg-muted motion-reduce:animate-none" />
    </div>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <LiveProvider>
      <Suspense fallback={<ShellFallback />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </LiveProvider>
  );
}
