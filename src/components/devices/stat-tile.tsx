import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Tone } from "@/components/status/chips";

const ICON_TONE: Record<Tone, string> = {
  live: "bg-live-tint text-live-fg",
  warning: "bg-warning-tint text-warning-fg",
  danger: "bg-danger-tint text-danger-fg",
  offline: "bg-offline-tint text-offline-fg",
  neutral: "bg-muted text-muted-foreground",
};

/** Small stat card: large semibold numeral + small muted unit. */
export function StatTile({
  label,
  value,
  unit,
  sub,
  icon: Icon,
  tone = "neutral",
  loading,
  className,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  loading?: boolean;
  className?: string;
  /** Tint the whole tile (e.g. an active SOS count). */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl bg-card p-3.5 shadow-soft ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
        emphasis && tone === "danger" && "bg-danger-tint ring-danger/30",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {Icon && (
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", ICON_TONE[tone])}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <p className="line-clamp-2 text-xs leading-tight font-medium text-muted-foreground">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-16" />
      ) : (
        <p className="tabular mt-2 truncate text-[22px] leading-none font-semibold tracking-tight">
          {value}
          {unit && <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>}
        </p>
      )}
      {sub && !loading && <div className="mt-1.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
