"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { BellRing, Check, Loader2, LogOut, Map as MapIcon, Palette, Server, Volume2 } from "lucide-react";
import { logout } from "@/components/shell/nav";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Chip } from "@/components/status/chips";
import { armAudio, notificationsSupported, requestNotificationPermission, startAlarm, stopAlarm } from "@/lib/client/alarm";
import { relTime } from "@/lib/client/format";
import { deviceName, useStore } from "@/lib/client/store";
import { useNow } from "@/lib/client/use-now";
import type { BrokerState, DeviceView } from "@/lib/domain/types";

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Server;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-card p-5 shadow-soft ring-1 ring-black/[0.04] sm:p-6 dark:ring-white/[0.06]">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function RenameRow({ d }: { d: DeviceView }) {
  const [value, setValue] = useState(d.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const upsertDevice = useStore((s) => s.upsertDevice);
  const dirty = value.trim() !== (d.displayName ?? "");
  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/devices/${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: value.trim() || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      upsertDevice(((await r.json()) as { device: DeviceView }).device);
      toast.success("Device renamed", { description: value.trim() || d.id });
    } catch (e) {
      toast.error("Rename failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Label htmlFor={`rename-${d.id}`} className="w-44 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {d.id}
      </Label>
      <div className="flex flex-1 gap-2">
        <Input
          id={`rename-${d.id}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Display name"
          maxLength={60}
          className="h-11 rounded-xl"
        />
        <Button type="submit" disabled={!dirty || busy} className="h-11 rounded-xl px-4">
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
        </Button>
      </div>
    </form>
  );
}

interface Health {
  ok: boolean;
  broker: BrokerState;
  lastMessageAt: number | null;
  connectedAt: number | null;
  url?: string | null;
  lastError?: string | null;
}

function BrokerHealthCard() {
  const now = useNow();
  const sse = useStore((s) => s.sse);
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json() as Promise<Health>)
        .then((b) => !cancelled && (setH(b), setErr(null)))
        .catch((e: unknown) => !cancelled && setErr(e instanceof Error ? e.message : "unreachable"));
    void load();
    const t = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  const tone = h?.broker === "connected" ? "live" : h?.broker === "not_configured" ? "offline" : "warning";
  const rows: [string, React.ReactNode][] = [
    ["Broker", h ? <Chip tone={tone} label={h.broker.replace("_", " ")} /> : "…"],
    [
      "URL",
      <span key="u" className="font-mono text-xs break-all">
        {h?.url ?? "—"}
      </span>,
    ],
    ["Connected", h?.connectedAt ? relTime(h.connectedAt, now) : "—"],
    ["Last message", h?.lastMessageAt ? relTime(h.lastMessageAt, now) : "none yet"],
    [
      "Browser stream",
      <Chip
        key="s"
        tone={sse === "live" ? "live" : "warning"}
        label={sse === "live" ? "Live (SSE)" : sse === "connecting" ? "Connecting" : "Reconnecting"}
      />,
    ],
  ];
  if (h?.lastError)
    rows.push([
      "Last error",
      <span key="e" className="text-danger-fg">
        {h.lastError}
      </span>,
    ]);
  return (
    <Section
      icon={Server}
      title="Broker connection"
      description="The server holds the MQTT connection; browsers never see broker credentials."
    >
      {err && <p className="mb-3 text-sm text-danger-fg">Health endpoint unreachable: {err}</p>}
      <dl className="divide-y">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

const noopSubscribe = () => () => {};

const CONTRACT: [string, string, string, string][] = [
  ["status", 'plain text "online" / "offline" (not JSON)', "on connect; offline = broker Last Will", "QoS 1, retained"],
  ["heartbeat", '{"seq":690,"up":1411}', "every 2 s", "QoS 0"],
  ["telemetry", '{"ts":"…Z","lat":6.524412,"lon":3.379201}', "every 10 s (last known position)", "QoS 1"],
  ["motion", '{"state","prev","indicator"?,"ts","lat","lon","age"}', "on state change", "QoS 1"],
  ["sos", '{"level","presses","seq","ts","lat","lon","age"}', "on button activation (hold ≥ 1 s)", "QoS 1"],
];

export default function SettingsPage() {
  const devices = useStore((s) => s.devices);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const config = useStore((s) => s.config);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [permissionOverride, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  const initialPermission = useSyncExternalStore(
    noopSubscribe,
    () => (notificationsSupported() ? Notification.permission : "unsupported"),
    () => null,
  );
  const permission = permissionOverride ?? initialPermission;
  const [testing, setTesting] = useState(false);

  const list = Object.values(devices).sort((a, b) => deviceName(a).localeCompare(deviceName(b)));

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:p-6 lg:grid-cols-2">
        <Section icon={Volume2} title="Alerts" description="How this browser reacts to SOS and motion alerts.">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="pref-sound" className="flex-1 flex-col items-start gap-0.5">
                <span className="block font-semibold">Alarm sound</span>
                <span className="block text-xs font-normal text-muted-foreground">Loops while an SOS is unacknowledged.</span>
              </Label>
              <Switch id="pref-sound" checked={prefs.sound} onCheckedChange={(v) => setPrefs({ sound: v })} />
            </div>
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => {
                armAudio();
                if (testing) {
                  stopAlarm();
                  setTesting(false);
                } else {
                  startAlarm();
                  setTesting(true);
                  setTimeout(() => {
                    stopAlarm();
                    setTesting(false);
                  }, 4_000);
                }
              }}
            >
              <Volume2 /> {testing ? "Stop test" : "Test alarm sound"}
            </Button>
            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <Label htmlFor="pref-notify" className="flex-1 flex-col items-start gap-0.5">
                <span className="block font-semibold">Browser notifications</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {permission === "unsupported"
                    ? "Not supported in this browser."
                    : permission === "denied"
                      ? "Blocked in browser settings. Allow notifications for this site to enable."
                      : permission === "granted"
                        ? "Permission granted."
                        : "The browser will ask for permission."}
                </span>
              </Label>
              <Switch
                id="pref-notify"
                checked={prefs.notifications && permission === "granted"}
                disabled={permission === "unsupported" || permission === "denied"}
                onCheckedChange={async (v) => {
                  if (v) {
                    const p = await requestNotificationPermission();
                    setPermission(p);
                    setPrefs({ notifications: p === "granted" });
                  } else setPrefs({ notifications: false });
                }}
              />
            </div>
            {permission === "granted" && (
              <Button
                variant="ghost"
                className="h-10 rounded-xl text-xs"
                onClick={() => new Notification("Axiometer test notification", { body: "SOS alerts will look like this." })}
              >
                <BellRing /> Send a test notification
              </Button>
            )}
          </div>
        </Section>

        <BrokerHealthCard />

        <Section icon={Palette} title="Appearance">
          <ToggleGroup
            type="single"
            value={theme ?? "system"}
            onValueChange={(v) => v && setTheme(v)}
            aria-label="Theme"
            className="gap-1 rounded-full bg-muted p-1"
          >
            {["system", "light", "dark"].map((t) => (
              <ToggleGroupItem
                key={t}
                value={t}
                className="h-9 rounded-full px-4 text-xs font-semibold capitalize data-[state=on]:bg-card data-[state=on]:shadow-soft"
              >
                {t}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="mt-5 flex items-start gap-3 border-t pt-4 text-sm">
            <MapIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">
              Google Maps:{" "}
              <span className="font-semibold text-foreground">
                {config ? (config.mapsApiKey ? "API key set" : "API key missing") : "…"}
              </span>
              {config?.mapsApiKey && (
                <>
                  {" "}
                  · Map ID{" "}
                  <span className="font-semibold text-foreground">
                    {config.mapId ? "set" : "not set (using DEMO_MAP_ID, default styling)"}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-semibold text-foreground">{config?.operator ?? "…"}</span>
            </p>
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => void logout(router)}>
              <LogOut /> Sign out
            </Button>
          </div>
        </Section>

        <Section icon={Check} title="Device names" description="Display names are stored on the dashboard; the firmware ID never changes.">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices yet.</p>
          ) : (
            <div className="divide-y">
              {list.map((d) => (
                <RenameRow key={d.id} d={d} />
              ))}
            </div>
          )}
        </Section>

        <div className="lg:col-span-2">
          <Section
            icon={Server}
            title="Topic contract"
            description="Read-only reference. Topics are devices/<deviceId>/<channel>; the dashboard subscribes to devices/+/# at QoS 1."
          >
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-1 py-2 font-semibold">Channel</th>
                    <th className="px-1 py-2 font-semibold">Payload</th>
                    <th className="px-1 py-2 font-semibold">Cadence</th>
                    <th className="px-1 py-2 font-semibold">QoS / retain</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {CONTRACT.map(([ch, payload, cadence, qos]) => (
                    <tr key={ch}>
                      <td className="px-1 py-2.5 font-mono text-xs font-semibold">{ch}</td>
                      <td className="px-1 py-2.5 font-mono text-xs">{payload}</td>
                      <td className="px-1 py-2.5 text-xs">{cadence}</td>
                      <td className="px-1 py-2.5 text-xs whitespace-nowrap">{qos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>lat/lon null = no fix has ever been accepted. Never treated as 0,0.</li>
              <li>age = seconds since the fix was accepted; -1 = no position. Telemetry has no age (last known position).</li>
              <li>ts null = device clock not synced; the server receive time is used and marked “approx.”.</li>
              <li>Motion detects unusual motion patterns only. SOS is the only human-intent signal.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
