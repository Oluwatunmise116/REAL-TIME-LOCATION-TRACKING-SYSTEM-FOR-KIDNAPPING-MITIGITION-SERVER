import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="currentColor" className="text-white/10" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#16A34A" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="3.5" fill="#16A34A" />
    </svg>
  );
}
