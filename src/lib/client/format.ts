/** "4 s ago", "3 min ago", "2 h ago", "Oct 29". `now` = 0 (SSR) renders an empty string. */
export function relTime(ms: number | null | undefined, now: number): string {
  if (!ms || !now) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Compact age in seconds → "4 s", "2 min", "1 h 5 min". */
export function formatAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** Uptime from seconds → "23m 31s", "4h 02m", "3d 4h". */
export function formatUptime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || sec < 0) return "—";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Live uptime: last reported `up` plus time since that heartbeat (only while it's fresh). */
export function liveUptime(up: number | null, at: number | null, now: number, online: boolean): number | null {
  if (up === null) return null;
  if (!online || !at || !now) return up;
  return up + Math.max(0, Math.floor((now - at) / 1000));
}

export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

export function formatShortCoord(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export function mapsLink(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

/** Local time with seconds, e.g. "14:03:22" today or "Oct 29, 14:03". */
export function clockTime(ms: number, now: number): string {
  const d = new Date(ms);
  const sameDay = now && new Date(now).toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function utcString(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function initials(name: string): string {
  const parts = name.replace(/[-_.]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
