import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkHeartbeat,
  deriveConnection,
  deriveGps,
  linkQuality,
  pruneBeats,
  resolveEventTime,
  sosDedupeKey,
  type LivenessInput,
} from "@/lib/domain/derive";

const T0 = Date.parse("2026-10-30T02:00:00Z");

describe("deriveConnection (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const live = (): LivenessInput => ({
    brokerStatus: "online",
    onlineSince: null,
    lastHeartbeatAt: Date.now(),
    lastMessageAt: Date.now(),
    observingSince: T0 - 120_000,
  });

  it("online while heartbeats are fresh", () => {
    const i = live();
    vi.advanceTimersByTime(7_999);
    expect(deriveConnection(i, Date.now()).connection).toBe("online");
  });

  it("signal lost after ≥ 8 s without a heartbeat, before the Last Will", () => {
    const i = live();
    vi.advanceTimersByTime(8_000);
    expect(deriveConnection(i, Date.now())).toEqual({ connection: "signal_lost", reason: "heartbeat_timeout" });
    vi.advanceTimersByTime(20_000); // telemetry still arriving keeps it "signal lost", not offline
    expect(deriveConnection({ ...i, lastMessageAt: Date.now() }, Date.now()).connection).toBe("signal_lost");
  });

  it("offline after > 60 s of silence even if status still says online", () => {
    const i = live();
    vi.advanceTimersByTime(60_000);
    expect(deriveConnection(i, Date.now()).connection).toBe("signal_lost");
    vi.advanceTimersByTime(1);
    expect(deriveConnection(i, Date.now())).toEqual({ connection: "offline", reason: "no_messages" });
  });

  it("offline immediately when the broker publishes the Last Will", () => {
    expect(deriveConnection({ ...live(), brokerStatus: "offline" }, Date.now())).toEqual({ connection: "offline", reason: "last_will" });
  });

  it("a device that just (re)connected gets a grace period before its first heartbeat", () => {
    const i: LivenessInput = { ...live(), lastHeartbeatAt: T0 - 300_000, onlineSince: Date.now() };
    vi.advanceTimersByTime(5_000);
    expect(deriveConnection(i, Date.now()).connection).toBe("online");
    vi.advanceTimersByTime(3_000);
    expect(deriveConnection(i, Date.now()).connection).toBe("signal_lost");
  });

  it("no messages ever → offline", () => {
    expect(
      deriveConnection({ brokerStatus: null, onlineSince: null, lastHeartbeatAt: null, lastMessageAt: null, observingSince: T0 }, T0)
        .connection,
    ).toBe("offline");
  });
});

describe("linkQuality", () => {
  const beats = (from: number, to: number, every = 2_000) => {
    const out: number[] = [];
    for (let t = from; t <= to; t += every) out.push(t);
    return out;
  };

  it("30 heartbeats in 60 s = 100 %", () => {
    const now = T0;
    expect(linkQuality(beats(now - 58_000, now), now, now - 600_000)).toBe(100);
  });

  it("15 of 30 = 50 %", () => {
    const now = T0;
    expect(linkQuality(beats(now - 58_000, now, 4_000), now, null)).toBe(50);
  });

  it("ignores beats outside the window and never exceeds 100", () => {
    const now = T0;
    const b = [...beats(now - 200_000, now - 61_000), ...beats(now - 59_500, now, 1_000)];
    expect(linkQuality(b, now, null)).toBe(100);
  });

  it("0 % when nothing arrived", () => {
    expect(linkQuality([], T0, null)).toBe(0);
  });

  it("scales expected while the observation window is younger than 60 s", () => {
    const start = T0 - 10_000; // 10 s observed → 5 expected
    expect(linkQuality(beats(start + 2_000, T0), T0, start)).toBe(100);
    expect(linkQuality(beats(start + 2_000, T0, 4_000), T0, start)).toBe(60); // 3 of 5
  });

  it("null with under 4 s observed", () => {
    expect(linkQuality([T0], T0, T0 - 3_000)).toBeNull();
  });

  it("pruneBeats drops expired timestamps in place", () => {
    const b = [T0 - 70_000, T0 - 60_000, T0 - 59_999, T0];
    expect(pruneBeats(b, T0)).toEqual([T0 - 59_999, T0]);
  });
});

describe("checkHeartbeat (reboot detection)", () => {
  const prev = { seq: 690, up: 1411, at: T0 };

  it("normal increment", () => {
    expect(checkHeartbeat(prev, { seq: 691, up: 1413, at: T0 + 2_000 })).toEqual({ rebooted: false, missed: 0, duplicate: false });
  });

  it("counts dropped heartbeats from seq gaps", () => {
    expect(checkHeartbeat(prev, { seq: 694, up: 1421, at: T0 + 10_000 }).missed).toBe(3);
  });

  it("seq going down = reboot", () => {
    expect(checkHeartbeat(prev, { seq: 0, up: 1500, at: T0 + 2_000 }).rebooted).toBe(true);
  });

  it("up going down = reboot", () => {
    expect(checkHeartbeat(prev, { seq: 700, up: 3, at: T0 + 2_000 }).rebooted).toBe(true);
  });

  it("reboot during an unobserved gap (uptime too small for elapsed time)", () => {
    // 1 h later the device reports seq 1000 / up 1800: it must have restarted while we weren't watching.
    expect(checkHeartbeat(prev, { seq: 1000, up: 1800, at: T0 + 3_600_000 }).rebooted).toBe(true);
    // …whereas a continuously running device has up ≈ prev.up + elapsed.
    expect(checkHeartbeat(prev, { seq: 2490, up: 1411 + 3600, at: T0 + 3_600_000 }).rebooted).toBe(false);
  });

  it("identical beat = duplicate", () => {
    expect(checkHeartbeat(prev, { ...prev, at: T0 + 100 }).duplicate).toBe(true);
  });

  it("first beat ever", () => {
    expect(checkHeartbeat(null, prev)).toEqual({ rebooted: false, missed: 0, duplicate: false });
  });
});

describe("deriveGps", () => {
  it("no fix when the device reports null, even with a stored historic position", () => {
    expect(deriveGps({ lat: 6.5, lon: 3.3, reportsNoFix: true, lastFixAt: T0 }, T0)).toBe("none");
    expect(deriveGps({ lat: null, lon: null, reportsNoFix: false, lastFixAt: null }, T0)).toBe("none");
  });
  it("live when a fix arrived within 60 s, last known otherwise", () => {
    expect(deriveGps({ lat: 6.5, lon: 3.3, reportsNoFix: false, lastFixAt: T0 - 60_000 }, T0)).toBe("live");
    expect(deriveGps({ lat: 6.5, lon: 3.3, reportsNoFix: false, lastFixAt: T0 - 60_001 }, T0)).toBe("last_known");
  });
});

describe("event time", () => {
  it("uses the device ts when present", () => {
    expect(resolveEventTime("2026-10-30T01:45:01.000Z", T0)).toEqual({ ts: Date.parse("2026-10-30T01:45:01Z"), approx: false });
  });
  it("falls back to receive time and flags approx", () => {
    expect(resolveEventTime(null, T0)).toEqual({ ts: T0, approx: true });
  });
  it("sos dedupe key includes seq and ts", () => {
    expect(sosDedupeKey(12, "2026-10-30T01:50:00.000Z")).not.toBe(sosDedupeKey(13, "2026-10-30T01:50:00.000Z"));
    expect(sosDedupeKey(12, null)).toBe("sos:12:null");
  });
});
