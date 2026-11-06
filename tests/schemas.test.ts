import { describe, expect, it } from "vitest";
import { parseMessage, parseTopic, toPosition } from "@/lib/contract/schemas";

const ROOT = "devices";
const t = (channel: string, id = "esp32c6-a1") => `devices/${id}/${channel}`;

// Captured from the HiveMQ broker on 2026-10-30 (device had no GPS fix).
const REAL = {
  heartbeat: '{"seq":690,"up":1411}',
  telemetry: '{"ts":"2026-10-30T01:44:26Z","lat":null,"lon":null}',
  motionCandidate: '{"state":"CANDIDATE","prev":"NORMAL","ts":"2026-10-30T01:45:00Z","lat":null,"lon":null,"age":-1}',
  motionSuspicious:
    '{"state":"SUSPICIOUS","prev":"CANDIDATE","indicator":"SUSPECTED_DISTRESS","ts":"2026-10-30T01:45:01Z","lat":null,"lon":null,"age":-1}',
};

describe("topic parsing", () => {
  it("extracts device id and channel", () => {
    expect(parseTopic("devices/sim-001/heartbeat", ROOT)).toEqual({ deviceId: "sim-001", channel: "heartbeat" });
  });
  it("supports a multi-level root", () => {
    expect(parseTopic("org/x/devices/d1/sos", "org/x/devices")).toEqual({ deviceId: "d1", channel: "sos" });
  });
  it("rejects other roots and extra levels", () => {
    expect(parseTopic("other/d1/sos", ROOT)).toBeNull();
    expect(parseTopic("devices/d1/sos/extra", ROOT)).toBeNull();
    expect(parseTopic("devices/d1", ROOT)).toBeNull();
  });
});

describe("real broker payloads", () => {
  it("heartbeat", () => {
    expect(parseMessage(t("heartbeat"), REAL.heartbeat, ROOT)).toEqual({
      kind: "heartbeat",
      deviceId: "esp32c6-a1",
      data: { seq: 690, up: 1411 },
    });
  });

  it("telemetry with null lat/lon → no position (never 0,0)", () => {
    const m = parseMessage(t("telemetry"), REAL.telemetry, ROOT);
    expect(m.kind).toBe("telemetry");
    if (m.kind !== "telemetry") return;
    expect(m.data.position).toBeNull();
    expect(m.data.ts).toBe("2026-10-30T01:44:26.000Z");
  });

  it("motion CANDIDATE without indicator", () => {
    const m = parseMessage(t("motion"), REAL.motionCandidate, ROOT);
    expect(m.kind).toBe("motion");
    if (m.kind !== "motion") return;
    expect(m.data).toMatchObject({ state: "CANDIDATE", prev: "NORMAL", indicator: null, position: null, ageSec: null });
  });

  it("motion SUSPICIOUS with indicator and age -1", () => {
    const m = parseMessage(t("motion"), REAL.motionSuspicious, ROOT);
    if (m.kind !== "motion") throw new Error(`expected motion, got ${m.kind}`);
    expect(m.data).toMatchObject({ state: "SUSPICIOUS", prev: "CANDIDATE", indicator: "SUSPECTED_DISTRESS", ageSec: null });
  });
});

describe("telemetry", () => {
  it("accepts a 6-decimal fix", () => {
    const m = parseMessage(t("telemetry"), '{"ts":"2026-10-30T01:44:26Z","lat":6.524412,"lon":3.379201}', ROOT);
    if (m.kind !== "telemetry") throw new Error(m.kind);
    expect(m.data.position).toEqual({ lat: 6.524412, lon: 3.379201 });
  });

  it("treats (0,0) and half-null pairs as no position", () => {
    expect(toPosition(0, 0)).toBeNull();
    expect(toPosition(6.5, null)).toBeNull();
    expect(toPosition(null, 3.3)).toBeNull();
    expect(toPosition(undefined, undefined)).toBeNull();
    expect(toPosition(0, 3.3)).toEqual({ lat: 0, lon: 3.3 });
  });

  it("null ts is preserved as null (caller marks approx)", () => {
    const m = parseMessage(t("telemetry"), '{"ts":null,"lat":6.5,"lon":3.3}', ROOT);
    if (m.kind !== "telemetry") throw new Error(m.kind);
    expect(m.data.ts).toBeNull();
  });

  it("missing or garbage ts becomes null rather than failing", () => {
    for (const p of ['{"lat":null,"lon":null}', '{"ts":"not-a-date","lat":null,"lon":null}']) {
      const m = parseMessage(t("telemetry"), p, ROOT);
      if (m.kind !== "telemetry") throw new Error(m.kind);
      expect(m.data.ts).toBeNull();
    }
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseMessage(t("telemetry"), '{"ts":null,"lat":96,"lon":3}', ROOT).kind).toBe("invalid");
  });
});

