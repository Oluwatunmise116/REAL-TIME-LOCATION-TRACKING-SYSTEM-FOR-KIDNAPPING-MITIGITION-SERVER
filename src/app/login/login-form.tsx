"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { armAudio, requestNotificationPermission } from "@/lib/client/alarm";

function safeNext(raw: string | null): string {
  // Only same-origin paths; never "//evil.com" or absolute URLs.
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // This click is the user gesture browsers require before the SOS alarm can play.
    armAudio();
    void requestNotificationPermission();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.get("password"), name: form.get("name") || undefined }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Sign-in failed (HTTP ${r.status})`);
        setBusy(false);
        return;
      }
      // Client-side navigation keeps the unlocked AudioContext alive.
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-sidebar shadow-float">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
            <circle cx="16" cy="16" r="9" fill="none" stroke="#16A34A" strokeWidth="2.6" />
            <circle cx="16" cy="16" r="3.5" fill="#16A34A" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Axiometer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Personal-safety tracker dashboard</p>
      </div>

      <form onSubmit={onSubmit} className="rounded-3xl bg-card p-6 shadow-soft ring-1 ring-black/5 sm:p-8 dark:ring-white/10">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Your name (optional)</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Shown on acknowledgements"
              className="h-11 rounded-xl"
              maxLength={60}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="h-11 rounded-xl"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          {error && (
            <p id="login-error" role="alert" className="rounded-xl bg-danger-tint px-3 py-2 text-sm font-medium text-danger-fg">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl text-sm font-semibold">
            {busy ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
            Sign in
          </Button>
        </div>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">Shows live location data. Authorised operators only.</p>
    </div>
  );
}
