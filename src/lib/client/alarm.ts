"use client";

/**
 * SOS alarm sound, synthesised with Web Audio (no asset to load or cache).
 * Browsers only allow audio after a user gesture, so `armAudio()` is called from the login
 * submit and from the first pointer/key event on any page; the context then stays unlocked.
 */

type AudioWindow = Window & { __axmAudio?: AudioContext; webkitAudioContext?: typeof AudioContext };

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as AudioWindow;
  if (!w.__axmAudio) {
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    w.__axmAudio = new Ctor();
  }
  return w.__axmAudio;
}

/** Call from inside a user gesture handler. */
export function armAudio(): void {
  const c = ctx();
  if (c && c.state === "suspended") void c.resume();
}

export function audioArmed(): boolean {
  const c = ctx();
  return c !== null && c.state === "running";
}

let loop: ReturnType<typeof setInterval> | null = null;

function beep(c: AudioContext, at: number, freq: number, dur: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function pattern() {
  const c = ctx();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.05;
  // Two-tone alarm: hi-lo-hi-lo, then a pause.
  beep(c, t, 1046, 0.22);
  beep(c, t + 0.26, 784, 0.22);
  beep(c, t + 0.52, 1046, 0.22);
  beep(c, t + 0.78, 784, 0.22);
}

export function startAlarm(): void {
  if (loop) return;
  pattern();
  loop = setInterval(pattern, 2_000);
}

export function stopAlarm(): void {
  if (loop) clearInterval(loop);
  loop = null;
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notify(title: string, body: string, tag: string, onClick?: () => void): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag, requireInteraction: true });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}