describe("status (plain text, not JSON)", () => {
  it.each([
    ["online", "online"],
    ["offline", "offline"],
    [" Online\n", "online"],
  ])("%j → %s", (payload, value) => {
    expect(parseMessage(t("status"), payload, ROOT)).toEqual({ kind: "status", deviceId: "esp32c6-a1", value });
  });

  it("empty retained payload is ignored, not an error", () => {
    expect(parseMessage(t("status"), "", ROOT).kind).toBe("ignored");
  });

  it("JSON or unknown text is invalid", () => {
    expect(parseMessage(t("status"), '{"status":"online"}', ROOT).kind).toBe("invalid");
    expect(parseMessage(t("status"), "sleeping", ROOT).kind).toBe("invalid");
  });
});

describe("unknown enum values pass through as-is", () => {
  it("motion state and indicator from newer firmware", () => {
    const m = parseMessage(
      t("motion"),
      '{"state":"FREEFALL","prev":"NORMAL","indicator":"NEW_PATTERN","ts":"2026-10-30T01:45:01Z","lat":null,"lon":null,"age":-1}',
      ROOT,
    );
    if (m.kind !== "motion") throw new Error(m.kind);
    expect(m.data.state).toBe("FREEFALL");
    expect(m.data.indicator).toBe("NEW_PATTERN");
  });

  it("sos level", () => {
    const m = parseMessage(t("sos"), '{"level":"PANIC","presses":3,"seq":1,"ts":null,"lat":null,"lon":null,"age":-1}', ROOT);
    if (m.kind !== "sos") throw new Error(m.kind);
    expect(m.data.level).toBe("PANIC");
  });
});

describe("sos", () => {
  it("parses a DANGER alert with a fresh position", () => {
    const m = parseMessage(
      t("sos"),
      '{"level":"DANGER","presses":10,"seq":12,"ts":"2026-10-30T01:50:00Z","lat":6.52,"lon":3.37,"age":4}',
      ROOT,
    );
    if (m.kind !== "sos") throw new Error(m.kind);
    expect(m.data).toEqual({
      level: "DANGER",
      presses: 10,
      seq: 12,
      ts: "2026-10-30T01:50:00.000Z",
      position: { lat: 6.52, lon: 3.37 },
      ageSec: 4,
    });
  });

  it("age -1 with null position → ageSec null", () => {
    const m = parseMessage(t("sos"), '{"level":"SUSPICIOUS","presses":1,"seq":1,"ts":null,"lat":null,"lon":null,"age":-1}', ROOT);
    if (m.kind !== "sos") throw new Error(m.kind);
    expect(m.data.position).toBeNull();
    expect(m.data.ageSec).toBeNull();
  });
});

describe("malformed input never throws", () => {
  it.each([
    ["heartbeat", "not json"],
    ["heartbeat", '{"seq":"690","up":1411}'],
    ["heartbeat", '{"seq":-1,"up":1}'],
    ["sos", '{"level":"DANGER"}'],
    ["motion", "[]"],
    ["telemetry", "null"],
  ])("%s %j → invalid", (channel, payload) => {
    expect(parseMessage(t(channel), payload, ROOT).kind).toBe("invalid");
  });

  it("unknown channel", () => {
    const m = parseMessage(t("battery"), '{"v":3.9}', ROOT);
    expect(m).toMatchObject({ kind: "invalid", channel: "battery" });
  });

  it("bad topic", () => {
    expect(parseMessage("foo", "{}", ROOT)).toMatchObject({ kind: "invalid", deviceId: null });
  });
});
